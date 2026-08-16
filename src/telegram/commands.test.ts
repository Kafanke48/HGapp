import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HGappDB } from '../db/schema.ts'
import { createPlayer } from '../db/repositories/players.ts'
import { createBuyIn } from '../db/repositories/buyins.ts'
import { addSessionPlayer, createSession, transitionSessionStatus } from '../db/repositories/sessions.ts'
import { handleCommand } from './commands.ts'
import { handleCallbackQuery, handleMessage } from './confirmations.ts'
import type { TelegramMessage } from './types.ts'

function groupMessage(text: string, fromId = 555, messageId = 1): TelegramMessage {
  return {
    message_id: messageId,
    chat: { id: -100123, type: 'supergroup', title: 'Poker' },
    date: 0,
    from: { id: fromId, is_bot: false, first_name: 'Miha' },
    text,
  }
}

function privateMessage(text: string, fromId = 555, messageId = 2): TelegramMessage {
  return {
    message_id: messageId,
    chat: { id: fromId, type: 'private' },
    date: 0,
    from: { id: fromId, is_bot: false, first_name: 'Miha' },
    text,
  }
}

describe('/stanje v skupini', () => {
  let db: HGappDB

  beforeEach(() => {
    db = new HGappDB('test-commands-' + crypto.randomUUID())
  })
  afterEach(async () => {
    await db.delete()
  })

  it('brez aktivne seje odgovori, da seje ni', async () => {
    const handled = await handleCommand(db, groupMessage('/stanje'))

    expect(handled).toBe(true)
    const items = await db.outbox.toArray()
    expect(items).toHaveLength(1)
    expect(items[0]?.params['text']).toBe('Trenutno ni aktivne seje.')
  })

  it('z aktivno sejo pošlje stanje z vsotami in blagajno', async () => {
    const miha = await createPlayer(db, { name: 'Miha' })
    const ana = await createPlayer(db, { name: 'Ana' })
    const session = await createSession(db, { defaultBuyInCents: 2000 })
    await transitionSessionStatus(db, session.id, 'aktivna')
    await addSessionPlayer(db, session.id, miha.id, 0)
    await addSessionPlayer(db, session.id, ana.id, 1)

    // Ana plača gotovino, Miha vzame na kredo — blagajna sme vsebovati le Anin denar.
    await createBuyIn(db, {
      sessionId: session.id,
      playerId: ana.id,
      amountCents: 2000,
      paymentMethod: 'gotovina',
    })
    await createBuyIn(db, {
      sessionId: session.id,
      playerId: miha.id,
      amountCents: 2000,
      paymentMethod: 'kredo',
    })

    await handleCommand(db, groupMessage('/stanje'))

    const items = await db.outbox.toArray()
    expect(items).toHaveLength(1)
    const text = String(items[0]?.params['text'])
    expect(text).toContain('Miha: vzel 20,00 €, plačal 0,00 €')
    expect(text).toContain('Ana: vzel 20,00 €, plačal 20,00 €')
    expect(text).toContain('V blagajni naj bo: 20,00 €')
    expect(items[0]?.params['chat_id']).toBe(-100123)
  })

  it('prepozna obliko /stanje@ImeBota, ki jo Telegram uporabi v skupinah', async () => {
    const handled = await handleCommand(db, groupMessage('/stanje@HGappBot'))
    expect(handled).toBe(true)
  })

  it('tujih ukazov ne obravnava — v skupini so lahko tudi drugi boti', async () => {
    const handled = await handleCommand(db, groupMessage('/pogodba'))
    expect(handled).toBe(false)
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('razlog zavrnitve se zbira samo v zasebnem klepetu', () => {
  let db: HGappDB

  beforeEach(() => {
    db = new HGappDB('test-reject-scope-' + crypto.randomUUID())
  })
  afterEach(async () => {
    await db.delete()
  })

  /** Ustvari igralca s povezanim Telegram računom in njegov zavrnjen buy-in brez razloga. */
  async function setupPendingRejection() {
    const player = await createPlayer(db, { name: 'Miha', telegramUserId: '555' })
    const buyIn = await createBuyIn(db, {
      sessionId: 's1',
      playerId: player.id,
      amountCents: 2000,
      paymentMethod: 'gotovina',
    })
    await handleCallbackQuery(db, {
      id: 'cb-1',
      from: { id: 555, is_bot: false, first_name: 'Miha' },
      message: { message_id: 9, chat: { id: 555, type: 'private' }, date: 0 },
      data: `reject:${buyIn.id}`,
    })
    return buyIn
  }

  it('sporočilo V SKUPINI se NE zapiše kot razlog zavrnitve', async () => {
    const buyIn = await setupPendingRejection()

    // Klasičen primer: igralec zavrne buy-in, nato v skupini vpraša nekaj povsem
    // nepovezanega. Brez omejitve na zasebni klepet bi to postalo "razlog".
    await handleMessage(db, groupMessage('kdaj se dobimo naslednjič?'))

    const after = await db.buyIns.get(buyIn.id)
    expect(after?.confirmation).toBe('zavrnjen')
    expect(after?.rejectionReason).toBeNull()
  })

  it('sporočilo v ZASEBNEM klepetu se zapiše kot razlog', async () => {
    const buyIn = await setupPendingRejection()

    await handleMessage(db, privateMessage('nisem še plačal, prinesem jutri'))

    const after = await db.buyIns.get(buyIn.id)
    expect(after?.rejectionReason).toBe('nisem še plačal, prinesem jutri')
  })

  it('ukaz v zasebnem klepetu ne postane razlog zavrnitve', async () => {
    const buyIn = await setupPendingRejection()

    await handleMessage(db, privateMessage('/stanje'))

    const after = await db.buyIns.get(buyIn.id)
    expect(after?.rejectionReason).toBeNull()
  })
})
