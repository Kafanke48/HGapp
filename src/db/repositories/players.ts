import type { HGappDB } from '../schema.ts'
import type { Player } from '../types.ts'
import { newId, now } from '../ids.ts'
import { snapshot, withAudit } from '../audit.ts'

export interface CreatePlayerInput {
  name: string
  telegramUserId?: string | null
  telegramUsername?: string | null
}

export async function createPlayer(db: HGappDB, input: CreatePlayerInput): Promise<Player> {
  return withAudit(db, [db.players], async (audit) => {
    const timestamp = now()
    const player: Player = {
      id: newId(),
      name: input.name,
      telegramUserId: input.telegramUserId ?? null,
      telegramUsername: input.telegramUsername ?? null,
      archived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.players.add(player)
    audit.record({
      sessionId: null,
      entityTable: 'players',
      entityId: player.id,
      action: 'create',
      before: null,
      after: snapshot(player),
      versionAfter: null, // Player nima polja version — ni podvržen konfliktnemu preverjanju undo
    })
    return player
  })
}

export interface UpdatePlayerInput {
  name?: string
  telegramUserId?: string | null
  telegramUsername?: string | null
}

export async function updatePlayer(db: HGappDB, id: string, patch: UpdatePlayerInput): Promise<Player> {
  return withAudit(db, [db.players], async (audit) => {
    const existing = await db.players.get(id)
    if (!existing) throw new Error(`Igralec ${id} ne obstaja.`)
    // KLJUČNO: posnetek pred spremembo, preden karkoli mutiramo (glej audit.ts)
    const before = snapshot(existing)

    const updated: Player = {
      ...existing,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.telegramUserId !== undefined ? { telegramUserId: patch.telegramUserId } : {}),
      ...(patch.telegramUsername !== undefined ? { telegramUsername: patch.telegramUsername } : {}),
      updatedAt: now(),
    }
    await db.players.put(updated)
    audit.record({
      sessionId: null,
      entityTable: 'players',
      entityId: id,
      action: 'update',
      before,
      after: snapshot(updated),
      versionAfter: null,
    })
    return updated
  })
}

/** Arhiviranje je edini način "brisanja" igralca — vrstica ostane, izgine le iz privzetih seznamov. */
export async function archivePlayer(db: HGappDB, id: string): Promise<Player> {
  return setArchived(db, id, true)
}

export async function unarchivePlayer(db: HGappDB, id: string): Promise<Player> {
  return setArchived(db, id, false)
}

async function setArchived(db: HGappDB, id: string, archived: boolean): Promise<Player> {
  return withAudit(db, [db.players], async (audit) => {
    const existing = await db.players.get(id)
    if (!existing) throw new Error(`Igralec ${id} ne obstaja.`)
    const before = snapshot(existing)
    const updated: Player = { ...existing, archived, updatedAt: now() }
    await db.players.put(updated)
    audit.record({
      sessionId: null,
      entityTable: 'players',
      entityId: id,
      action: 'update',
      before,
      after: snapshot(updated),
      versionAfter: null,
    })
    return updated
  })
}

export async function getPlayer(db: HGappDB, id: string): Promise<Player | undefined> {
  return db.players.get(id)
}

export async function listPlayers(db: HGappDB, opts: { includeArchived?: boolean } = {}): Promise<Player[]> {
  const all = await db.players.toArray()
  return opts.includeArchived ? all : all.filter((p) => !p.archived)
}
