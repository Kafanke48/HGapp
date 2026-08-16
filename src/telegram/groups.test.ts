import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HGappDB } from '../db/schema.ts'
import { listSeenGroups, recordSeenGroup } from './groups.ts'
import type { TelegramMessage } from './types.ts'

function msg(
  chat: { id: number; type: TelegramMessage['chat']['type']; title?: string },
  text = 'zdravo',
): TelegramMessage {
  return {
    message_id: 1,
    chat: { id: chat.id, type: chat.type, ...(chat.title ? { title: chat.title } : {}) },
    date: 0,
    from: { id: 7, is_bot: false, first_name: 'Miha' },
    text,
  }
}

describe('zaznavanje skupin', () => {
  let db: HGappDB

  beforeEach(() => {
    db = new HGappDB('test-groups-' + crypto.randomUUID())
  })
  afterEach(async () => {
    await db.delete()
  })

  it('zapomni si skupino, iz katere je bot kaj slišal', async () => {
    await recordSeenGroup(db, msg({ id: -100123, type: 'supergroup', title: 'Poker' }))

    const groups = await listSeenGroups(db)
    expect(groups).toEqual([{ chatId: '-100123', title: 'Poker' }])
  })

  it('zasebnih klepetov ne beleži — tam ni česa izbirati', async () => {
    await recordSeenGroup(db, msg({ id: 555, type: 'private' }))
    expect(await listSeenGroups(db)).toEqual([])
  })

  it('iste skupine ne podvoji', async () => {
    await recordSeenGroup(db, msg({ id: -100123, type: 'supergroup', title: 'Poker' }))
    await recordSeenGroup(db, msg({ id: -100123, type: 'supergroup', title: 'Poker' }))

    expect(await listSeenGroups(db)).toHaveLength(1)
  })

  it('sledi preimenovanju skupine', async () => {
    await recordSeenGroup(db, msg({ id: -100123, type: 'supergroup', title: 'Poker' }))
    await recordSeenGroup(db, msg({ id: -100123, type: 'supergroup', title: 'Petkov poker' }))

    const groups = await listSeenGroups(db)
    expect(groups).toEqual([{ chatId: '-100123', title: 'Petkov poker' }])
  })

  it('najnovejša skupina je na vrhu, seznam pa omejen', async () => {
    for (let i = 1; i <= 7; i++) {
      await recordSeenGroup(db, msg({ id: -i, type: 'group', title: `Skupina ${i}` }))
    }
    const groups = await listSeenGroups(db)
    expect(groups).toHaveLength(5)
    expect(groups[0]).toEqual({ chatId: '-7', title: 'Skupina 7' })
  })

  it('skupina brez imena dobi razumljivo oznako, ne prazne vrstice', async () => {
    await recordSeenGroup(db, msg({ id: -55, type: 'group' }))
    expect((await listSeenGroups(db))[0]?.title).toBe('Skupina brez imena')
  })
})
