/**
 * Trajna vrsta odhodnih Telegram sporočil.
 *
 * Offline je normalno stanje, ne izjema (glej specifikacijo 7.4): nič ne
 * kliče Telegrama neposredno, vse gre skozi `outbox` tabelo. `drain()` jo
 * nato prazni, ko je povezava na voljo.
 */
import type { HGappDB } from '../db/schema.ts'
import type { OutboxItem, OutboxStatus } from '../db/types.ts'
import { newId, now } from '../db/ids.ts'
import { snapshot, withAudit } from '../db/audit.ts'
import { getSettings } from '../db/repositories/settings.ts'
import type { TelegramTransport } from './transport.ts'
import { TelegramNetworkError } from './transport.ts'
import type { TelegramApiResponse } from './types.ts'

/** Največ toliko poskusov pri omrežnih/5xx napakah, preden obupamo trajno. */
const MAX_ATTEMPTS = 10
/** Zgornja meja eksponentnega odmika (glej spec: "1s→2s→4s…capped at 60s"). */
const MAX_BACKOFF_MS = 60_000
/** Premor med zaporednimi pošiljanji — Telegram dovoli ~1 sporočilo/s na skupino. */
const DEFAULT_SPACING_MS = 350

export interface EnqueueInput {
  dedupKey: string
  method: string
  params: Record<string, unknown>
  relatedTable?: string | null
  relatedId?: string | null
  /** Po tem času se element zavrže namesto pošlje (glej `drain`). */
  expiresAt?: number | null
}

/**
 * Doda sporočilo v vrsto, z zaščito pred podvajanjem po `dedupKey`.
 *
 * Če `dedupKey` že obstaja v stanju `caka` ali `poslano`, se NIČ ne vpiše —
 * poravnava (ali katerokoli drugo sporočilo) se ne sme nikoli objaviti
 * dvakrat, tudi če je bila aplikacija med pošiljanjem zaprta in znova
 * odprta. V tem primeru vrnemo obstoječi element nespremenjen.
 *
 * Če `dedupKey` obstaja, a je v stanju `napaka` (trajno neuspešno), element
 * PONOVNO poženemo — vendar s `put`, ne `add`: unikatni indeks na `dedupKey`
 * (glej schema.ts, `&dedupKey`) velja globalno za vse vrstice ne glede na
 * stanje, zato bi `add` z isto vrednostjo trčil ob obstoječo vrstico.
 * Ponovna uporaba iste vrstice je zato edini način, da po popravku (npr. bot
 * je bil odblokiran) sporočilo spet poskusimo poslati.
 */
export async function enqueue(db: HGappDB, item: EnqueueInput): Promise<OutboxItem> {
  return withAudit(db, [db.outbox], async (audit) => {
    const existing = await db.outbox.where('dedupKey').equals(item.dedupKey).first()

    if (existing && (existing.status === 'caka' || existing.status === 'poslano')) {
      return existing
    }

    const timestamp = now()

    if (existing) {
      // existing.status === 'napaka' — glej komentar zgoraj.
      const before = snapshot(existing)
      const updated: OutboxItem = {
        ...existing,
        method: item.method,
        params: item.params,
        status: 'caka',
        attempts: 0,
        nextAttemptAt: timestamp,
        lastError: null,
        relatedTable: item.relatedTable ?? existing.relatedTable,
        relatedId: item.relatedId ?? existing.relatedId,
        expiresAt: item.expiresAt ?? null,
        updatedAt: timestamp,
      }
      await db.outbox.put(updated)
      audit.record({
        sessionId: null,
        entityTable: 'outbox',
        entityId: updated.id,
        action: 'update',
        before,
        after: snapshot(updated),
        versionAfter: null,
        note: 'Ponoven poskus po trajni napaki',
      })
      return updated
    }

    const created: OutboxItem = {
      id: newId(),
      dedupKey: item.dedupKey,
      method: item.method,
      params: item.params,
      status: 'caka',
      attempts: 0,
      nextAttemptAt: timestamp,
      lastError: null,
      relatedTable: item.relatedTable ?? null,
      relatedId: item.relatedId ?? null,
      expiresAt: item.expiresAt ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.outbox.add(created)
    audit.record({
      sessionId: null,
      entityTable: 'outbox',
      entityId: created.id,
      action: 'create',
      before: null,
      after: snapshot(created),
      versionAfter: null,
    })
    return created
  })
}

export interface DrainOptions {
  /** Vir "trenutnega časa" — testi podajo fiksno/nadzorovano uro namesto prave. */
  now?: () => number
  /** Zakasnitev med pošiljanji — testi podajo no-op, da ne čakajo prave ms. */
  sleep?: (ms: number) => Promise<void>
  /** Premor med zaporednimi pošiljanji v ms (privzeto ~350, glej spec 7.4). */
  spacingMs?: number
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Nikoli ne zapišemo token-a v napako (glej varnostno zahtevo naloge) — samo
 * odstranimo morebitne pojavitve, če bi omrežna napaka po nesreči vsebovala
 * celoten URL zahteve (ta vsebuje token).
 */
function sanitizeError(message: string, token: string): string {
  if (!token) return message
  return message.split(token).join('[bot-token]')
}

/**
 * Obdela vse zapadle elemente v vrsti, ZAPOREDNO, s premorom `spacingMs` med
 * njimi (glej spec 7.4: Telegram dovoli ~1 sporočilo/s na skupino — zaporedno
 * pošiljanje pomeni, da je pot 429 varnostna mreža, ne pravilo).
 */
export async function drain(db: HGappDB, transport: TelegramTransport, options: DrainOptions = {}): Promise<void> {
  const nowFn = options.now ?? now
  const sleepFn = options.sleep ?? defaultSleep
  const spacingMs = options.spacingMs ?? DEFAULT_SPACING_MS

  const settings = await getSettings(db)
  const token = settings.telegramBotToken
  if (!token) return // Bot še ni nastavljen — vrsta počaka, nič se ne pošlje.

  const pendingStatus: OutboxStatus = 'caka'
  const items = await db.outbox.where('status').equals(pendingStatus).sortBy('createdAt')

  let sentAny = false
  for (const item of items) {
    const currentTime = nowFn()

    if (item.expiresAt !== null && item.expiresAt <= currentTime) {
      // Zapadlo (npr. odgovor na gumb, ki ga Telegram ne bi več sprejel) — zavržemo, ne pošljemo.
      await dropExpiredItem(db, item)
      continue
    }

    if (item.nextAttemptAt > currentTime) continue // Čaka na svoj odmik — še ni na vrsti.

    if (sentAny) await sleepFn(spacingMs)
    sentAny = true

    const stopBatch = await processItem(db, transport, token, item, nowFn)
    if (stopBatch) break // 429 = bot je globalno omejen, ne le to sporočilo.
  }
}

async function processItem(
  db: HGappDB,
  transport: TelegramTransport,
  token: string,
  item: OutboxItem,
  nowFn: () => number,
): Promise<boolean> {
  let response: TelegramApiResponse<unknown>
  try {
    response = await transport.callMethod(token, item.method, item.params)
  } catch (err) {
    const message = err instanceof TelegramNetworkError || err instanceof Error ? err.message : 'Neznana omrežna napaka'
    await scheduleRetry(db, item.id, nowFn, sanitizeError(message, token))
    return false
  }

  if (response.ok) {
    await markSent(db, item.id, nowFn)
    return false
  }

  if (response.error_code === 429) {
    const retryAfterMs = (response.parameters?.retry_after ?? 1) * 1000
    await markThrottled(db, item.id, nowFn, retryAfterMs, sanitizeError(response.description, token))
    return true
  }

  if (response.error_code === 403 || response.error_code === 400) {
    // Bot blokiran ali klepet ne obstaja — trajna napaka, nikoli tiho izgubljena (glej spec).
    await markPermanentFailure(db, item.id, nowFn, sanitizeError(response.description, token))
    return false
  }

  if (response.error_code >= 500) {
    await scheduleRetry(db, item.id, nowFn, sanitizeError(response.description, token))
    return false
  }

  // Druge 4xx (npr. napačen token/401, neznana metoda) so najverjetneje
  // napačna konfiguracija, ne prehodno stanje — obravnavamo kot trajne.
  await markPermanentFailure(db, item.id, nowFn, sanitizeError(response.description, token))
  return false
}

async function dropExpiredItem(db: HGappDB, item: OutboxItem): Promise<void> {
  await withAudit(db, [db.outbox], async (audit) => {
    const existing = await db.outbox.get(item.id)
    if (!existing) return
    const before = snapshot(existing)
    await db.outbox.delete(item.id)
    audit.record({
      sessionId: null,
      entityTable: 'outbox',
      entityId: item.id,
      action: 'void',
      before,
      after: null,
      versionAfter: null,
      note: 'Element je zapadel (expiresAt) — zavržen namesto poslan',
    })
  })
}

async function markSent(db: HGappDB, id: string, nowFn: () => number): Promise<void> {
  await withAudit(db, [db.outbox], async (audit) => {
    const existing = await db.outbox.get(id)
    if (!existing) return
    const before = snapshot(existing)
    const updated: OutboxItem = { ...existing, status: 'poslano', lastError: null, updatedAt: nowFn() }
    await db.outbox.put(updated)
    audit.record({
      sessionId: null,
      entityTable: 'outbox',
      entityId: id,
      action: 'update',
      before,
      after: snapshot(updated),
      versionAfter: null,
    })
  })
}

async function markPermanentFailure(db: HGappDB, id: string, nowFn: () => number, errorMessage: string): Promise<void> {
  await withAudit(db, [db.outbox], async (audit) => {
    const existing = await db.outbox.get(id)
    if (!existing) return
    const before = snapshot(existing)
    const updated: OutboxItem = {
      ...existing,
      status: 'napaka',
      attempts: existing.attempts + 1,
      lastError: errorMessage,
      updatedAt: nowFn(),
    }
    await db.outbox.put(updated)
    audit.record({
      sessionId: null,
      entityTable: 'outbox',
      entityId: id,
      action: 'update',
      before,
      after: snapshot(updated),
      versionAfter: null,
      note: 'Trajna napaka — se ne bo več samodejno ponovila',
    })
  })
}

/** 429 ne šteje kot "poskus" tega elementa — bot je omejen globalno, ne ta pošiljka je kriva. */
async function markThrottled(db: HGappDB, id: string, nowFn: () => number, retryAfterMs: number, errorMessage: string): Promise<void> {
  await withAudit(db, [db.outbox], async (audit) => {
    const existing = await db.outbox.get(id)
    if (!existing) return
    const before = snapshot(existing)
    const updated: OutboxItem = {
      ...existing,
      nextAttemptAt: nowFn() + retryAfterMs,
      lastError: errorMessage,
      updatedAt: nowFn(),
    }
    await db.outbox.put(updated)
    audit.record({
      sessionId: null,
      entityTable: 'outbox',
      entityId: id,
      action: 'update',
      before,
      after: snapshot(updated),
      versionAfter: null,
      note: `429 — odloženo za ${retryAfterMs}ms`,
    })
  })
}

async function scheduleRetry(db: HGappDB, id: string, nowFn: () => number, errorMessage: string): Promise<void> {
  await withAudit(db, [db.outbox], async (audit) => {
    const existing = await db.outbox.get(id)
    if (!existing) return
    const before = snapshot(existing)
    const attempts = existing.attempts + 1

    if (attempts >= MAX_ATTEMPTS) {
      const updated: OutboxItem = { ...existing, status: 'napaka', attempts, lastError: errorMessage, updatedAt: nowFn() }
      await db.outbox.put(updated)
      audit.record({
        sessionId: null,
        entityTable: 'outbox',
        entityId: id,
        action: 'update',
        before,
        after: snapshot(updated),
        versionAfter: null,
        note: `Obupano po ${attempts} poskusih`,
      })
      return
    }

    // Eksponentni odmik 1s→2s→4s…, s stropom in ±20% jitterjem (razpršitev retryjev,
    // da ob množičnem izpadu vsa sporočila ne poskušajo znova hkrati).
    const backoffBase = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (attempts - 1))
    const jitter = Math.random() * backoffBase * 0.2
    const delayMs = backoffBase + jitter

    const updated: OutboxItem = {
      ...existing,
      attempts,
      nextAttemptAt: nowFn() + delayMs,
      lastError: errorMessage,
      updatedAt: nowFn(),
    }
    await db.outbox.put(updated)
    audit.record({
      sessionId: null,
      entityTable: 'outbox',
      entityId: id,
      action: 'update',
      before,
      after: snapshot(updated),
      versionAfter: null,
      note: `Poskus ${attempts} neuspešen — odmik ${Math.round(delayMs)}ms`,
    })
  })
}
