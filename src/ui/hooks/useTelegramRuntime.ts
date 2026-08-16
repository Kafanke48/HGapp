import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/schema.ts'
import { readSettings } from '../../db/repositories/index.ts'
import {
  createPoller,
  drain,
  handleCallbackQuery,
  handleMessage,
  realTelegramTransport,
} from '../../telegram/index.ts'

export interface TelegramRuntimeStatus {
  /** Sta žeton IN ID skupine nastavljena. Ko je false, ta hook ne naredi ničesar. */
  configured: boolean
  /** Ali poller trenutno teče (dokument viden IN aktivna seja). */
  polling: boolean
  pendingCount: number
  failedCount: number
}

/** Premor med samodejnimi praznjenji vrste, dokler je seja aktivna (glej nalogo: "zmeren interval"). */
const DRAIN_INTERVAL_MS = 20_000

/**
 * Ali sta žeton in ID skupine nastavljena — bere se živo, da se runtime
 * samodejno vklopi takoj, ko uporabnik v NastavitveScreen shrani obe polji,
 * brez potrebe po ponovnem zagonu aplikacije.
 *
 * Uporablja `readSettings` (branje), nikoli `getSettings` — glej opozorilo v
 * `db/repositories/settings.ts`, ta napaka je že enkrat obelila zaslon.
 */
function useTelegramConfigured(): boolean {
  return useLiveQuery(
    async () => {
      const settings = await readSettings(db)
      return Boolean(settings.telegramBotToken && settings.telegramGroupChatId)
    },
    [],
    false,
  )
}

/** Živo štetje čakajočih/neuspešnih elementov vrste — isti podatek kot `useTelegramStatus`. */
function useOutboxCounts(): { pendingCount: number; failedCount: number } {
  return useLiveQuery(
    async () => {
      const [pendingCount, failedCount] = await Promise.all([
        db.outbox.where('status').equals('caka').count(),
        db.outbox.where('status').equals('napaka').count(),
      ])
      return { pendingCount, failedCount }
    },
    [],
    { pendingCount: 0, failedCount: 0 },
  )
}

/**
 * Poganja Telegram runtime — praznjenje odhodne vrste in poslušanje odgovorov
 * (glej specifikacijo, razdelek 7.4/7.6/7.7). Klicatelj (App, izven naše
 * lasti) to pokliče ENKRAT na vrhu aplikacije.
 *
 * Nič tu ne sme vreči izjeme v React: offline je normalno stanje te
 * aplikacije, ne izjema — vsak klic proti Telegramu je zato v `try/catch`.
 */
export function useTelegramRuntime(activeSessionId: string | null): TelegramRuntimeStatus {
  const configured = useTelegramConfigured()
  const { pendingCount, failedCount } = useOutboxCounts()
  const [polling, setPolling] = useState(false)

  // Praznjenje vrste: ob priklopu, ob vrnitvi povezave, ob vrnitvi vidnosti
  // zaslona, in z zmernim intervalom, dokler je seja aktivna.
  useEffect(() => {
    if (!configured) return

    async function safeDrain() {
      try {
        await drain(db, realTelegramTransport)
      } catch (err) {
        // Omrežna napaka je pričakovano stanje (spec 7.4) — nikoli ne vrzi naprej v React.
        console.warn('Telegram: praznjenje vrste ni uspelo', err)
      }
    }

    void safeDrain()

    const onOnline = () => void safeDrain()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void safeDrain()
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisibility)

    let intervalId: number | null = null
    if (activeSessionId !== null) {
      intervalId = window.setInterval(() => void safeDrain(), DRAIN_INTERVAL_MS)
    }

    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisibility)
      if (intervalId !== null) window.clearInterval(intervalId)
    }
  }, [configured, activeSessionId])

  // Poslušanje odgovorov: SAMO dokler je dokument viden IN je seja aktivna
  // (glej spec 7.6/7.7 — iOS ustavi JS kmalu po odhodu aplikacije v ozadje,
  // zanesljivega poslušanja v ozadju zato ni in ga ne smemo hliniti).
  useEffect(() => {
    if (!configured || activeSessionId === null) {
      setPolling(false)
      return
    }

    const poller = createPoller(
      db,
      realTelegramTransport,
      {
        onCallbackQuery: (ctx, callbackQuery) => handleCallbackQuery(ctx.db, callbackQuery),
        onMessage: (ctx, message) => handleMessage(ctx.db, message),
      },
      {
        onError: (err) => {
          // Glej komentar zgoraj — omrežje je normalno stanje, ne izjema.
          console.warn('Telegram: poller napaka', err)
        },
      },
    )

    function syncWithVisibility() {
      if (document.visibilityState === 'visible') {
        poller.start()
        setPolling(true)
      } else {
        poller.stop()
        setPolling(false)
      }
    }

    syncWithVisibility()
    document.addEventListener('visibilitychange', syncWithVisibility)

    return () => {
      document.removeEventListener('visibilitychange', syncWithVisibility)
      poller.stop()
      setPolling(false)
    }
  }, [configured, activeSessionId])

  return { configured, polling, pendingCount, failedCount }
}
