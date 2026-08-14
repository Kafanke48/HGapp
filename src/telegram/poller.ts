/**
 * `getUpdates` long-poll zanka.
 *
 * Teče samo, dokler je aplikacija odprta in je seja aktivna (klicatelj v
 * `ui/`/`platform/` odloči kdaj `start()`/`stop()` — glej spec 7.6/7.7: iOS
 * ustavi JS kmalu po tem, ko gre aplikacija v ozadje, zato zanesljivega
 * poslušanja v ozadju ni).
 *
 * Offset se shrani v `AppSettings.telegramOffset` PO VSAKI POSAMEZNI
 * posodobitvi, ne po celotnem paketu — padec sredi paketa (zaklep telefona,
 * zaprtje zavihka) sme izgubiti kvečjemu še neobdelane posodobitve tega
 * paketa, nikoli pa ne sme povzročiti podvojene obdelave že opravljene.
 */
import type { HGappDB } from '../db/schema.ts'
import { getSettings, updateSettings } from '../db/repositories/settings.ts'
import type { TelegramTransport } from './transport.ts'
import { getUpdates } from './client.ts'
import type { TelegramCallbackQuery, TelegramMessage, TelegramUpdate } from './types.ts'

export interface PollerContext {
  db: HGappDB
  transport: TelegramTransport
}

export interface PollerHandlers {
  onMessage?: (ctx: PollerContext, message: TelegramMessage) => Promise<void> | void
  onCallbackQuery?: (ctx: PollerContext, callbackQuery: TelegramCallbackQuery) => Promise<void> | void
}

async function dispatchUpdate(ctx: PollerContext, update: TelegramUpdate, handlers: PollerHandlers): Promise<void> {
  if (update.message && handlers.onMessage) {
    await handlers.onMessage(ctx, update.message)
  }
  if (update.callback_query && handlers.onCallbackQuery) {
    await handlers.onCallbackQuery(ctx, update.callback_query)
  }
}

/**
 * Obdela en paket posodobitev in po VSAKI posamezni takoj shrani offset v
 * bazo (glej komentar zgoraj). Izpostavljeno ločeno od zanke spodaj, da je
 * neposredno testljivo brez pravega (ali celo lažnega) omreženga čakanja.
 */
export async function applyUpdates(
  db: HGappDB,
  transport: TelegramTransport,
  updates: readonly TelegramUpdate[],
  handlers: PollerHandlers,
): Promise<void> {
  const ctx: PollerContext = { db, transport }
  for (const update of updates) {
    await dispatchUpdate(ctx, update, handlers)
    await updateSettings(db, { telegramOffset: update.update_id })
  }
}

export interface Poller {
  start(): void
  stop(): void
  readonly isRunning: boolean
}

export interface CreatePollerOptions {
  /** Premor med krogi, kadar `getUpdates` ne vrne ničesar ali javi napako (privzeto 1000ms). */
  idleDelayMs?: number
  /** Vbrizgljiva zakasnitev za teste — privzeto pravi `setTimeout`. */
  sleep?: (ms: number) => Promise<void>
  /** Klicano ob napaki znotraj zanke (npr. za beleženje v UI) — ne sme vsebovati tokena. */
  onError?: (error: unknown) => void
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Ustvari poller z eksplicitnima `start()`/`stop()`. Klicatelj je odgovoren,
 * da ju kliče samo, ko je aplikacija vidna in je seja aktivna (glej spec 7.6).
 */
export function createPoller(
  db: HGappDB,
  transport: TelegramTransport,
  handlers: PollerHandlers,
  options: CreatePollerOptions = {},
): Poller {
  const idleDelayMs = options.idleDelayMs ?? 1000
  const sleep = options.sleep ?? defaultSleep

  let running = false
  let loopPromise: Promise<void> | null = null

  async function loop(): Promise<void> {
    while (running) {
      const settings = await getSettings(db)
      const token = settings.telegramBotToken
      if (!token) {
        await sleep(idleDelayMs)
        continue
      }

      try {
        const response = await getUpdates(transport, token, {
          offset: settings.telegramOffset + 1,
          timeout: 25,
          allowed_updates: ['message', 'callback_query'],
        })

        if (!running) break // Ustavljeno med čakanjem na odgovor — ne obdelaj ničesar.

        if (!response.ok) {
          options.onError?.(new Error(response.description))
          await sleep(idleDelayMs)
          continue
        }

        if (response.result.length === 0) {
          continue // Dolg poll je že "čakal" — ni dodatnega premora potreben.
        }

        await applyUpdates(db, transport, response.result, handlers)
      } catch (err) {
        options.onError?.(err)
        await sleep(idleDelayMs)
      }
    }
  }

  return {
    start() {
      if (running) return
      running = true
      loopPromise = loop()
    },
    stop() {
      running = false
      void loopPromise
    },
    get isRunning() {
      return running
    },
  }
}
