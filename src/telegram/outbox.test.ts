import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HGappDB } from '../db/schema.ts'
import { updateSettings } from '../db/repositories/settings.ts'
import { createMockTransport } from './mockTransport.ts'
import { drain, enqueue } from './outbox.ts'

/**
 * Ura, ki jo testi ročno premikajo naprej - `drain` jo dobi prek `options.now`.
 *
 * POMEMBNO: `enqueue()` sam vedno uporabi pravi `Date.now()` za `nextAttemptAt`
 * (glej `db/ids.ts` - vsa koda pod `src/db/` mora klicati `now()`, ne globala
 * neposredno, `enqueue` živi zunaj tega, a interno kliče isto funkcijo prek
 * outbox.ts). Zato mora testna ura štartati BLIZU pravega časa (privzeto
 * `Date.now()` ob klicu), sicer bi element navidez "še ni na vrsti" v
 * nedogled.
 */
function fakeClock(startAt: number = Date.now()) {
  let time = startAt
  return {
    now: () => time,
    advance(ms: number) {
      time += ms
    },
  }
}

const noopSleep = async () => {}

describe('outbox', () => {
  let db: HGappDB

  beforeEach(async () => {
    db = new HGappDB('test-outbox-' + crypto.randomUUID())
    await updateSettings(db, { telegramBotToken: 'TEST-TOKEN', telegramGroupChatId: '-100' })
  })

  afterEach(async () => {
    await db.delete()
  })

  it('enqueueing the same dedupKey twice yields exactly one item', async () => {
    const first = await enqueue(db, { dedupKey: 'session-started:s1', method: 'sendMessage', params: { text: 'a' } })
    const second = await enqueue(db, { dedupKey: 'session-started:s1', method: 'sendMessage', params: { text: 'b' } })

    expect(second.id).toBe(first.id)
    const rows = await db.outbox.where('dedupKey').equals('session-started:s1').toArray()
    expect(rows).toHaveLength(1)
    // Drugi klic se ni "prijel" - obdrži se vsebina prvega vpisa.
    expect(rows[0]!.params).toEqual({ text: 'a' })
  })

  it('a 429 response stops the whole batch and respects retry_after', async () => {
    const mock = createMockTransport()
    mock.queueResponse({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 5 } })
    // Ta odgovor se NIKOLI ne bi smel porabiti, če batch res ustavimo.
    mock.queueResponse({ ok: true, result: {} })

    const itemA = await enqueue(db, { dedupKey: 'a', method: 'sendMessage', params: { text: 'a' } })
    await enqueue(db, { dedupKey: 'b', method: 'sendMessage', params: { text: 'b' } })

    const clock = fakeClock()
    await drain(db, mock.transport, { now: clock.now, sleep: noopSleep })

    expect(mock.calls).toHaveLength(1) // drugo sporočilo sploh ni bilo poskušeno

    const reloadedA = await db.outbox.get(itemA.id)
    expect(reloadedA!.status).toBe('caka') // ostane v vrsti, ni trajna napaka
    expect(reloadedA!.nextAttemptAt).toBe(clock.now() + 5000)

    const reloadedB = await db.outbox.where('dedupKey').equals('b').first()
    expect(reloadedB!.status).toBe('caka')
    expect(reloadedB!.attempts).toBe(0)
  })

  it('a 403 response marks permanent failure with no retry', async () => {
    const mock = createMockTransport()
    mock.queueResponse({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' })

    const item = await enqueue(db, { dedupKey: 'blocked', method: 'sendMessage', params: { text: 'x' } })
    await drain(db, mock.transport, { now: fakeClock().now, sleep: noopSleep })

    const reloaded = await db.outbox.get(item.id)
    expect(reloaded!.status).toBe('napaka')
    expect(reloaded!.lastError).toContain('Forbidden')

    // Ponoven `drain` ne sme več poskusiti - trajna napaka.
    mock.calls.length = 0
    await drain(db, mock.transport, { now: fakeClock().now, sleep: noopSleep })
    expect(mock.calls).toHaveLength(0)
  })

  it('a 400 (chat not found) response also marks permanent failure', async () => {
    const mock = createMockTransport()
    mock.queueResponse({ ok: false, error_code: 400, description: 'Bad Request: chat not found' })

    const item = await enqueue(db, { dedupKey: 'no-chat', method: 'sendMessage', params: { text: 'x' } })
    await drain(db, mock.transport, { now: fakeClock().now, sleep: noopSleep })

    const reloaded = await db.outbox.get(item.id)
    expect(reloaded!.status).toBe('napaka')
  })

  it('backoff grows on repeated network failures and gives up after 10 attempts', async () => {
    const mock = createMockTransport()
    mock.setDefaultHandler(() => ({ networkError: 'simulated offline' }))

    const item = await enqueue(db, { dedupKey: 'flaky', method: 'sendMessage', params: { text: 'x' } })
    const clock = fakeClock()

    const delayHistory: number[] = []
    for (let i = 0; i < 9; i++) {
      // Preskoči dovolj daleč mimo trenutnega odmika (najdaljši mogoč je 60s + jitter).
      clock.advance(120_000)
      await drain(db, mock.transport, { now: clock.now, sleep: noopSleep })
      const reloaded = await db.outbox.get(item.id)
      expect(reloaded!.status).toBe('caka') // še ni obupal
      expect(reloaded!.attempts).toBe(i + 1)
      delayHistory.push(reloaded!.nextAttemptAt - clock.now())
    }

    // Odmik med prvimi poskusi narašča (dokler ne doseže stropa 60s).
    expect(delayHistory[0]!).toBeLessThan(delayHistory[1]!)
    expect(delayHistory[1]!).toBeLessThan(delayHistory[2]!)

    // 10. poskus - obupamo trajno.
    clock.advance(120_000)
    await drain(db, mock.transport, { now: clock.now, sleep: noopSleep })
    const final = await db.outbox.get(item.id)
    expect(final!.status).toBe('napaka')
    expect(final!.attempts).toBe(10)

    // Noben nadaljnji drain ne sme več poskusiti.
    mock.calls.length = 0
    clock.advance(120_000)
    await drain(db, mock.transport, { now: clock.now, sleep: noopSleep })
    expect(mock.calls).toHaveLength(0)
  })

  it('drops expired items instead of sending them', async () => {
    const mock = createMockTransport()
    await enqueue(db, {
      dedupKey: 'stale-callback-answer',
      method: 'answerCallbackQuery',
      params: { callback_query_id: '1' },
      expiresAt: 500, // v preteklosti glede na katerikoli razumen "zdaj"
    })

    await drain(db, mock.transport, { now: fakeClock().now, sleep: noopSleep })

    expect(mock.calls).toHaveLength(0)
    const rows = await db.outbox.where('dedupKey').equals('stale-callback-answer').toArray()
    expect(rows).toHaveLength(0)
  })

  it('never leaks the bot token into stored error messages', async () => {
    const mock = createMockTransport()
    mock.queueResponse({ ok: false, error_code: 403, description: 'Forbidden' })
    await enqueue(db, { dedupKey: 'x', method: 'sendMessage', params: {} })
    await drain(db, mock.transport, { now: fakeClock().now, sleep: noopSleep })

    const rows = await db.outbox.toArray()
    for (const row of rows) {
      expect(row.lastError ?? '').not.toContain('TEST-TOKEN')
    }
    expect(mock.calls[0]!.token).toBe('TEST-TOKEN') // token gre samo v klic, ne v shranjeno napako
  })

  it('re-enqueueing a permanently-failed dedupKey resets it to caka and lets it retry', async () => {
    const mock = createMockTransport()
    mock.queueResponse({ ok: false, error_code: 403, description: 'Forbidden' })
    const first = await enqueue(db, { dedupKey: 'retry-me', method: 'sendMessage', params: { text: 'v1' } })
    await drain(db, mock.transport, { now: fakeClock().now, sleep: noopSleep })
    expect((await db.outbox.get(first.id))!.status).toBe('napaka')

    const second = await enqueue(db, { dedupKey: 'retry-me', method: 'sendMessage', params: { text: 'v2' } })
    expect(second.id).toBe(first.id) // ista vrstica se ponovno uporabi (glej komentar v outbox.ts)
    expect(second.status).toBe('caka')
    expect(second.attempts).toBe(0)

    mock.queueResponse({ ok: true, result: {} })
    await drain(db, mock.transport, { now: fakeClock().now, sleep: noopSleep })
    expect((await db.outbox.get(first.id))!.status).toBe('poslano')
  })
})
