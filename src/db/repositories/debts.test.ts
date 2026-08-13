import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HGappDB } from '../schema.ts'
import type { OpenDebt } from '../types.ts'
import { listOpenDebts, recordPayment } from './debts.ts'

async function seedDebt(db: HGappDB, overrides: Partial<OpenDebt> = {}): Promise<OpenDebt> {
  const debt: OpenDebt = {
    id: 'debt-1',
    sessionId: 's1',
    settlementLineId: null,
    debtorPlayerId: 'p1',
    creditorPlayerId: 'p2',
    originalCents: 5000,
    paidCents: 0,
    status: 'odprto',
    note: null,
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
  await db.openDebts.add(debt)
  return debt
}

describe('debts', () => {
  let db: HGappDB

  beforeEach(() => {
    db = new HGappDB('test-debts-' + crypto.randomUUID())
  })

  afterEach(async () => {
    await db.delete()
  })

  it('a partial payment moves the debt to delno', async () => {
    await seedDebt(db)
    const updated = await recordPayment(db, 'debt-1', 2000)
    expect(updated.status).toBe('delno')
    expect(updated.paidCents).toBe(2000)
  })

  it('paying the remainder moves the debt to placano', async () => {
    await seedDebt(db)
    await recordPayment(db, 'debt-1', 2000)
    const final = await recordPayment(db, 'debt-1', 3000)
    expect(final.status).toBe('placano')
    expect(final.paidCents).toBe(5000)
  })

  it('rejects overpayment', async () => {
    await seedDebt(db)
    await recordPayment(db, 'debt-1', 2000)
    await expect(recordPayment(db, 'debt-1', 4000)).rejects.toThrow()
  })

  it('rejects a non-positive payment', async () => {
    await seedDebt(db)
    await expect(recordPayment(db, 'debt-1', 0)).rejects.toThrow()
    await expect(recordPayment(db, 'debt-1', -100)).rejects.toThrow()
  })

  it('records a DebtPayment row for each payment', async () => {
    await seedDebt(db)
    await recordPayment(db, 'debt-1', 1000)
    await recordPayment(db, 'debt-1', 500)
    const payments = await db.debtPayments.where('debtId').equals('debt-1').toArray()
    expect(payments).toHaveLength(2)
  })

  it('listOpenDebts returns odprto and delno but not placano, across sessions', async () => {
    await seedDebt(db, { id: 'd-open', sessionId: 's1' })
    await seedDebt(db, { id: 'd-partial', sessionId: 's2', paidCents: 1000, status: 'delno' })
    await seedDebt(db, { id: 'd-paid', sessionId: 's3', paidCents: 5000, status: 'placano' })

    const open = await listOpenDebts(db)
    const ids = open.map((d) => d.id).sort()
    expect(ids).toEqual(['d-open', 'd-partial'])
  })
})
