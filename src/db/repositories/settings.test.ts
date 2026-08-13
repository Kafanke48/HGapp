import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HGappDB, DEFAULT_SETTINGS } from '../schema.ts'
import { getSettings, updateSettings } from './settings.ts'

describe('settings', () => {
  let db: HGappDB

  beforeEach(() => {
    db = new HGappDB('test-settings-' + crypto.randomUUID())
  })

  afterEach(async () => {
    await db.delete()
  })

  it('getSettings creates the singleton row on first call', async () => {
    expect(await db.settings.get('singleton')).toBeUndefined()
    const settings = await getSettings(db)
    expect(settings).toEqual(DEFAULT_SETTINGS)
    expect(await db.settings.get('singleton')).toEqual(DEFAULT_SETTINGS)
  })

  it('getSettings merges DEFAULT_SETTINGS under whatever is stored', async () => {
    await updateSettings(db, { defaultBuyInCents: 5000 })
    const settings = await getSettings(db)
    expect(settings.defaultBuyInCents).toBe(5000)
    // Ostala polja ostanejo privzeta.
    expect(settings.defaultSettlementMode).toBe(DEFAULT_SETTINGS.defaultSettlementMode)
  })

  it('updateSettings persists a patch without needing a prior getSettings call', async () => {
    const updated = await updateSettings(db, { telegramGroupChatId: '-1001', hostPlayerId: 'p1' })
    expect(updated.telegramGroupChatId).toBe('-1001')
    expect(updated.hostPlayerId).toBe('p1')
    expect(updated.id).toBe('singleton')
  })

  it('every settings write is audited', async () => {
    await getSettings(db)
    await updateSettings(db, { defaultBuyInCents: 3000 })
    const entries = await db.audit.where('entityId').equals('singleton').toArray()
    expect(entries.map((e) => e.action).sort()).toEqual(['create', 'update'])
  })
})
