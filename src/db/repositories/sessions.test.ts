import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HGappDB } from '../schema.ts'
import { createSession, transitionSessionStatus } from './sessions.ts'

describe('sessions', () => {
  let db: HGappDB

  beforeEach(() => {
    db = new HGappDB('test-sessions-' + crypto.randomUUID())
  })

  afterEach(async () => {
    await db.delete()
  })

  it('allows the documented sequence nacrtovana -> aktivna -> zakljucena -> poravnana', async () => {
    const session = await createSession(db, { defaultBuyInCents: 2000 })
    expect(session.status).toBe('nacrtovana')

    const active = await transitionSessionStatus(db, session.id, 'aktivna')
    expect(active.status).toBe('aktivna')
    expect(active.startedAt).not.toBeNull()

    const ended = await transitionSessionStatus(db, session.id, 'zakljucena')
    expect(ended.status).toBe('zakljucena')
    expect(ended.endedAt).not.toBeNull()

    const settled = await transitionSessionStatus(db, session.id, 'poravnana')
    expect(settled.status).toBe('poravnana')
    expect(settled.settledAt).not.toBeNull()
  })

  it('rejects an invalid transition (skipping a state)', async () => {
    const session = await createSession(db, { defaultBuyInCents: 2000 })
    await expect(transitionSessionStatus(db, session.id, 'zakljucena')).rejects.toThrow()
  })

  it('rejects a backwards transition', async () => {
    const session = await createSession(db, { defaultBuyInCents: 2000 })
    await transitionSessionStatus(db, session.id, 'aktivna')
    await expect(transitionSessionStatus(db, session.id, 'nacrtovana')).rejects.toThrow()
  })

  it('every transition is audited', async () => {
    const session = await createSession(db, { defaultBuyInCents: 2000 })
    await transitionSessionStatus(db, session.id, 'aktivna')
    const entries = await db.audit.where('entityId').equals(session.id).toArray()
    expect(entries.map((e) => e.action).sort()).toEqual(['create', 'status'])
  })
})
