import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HGappDB } from '../db/schema.ts'
import { createPlayer } from '../db/repositories/players.ts'
import { findLinkCandidates, linkPlayer } from './linking.ts'
import type { TelegramUpdate } from './types.ts'

describe('linking', () => {
  let db: HGappDB

  beforeEach(() => {
    db = new HGappDB('test-linking-' + crypto.randomUUID())
  })

  afterEach(async () => {
    await db.delete()
  })

  it('finds candidates from messages and callback queries, deduplicated, excluding bots', async () => {
    const updates: TelegramUpdate[] = [
      { update_id: 1, message: { message_id: 1, chat: { id: 1, type: 'private' }, date: 0, from: { id: 10, is_bot: false, first_name: 'Ana', username: 'ana' } } },
      { update_id: 2, message: { message_id: 2, chat: { id: 1, type: 'private' }, date: 0, from: { id: 10, is_bot: false, first_name: 'Ana', username: 'ana' } } },
      { update_id: 3, callback_query: { id: 'cb1', from: { id: 20, is_bot: false, first_name: 'Bine' } } },
      { update_id: 4, message: { message_id: 4, chat: { id: 1, type: 'private' }, date: 0, from: { id: 999, is_bot: true, first_name: 'SomeBot' } } },
    ]

    const candidates = await findLinkCandidates(db, updates)
    expect(candidates.map((c) => c.tgUserId).sort()).toEqual(['10', '20'])
  })

  it('excludes already-linked players from candidates', async () => {
    await createPlayer(db, { name: 'Ana', telegramUserId: '10' })
    const updates: TelegramUpdate[] = [
      { update_id: 1, message: { message_id: 1, chat: { id: 1, type: 'private' }, date: 0, from: { id: 10, is_bot: false, first_name: 'Ana' } } },
      { update_id: 2, message: { message_id: 2, chat: { id: 1, type: 'private' }, date: 0, from: { id: 20, is_bot: false, first_name: 'Bine' } } },
    ]

    const candidates = await findLinkCandidates(db, updates)
    expect(candidates.map((c) => c.tgUserId)).toEqual(['20'])
  })

  it('linkPlayer sets telegramUserId and telegramUsername on the player', async () => {
    const player = await createPlayer(db, { name: 'Ciril' })
    const linked = await linkPlayer(db, player.id, '30', 'ciril_tg')
    expect(linked.telegramUserId).toBe('30')
    expect(linked.telegramUsername).toBe('ciril_tg')
  })
})
