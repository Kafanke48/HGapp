import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HGappDB } from '../db/schema.ts'
import { createPlayer } from '../db/repositories/players.ts'
import { createBuyIn } from '../db/repositories/buyins.ts'
import { enqueueConfirmationPrompt, handleCallbackQuery, handleMessage } from './confirmations.ts'
import type { TelegramCallbackQuery, TelegramMessage, TelegramUser } from './types.ts'

function makeUser(id: number, overrides: Partial<TelegramUser> = {}): TelegramUser {
  return { id, is_bot: false, first_name: 'Test', ...overrides }
}

function makeCallbackQuery(overrides: Partial<TelegramCallbackQuery> & { data: string }): TelegramCallbackQuery {
  return {
    id: 'cb-' + Math.random().toString(36).slice(2),
    from: makeUser(555, { username: 'testuser' }),
    message: { message_id: 1, chat: { id: 555, type: 'private' }, date: 0 },
    ...overrides,
  }
}

describe('confirmations', () => {
  let db: HGappDB

  beforeEach(() => {
    db = new HGappDB('test-confirmations-' + crypto.randomUUID())
  })

  afterEach(async () => {
    await db.delete()
  })

  it('enqueueConfirmationPrompt does nothing for an unlinked player (normal state, not an error)', async () => {
    const player = await createPlayer(db, { name: 'Ana' }) // brez telegramUserId
    const buyIn = await createBuyIn(db, { sessionId: 's1', playerId: player.id, amountCents: 2000, paymentMethod: 'gotovina' })

    await enqueueConfirmationPrompt(db, player, buyIn)

    expect(await db.outbox.count()).toBe(0)
  })

  it('enqueueConfirmationPrompt sends a DM with Potrdim/Zavrnem buttons for a linked player', async () => {
    const player = await createPlayer(db, { name: 'Bine', telegramUserId: '555' })
    const buyIn = await createBuyIn(db, { sessionId: 's1', playerId: player.id, amountCents: 2000, paymentMethod: 'gotovina' })

    await enqueueConfirmationPrompt(db, player, buyIn)

    const rows = await db.outbox.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.method).toBe('sendMessage')
    const params = rows[0]!.params as { chat_id: string; text: string; reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } }
    expect(params.chat_id).toBe('555')
    expect(params.text).toContain('20,00 €')
    expect(params.reply_markup.inline_keyboard[0]).toEqual([
      { text: 'Potrdim', callback_data: `confirm:${buyIn.id}` },
      { text: 'Zavrnem', callback_data: `reject:${buyIn.id}` },
    ])
  })

  it('pressing Potrdim reaches setConfirmation with potrjen and answers the callback query', async () => {
    const player = await createPlayer(db, { name: 'Ciril', telegramUserId: '555' })
    const buyIn = await createBuyIn(db, { sessionId: 's1', playerId: player.id, amountCents: 2000, paymentMethod: 'gotovina' })

    const cb = makeCallbackQuery({ data: `confirm:${buyIn.id}` })
    await handleCallbackQuery(db, cb)

    const updated = await db.buyIns.get(buyIn.id)
    expect(updated!.confirmation).toBe('potrjen')
    expect(updated!.rejectionReason).toBeNull()

    const answered = (await db.outbox.toArray()).filter((r) => r.method === 'answerCallbackQuery')
    expect(answered).toHaveLength(1)
    expect((answered[0]!.params as { callback_query_id: string }).callback_query_id).toBe(cb.id)
  })

  it('pressing Zavrnem, then a plain-text (non-Reply) DM, attaches the reason via setConfirmation', async () => {
    const player = await createPlayer(db, { name: 'Davorin', telegramUserId: '555' })
    const buyIn = await createBuyIn(db, { sessionId: 's1', playerId: player.id, amountCents: 2000, paymentMethod: 'gotovina' })

    const cb = makeCallbackQuery({ data: `reject:${buyIn.id}` })
    await handleCallbackQuery(db, cb)

    const afterReject = await db.buyIns.get(buyIn.id)
    expect(afterReject!.confirmation).toBe('zavrnjen')
    expect(afterReject!.rejectionReason).toBeNull() // razlog še ni znan

    // Igralec NE uporabi Telegramovega "Reply" - samo natipka navadno sporočilo.
    // `reply_to_message` je namerno odsoten, da preverimo prav ta primer iz naloge.
    const plainMessage: TelegramMessage = {
      message_id: 2,
      chat: { id: 555, type: 'private' },
      date: 0,
      from: makeUser(555),
      text: 'ni prepoznal zneska',
    }
    expect(plainMessage.reply_to_message).toBeUndefined()

    await handleMessage(db, plainMessage)

    const afterReason = await db.buyIns.get(buyIn.id)
    expect(afterReason!.confirmation).toBe('zavrnjen')
    expect(afterReason!.rejectionReason).toBe('ni prepoznal zneska')
  })

  it('a callback for a deleted/non-existent buy-in still answers the callback query', async () => {
    const cb = makeCallbackQuery({ data: 'confirm:does-not-exist' })

    await expect(handleCallbackQuery(db, cb)).resolves.not.toThrow()

    const answered = (await db.outbox.toArray()).filter((r) => r.method === 'answerCallbackQuery')
    expect(answered).toHaveLength(1)
    expect((answered[0]!.params as { callback_query_id: string }).callback_query_id).toBe(cb.id)
  })

  it('a free-text DM from an unlinked sender is ignored (no matching player)', async () => {
    const message: TelegramMessage = {
      message_id: 1,
      chat: { id: 999, type: 'private' },
      date: 0,
      from: makeUser(999),
      text: 'pozdravljeni',
    }
    await expect(handleMessage(db, message)).resolves.not.toThrow()
    expect(await db.outbox.count()).toBe(0)
  })
})
