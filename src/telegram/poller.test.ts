import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HGappDB } from '../db/schema.ts'
import { getSettings } from '../db/repositories/settings.ts'
import { createMockTransport } from './mockTransport.ts'
import { applyUpdates } from './poller.ts'
import type { PollerHandlers } from './poller.ts'
import type { TelegramUpdate } from './types.ts'

function makeUpdate(updateId: number, text: string): TelegramUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      chat: { id: 1, type: 'private' },
      date: 0,
      from: { id: 1, is_bot: false, first_name: 'T' },
      text,
    },
  }
}

describe('poller', () => {
  let db: HGappDB

  beforeEach(() => {
    db = new HGappDB('test-poller-' + crypto.randomUUID())
  })

  afterEach(async () => {
    await db.delete()
  })

  it('persists the offset after every single update, not once per batch', async () => {
    const mock = createMockTransport()
    const seen: string[] = []
    const handlers: PollerHandlers = {
      onMessage: (_ctx, message) => {
        seen.push(message.text ?? '')
      },
    }

    const updates = [makeUpdate(101, 'a'), makeUpdate(102, 'b'), makeUpdate(103, 'c')]
    await applyUpdates(db, mock.transport, updates, handlers)

    expect(seen).toEqual(['a', 'b', 'c'])
    const settings = await getSettings(db)
    expect(settings.telegramOffset).toBe(103)
  })

  it('a simulated crash mid-batch does not lose the offset already advanced, and a restart reprocesses nothing already handled', async () => {
    const mock = createMockTransport()
    const seen: string[] = []
    let shouldThrowOnSecond = true

    const handlers: PollerHandlers = {
      onMessage: (_ctx, message) => {
        if (message.text === 'b' && shouldThrowOnSecond) {
          throw new Error('simulirana zrušitev sredi paketa (npr. telefon se je zaklenil)')
        }
        seen.push(message.text ?? '')
      },
    }

    const updates = [makeUpdate(201, 'a'), makeUpdate(202, 'b'), makeUpdate(203, 'c')]

    // "Padec" med obdelavo drugega elementa - tretji se sploh ne poskusi.
    await expect(applyUpdates(db, mock.transport, updates, handlers)).rejects.toThrow()

    expect(seen).toEqual(['a']) // samo prvi je bil dejansko obdelan
    let settings = await getSettings(db)
    expect(settings.telegramOffset).toBe(201) // offset za 'b' NI bil shranjen, ker je padlo med njo

    // "Ponoven zagon": v resnici bi Telegram zdaj vrnil samo posodobitve od offset+1 naprej,
    // torej spet 202 in 203 (201 se ne pošlje več enkrat poslana/potrjena).
    shouldThrowOnSecond = false
    await applyUpdates(db, mock.transport, [makeUpdate(202, 'b'), makeUpdate(203, 'c')], handlers)

    // 'a' se ni obdelal še enkrat - obdelan je bil natanko enkrat čez oba klica.
    expect(seen).toEqual(['a', 'b', 'c'])
    settings = await getSettings(db)
    expect(settings.telegramOffset).toBe(203)
  })

  it('dispatches both onMessage and onCallbackQuery handlers appropriately', async () => {
    const mock = createMockTransport()
    const messages: string[] = []
    const callbacks: string[] = []
    const handlers: PollerHandlers = {
      onMessage: (_ctx, message) => {
        messages.push(message.text ?? '')
      },
      onCallbackQuery: (_ctx, cb) => {
        callbacks.push(cb.data ?? '')
      },
    }

    const updates: TelegramUpdate[] = [
      makeUpdate(1, 'hello'),
      {
        update_id: 2,
        callback_query: {
          id: 'cb1',
          from: { id: 1, is_bot: false, first_name: 'T' },
          data: 'confirm:xyz',
        },
      },
    ]

    await applyUpdates(db, mock.transport, updates, handlers)

    expect(messages).toEqual(['hello'])
    expect(callbacks).toEqual(['confirm:xyz'])
  })
})
