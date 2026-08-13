import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HGappDB } from './schema.ts'
import { revertAuditEntry, UndoConflictError, withAudit } from './audit.ts'
import { createBuyIn, voidBuyIn } from './repositories/buyins.ts'

describe('audit', () => {
  let db: HGappDB

  beforeEach(() => {
    db = new HGappDB('test-audit-' + crypto.randomUUID())
  })

  afterEach(async () => {
    await db.delete()
  })

  it('writes the entity change and an audit entry atomically', async () => {
    const buyIn = await createBuyIn(db, {
      sessionId: 's1',
      playerId: 'p1',
      amountCents: 2000,
      paymentMethod: 'gotovina',
    })

    const stored = await db.buyIns.get(buyIn.id)
    expect(stored).toBeDefined()

    const entries = await db.audit.where('entityId').equals(buyIn.id).toArray()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.action).toBe('create')
    expect(entries[0]?.entityTable).toBe('buyIns')
    expect(entries[0]?.versionAfter).toBe(1)
  })

  it('rolls back both the entity write and the audit write if the transaction fails', async () => {
    await expect(
      withAudit(db, [db.buyIns], async (audit) => {
        await db.buyIns.add({
          id: 'fail-1',
          sessionId: 's1',
          playerId: 'p1',
          kind: 'buyin',
          amountCents: 1000,
          paymentMethod: 'gotovina',
          paidCents: 1000,
          confirmation: 'nepotrjen',
          rejectionReason: null,
          voided: false,
          note: null,
          version: 1,
          createdAt: 0,
          updatedAt: 0,
        })
        audit.record({
          sessionId: 's1',
          entityTable: 'buyIns',
          entityId: 'fail-1',
          action: 'create',
          before: null,
          after: null,
          versionAfter: 1,
        })
        throw new Error('simulirana napaka')
      }),
    ).rejects.toThrow('simulirana napaka')

    expect(await db.buyIns.get('fail-1')).toBeUndefined()
    expect(await db.audit.where('entityId').equals('fail-1').toArray()).toHaveLength(0)
  })

  it('snapshot taken before mutation is not affected by later changes to the live object', async () => {
    const buyIn = await createBuyIn(db, {
      sessionId: 's1',
      playerId: 'p1',
      amountCents: 2000,
      paymentMethod: 'gotovina',
    })
    await voidBuyIn(db, buyIn.id)

    const voidEntry = await db.audit
      .where('entityId')
      .equals(buyIn.id)
      .and((e) => e.action === 'void')
      .first()
    expect(voidEntry).toBeDefined()
    // "before" posnetek mora še vedno kazati voided: false, kljub temu, da je
    // živa vrstica zdaj voided: true.
    expect((voidEntry?.before as { voided: boolean }).voided).toBe(false)
    expect((voidEntry?.after as { voided: boolean }).voided).toBe(true)
  })

  it('undo of a create removes the row and appends an undo entry, leaving the original untouched', async () => {
    const buyIn = await createBuyIn(db, {
      sessionId: 's1',
      playerId: 'p1',
      amountCents: 2000,
      paymentMethod: 'gotovina',
    })
    const createEntry = await db.audit.where('entityId').equals(buyIn.id).first()
    expect(createEntry).toBeDefined()

    await revertAuditEntry(db, createEntry!.id)

    expect(await db.buyIns.get(buyIn.id)).toBeUndefined()

    const allEntries = await db.audit.where('entityId').equals(buyIn.id).toArray()
    expect(allEntries).toHaveLength(2)
    const original = allEntries.find((e) => e.action === 'create')
    const undo = allEntries.find((e) => e.action === 'undo')
    expect(original).toEqual(createEntry) // izvirni zapis nedotaknjen
    expect(undo).toBeDefined()
    expect(undo?.before).toEqual(createEntry?.after)
  })

  it('blocks undo with UndoConflictError when the version moved on since the recorded entry', async () => {
    const buyIn = await createBuyIn(db, {
      sessionId: 's1',
      playerId: 'p1',
      amountCents: 2000,
      paymentMethod: 'gotovina',
    })
    const createEntry = await db.audit.where('entityId').equals(buyIn.id).first()

    // Vrstica se spremeni (version 1 -> 2) po tem, ko je bil izvirni zapis narejen.
    await voidBuyIn(db, buyIn.id)

    await expect(revertAuditEntry(db, createEntry!.id)).rejects.toThrow(UndoConflictError)
    // Živa vrstica ostane nedotaknjena.
    const stillThere = await db.buyIns.get(buyIn.id)
    expect(stillThere?.voided).toBe(true)
  })
})
