import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HGappDB } from '../schema.ts'
import { createBuyIn, derivePaidCents, sessionTotals, setConfirmation, voidBuyIn } from './buyins.ts'

describe('buyins', () => {
  let db: HGappDB

  beforeEach(() => {
    db = new HGappDB('test-buyins-' + crypto.randomUUID())
  })

  afterEach(async () => {
    await db.delete()
  })

  it('derives paidCents correctly for all three payment methods', () => {
    expect(derivePaidCents('gotovina', 2000)).toBe(2000)
    expect(derivePaidCents('nakazilo', 2000)).toBe(2000)
    expect(derivePaidCents('kredo', 2000)).toBe(0)
  })

  it('createBuyIn stores the derived paidCents on the row', async () => {
    const cash = await createBuyIn(db, { sessionId: 's1', playerId: 'p1', amountCents: 2000, paymentMethod: 'gotovina' })
    const wire = await createBuyIn(db, { sessionId: 's1', playerId: 'p1', amountCents: 3000, paymentMethod: 'nakazilo' })
    const credit = await createBuyIn(db, { sessionId: 's1', playerId: 'p1', amountCents: 1500, paymentMethod: 'kredo' })

    expect(cash.paidCents).toBe(2000)
    expect(wire.paidCents).toBe(3000)
    expect(credit.paidCents).toBe(0)
  })

  it('sessionTotals excludes voided buy-ins but includes rejected ones, and boxCents matches sum of paidCents', async () => {
    const b1 = await createBuyIn(db, { sessionId: 's1', playerId: 'p1', amountCents: 2000, paymentMethod: 'gotovina' })
    await createBuyIn(db, { sessionId: 's1', playerId: 'p1', amountCents: 1000, paymentMethod: 'kredo' })
    const rejected = await createBuyIn(db, { sessionId: 's1', playerId: 'p2', amountCents: 2000, paymentMethod: 'gotovina' })
    await setConfirmation(db, rejected.id, 'zavrnjen', 'ni prepoznal zneska')
    const voidedOne = await createBuyIn(db, { sessionId: 's1', playerId: 'p2', amountCents: 5000, paymentMethod: 'gotovina' })
    await voidBuyIn(db, voidedOne.id)

    const totals = await sessionTotals(db, 's1')

    // p1: 2000 (gotovina) + 1000 (kredo, ne v P) => taken 3000, paid 2000
    expect(totals.perPlayer['p1']).toEqual({ takenCents: 3000, paidCents: 2000 })
    // p2: zavrnjen šteje normalno (taken 2000, paid 2000), voided ne šteje sploh
    expect(totals.perPlayer['p2']).toEqual({ takenCents: 2000, paidCents: 2000 })

    const expectedBox = Object.values(totals.perPlayer).reduce((sum, p) => sum + p.paidCents, 0)
    expect(totals.boxCents).toBe(expectedBox)
    expect(totals.boxCents).toBe(4000)
    void b1
  })

  it('voidBuyIn never hard-deletes the row', async () => {
    const buyIn = await createBuyIn(db, { sessionId: 's1', playerId: 'p1', amountCents: 2000, paymentMethod: 'gotovina' })
    await voidBuyIn(db, buyIn.id)
    const stillThere = await db.buyIns.get(buyIn.id)
    expect(stillThere).toBeDefined()
    expect(stillThere?.voided).toBe(true)
  })
})
