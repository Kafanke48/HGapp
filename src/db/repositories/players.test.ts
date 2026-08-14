import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HGappDB } from '../schema.ts'
import { archivePlayer, createPlayer, listPlayers, unarchivePlayer, updatePlayer } from './players.ts'

describe('players', () => {
  let db: HGappDB

  beforeEach(() => {
    db = new HGappDB('test-players-' + crypto.randomUUID())
  })

  afterEach(async () => {
    await db.delete()
  })

  it('createPlayer stores a new, non-archived player', async () => {
    const player = await createPlayer(db, { name: 'Ana' })

    expect(player.name).toBe('Ana')
    expect(player.archived).toBe(false)
    expect(player.telegramUserId).toBeNull()
    expect(player.telegramUsername).toBeNull()

    const stored = await db.players.get(player.id)
    expect(stored).toEqual(player)
  })

  it('updatePlayer renames a player without touching other fields', async () => {
    const player = await createPlayer(db, { name: 'Ana', telegramUserId: '123' })

    const renamed = await updatePlayer(db, player.id, { name: 'Anamarija' })

    expect(renamed.name).toBe('Anamarija')
    expect(renamed.telegramUserId).toBe('123') // ni bilo v popravku - ostane nedotaknjeno
    expect(renamed.id).toBe(player.id)
    expect(renamed.updatedAt).toBeGreaterThanOrEqual(player.updatedAt)
  })

  it('archivePlayer hides the player from the default list but keeps the row', async () => {
    const active = await createPlayer(db, { name: 'Bine' })
    const archived = await createPlayer(db, { name: 'Ciril' })

    await archivePlayer(db, archived.id)

    const defaultList = await listPlayers(db)
    expect(defaultList.map((p) => p.id)).toEqual([active.id])

    // Vrstica ostane v bazi - arhiviranje je edini način "brisanja" (glej types.ts).
    const stillThere = await db.players.get(archived.id)
    expect(stillThere).toBeDefined()
    expect(stillThere?.archived).toBe(true)

    const withArchived = await listPlayers(db, { includeArchived: true })
    expect(withArchived.map((p) => p.id).sort()).toEqual([active.id, archived.id].sort())
  })

  it('unarchivePlayer restores the player to the default list', async () => {
    const player = await createPlayer(db, { name: 'Davorin' })
    await archivePlayer(db, player.id)
    expect((await listPlayers(db)).map((p) => p.id)).toEqual([])

    const restored = await unarchivePlayer(db, player.id)

    expect(restored.archived).toBe(false)
    expect((await listPlayers(db)).map((p) => p.id)).toEqual([player.id])
  })

  it('archiving is idempotent and every archive/unarchive step is audited', async () => {
    const player = await createPlayer(db, { name: 'Erik' })
    await archivePlayer(db, player.id)
    await archivePlayer(db, player.id) // ponovno arhiviranje - ne sme vreči napake
    await unarchivePlayer(db, player.id)

    // Dexie ne zagotavlja vrstnega reda po vstavljanju za poizvedbo po indeksu
    // `entityId` (id-ji zapisov so naključni UUID-ji) - preverimo torej
    // množico dejanj, ne točnega zaporedja.
    const entries = await db.audit.where('entityId').equals(player.id).toArray()
    expect(entries.map((e) => e.action).sort()).toEqual(['create', 'update', 'update', 'update'])
  })
})
