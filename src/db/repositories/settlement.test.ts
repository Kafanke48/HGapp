import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HGappDB } from '../schema.ts'
import { addSessionPlayer, createSession, transitionSessionStatus } from './sessions.ts'
import { createBuyIn } from './buyins.ts'
import { setCashout } from './cashouts.ts'
import { computeForSession, finalizeSettlement } from './settlement.ts'

describe('settlement repository', () => {
  let db: HGappDB

  beforeEach(() => {
    db = new HGappDB('test-settlement-' + crypto.randomUUID())
  })

  afterEach(async () => {
    await db.delete()
  })

  it('computes and finalizes a settlement with a direct debt plus a box payout, without a discrepancy', async () => {
    const session = await createSession(db, { defaultBuyInCents: 2000 })
    const sp1 = await addSessionPlayer(db, session.id, 'p1', 0)
    const sp2 = await addSessionPlayer(db, session.id, 'p2', 1)

    // p1 plača gotovino, konča z več, kot je vzel.
    await createBuyIn(db, { sessionId: session.id, playerId: 'p1', amountCents: 2000, paymentMethod: 'gotovina' })
    // p2 vzame na kredo in konča z manj, kot je vzel -> postane plačnik (dolžnik).
    await createBuyIn(db, { sessionId: session.id, playerId: 'p2', amountCents: 2000, paymentMethod: 'kredo' })

    await setCashout(db, sp1.id, 3500)
    await setCashout(db, sp2.id, 500)

    await transitionSessionStatus(db, session.id, 'aktivna')
    await transitionSessionStatus(db, session.id, 'zakljucena')

    const result = await computeForSession(db, session.id)
    expect(result.discrepancyCents).toBe(0)
    expect(result.boxCents).toBe(2000)
    expect(result.payoutCents['p1']).toBe(3500)
    expect(result.payoutCents['p2']).toBe(-1500)

    const { lines, debts, discrepancy } = await finalizeSettlement(db, session.id, result)

    expect(discrepancy).toBeNull()
    expect(lines).toHaveLength(2)

    const directLine = lines.find((l) => l.kind === 'direktno')
    expect(directLine).toMatchObject({ fromPlayerId: 'p2', toPlayerId: 'p1', amountCents: 1500 })

    const boxLine = lines.find((l) => l.kind === 'iz_blagajne')
    expect(boxLine).toMatchObject({ fromPlayerId: null, toPlayerId: 'p1', amountCents: 2000 })

    // Samo p2->p1 (direktno) ustvari dolg; izplačilo iz blagajne ne ustvari dolga.
    expect(debts).toHaveLength(1)
    expect(debts[0]).toMatchObject({
      debtorPlayerId: 'p2',
      creditorPlayerId: 'p1',
      originalCents: 1500,
      status: 'odprto',
    })

    const settledSession = await db.sessions.get(session.id)
    expect(settledSession?.status).toBe('poravnana')
  })

  it('finalizeSettlement refuses to run unless the session is zakljucena', async () => {
    const session = await createSession(db, { defaultBuyInCents: 2000 })
    await addSessionPlayer(db, session.id, 'p1', 0)
    await setCashout(db, (await db.sessionPlayers.where('sessionId').equals(session.id).first())!.id, 0)

    const result = await computeForSession(db, session.id)
    await expect(finalizeSettlement(db, session.id, result)).rejects.toThrow()
  })
})
