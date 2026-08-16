import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HGappDB } from '../schema.ts'
import { createPlayer } from './players.ts'
import { addSessionPlayer, createSession, transitionSessionStatus } from './sessions.ts'
import { createBuyIn, sessionTotals } from './buyins.ts'
import { recordEarlyCashout, sessionPaidOutTotal, undoEarlyCashout } from './cashouts.ts'
import { computeForSession } from './settlement.ts'

/**
 * Predčasni odhod je edina sprememba, ki premakne denar IZ blagajne med sejo.
 * Ti testi varujejo invarianto, da vsota preostalih terjatev ostane natanko
 * enaka temu, kar je še v blagajni.
 */
describe('predčasni odhod med sejo', () => {
  let db: HGappDB

  beforeEach(() => {
    db = new HGappDB('test-early-' + crypto.randomUUID())
  })
  afterEach(async () => {
    await db.delete()
  })

  /** Tri igralce, vsak vplača 20 € v gotovini. Blagajna: 60 €. */
  async function setup() {
    const players = await Promise.all([
      createPlayer(db, { name: 'Miha' }),
      createPlayer(db, { name: 'Ana' }),
      createPlayer(db, { name: 'Bine' }),
    ])
    const session = await createSession(db, { defaultBuyInCents: 2000 })
    await transitionSessionStatus(db, session.id, 'aktivna')
    const seats = []
    for (const [i, p] of players.entries()) {
      seats.push(await addSessionPlayer(db, session.id, p.id, i))
      await createBuyIn(db, {
        sessionId: session.id,
        playerId: p.id,
        amountCents: 2000,
        paymentMethod: 'gotovina',
      })
    }
    return { session, players, seats }
  }

  it('izplačilo ob odhodu zmanjša blagajno za natanko ta znesek', async () => {
    const { session, seats } = await setup()

    expect((await sessionTotals(db, session.id)).boxCents).toBe(6000)
    expect(await sessionPaidOutTotal(db, session.id)).toBe(0)

    // Miha odide s 35 € žetonov in denar vzame takoj.
    await recordEarlyCashout(db, seats[0]!.id, 3500, 3500)

    // sessionTotals šteje samo vplačila; izplačano je ločen člen.
    expect((await sessionTotals(db, session.id)).boxCents).toBe(6000)
    expect(await sessionPaidOutTotal(db, session.id)).toBe(3500)
    // Dejansko v blagajni: 60 € − 35 € = 25 €.
    expect(6000 - (await sessionPaidOutTotal(db, session.id))).toBe(2500)
  })

  it('poravnava poravnanemu igralcu ne pripiše ničesar, vsota pa se izide', async () => {
    const { session, seats } = await setup()

    // Σ C mora biti enaka Σ B (60 €), sicer bi šlo za neskladje žetonov.
    await recordEarlyCashout(db, seats[0]!.id, 3500, 3500) // Miha odide, vzame denar
    await db.sessionPlayers.update(seats[1]!.id, { cashoutCents: 1500 })
    await db.sessionPlayers.update(seats[2]!.id, { cashoutCents: 1000 })
    await transitionSessionStatus(db, session.id, 'zakljucena')

    const result = await computeForSession(db, session.id)

    expect(result.boxCents).toBe(2500)
    expect(result.payoutCents[seats[0]!.playerId]).toBe(0) // že poravnan
    expect(result.payoutCents[seats[1]!.playerId]).toBe(1500)
    expect(result.payoutCents[seats[2]!.playerId]).toBe(1000)

    const sum = Object.values(result.payoutCents).reduce((a, b) => a + b, 0)
    expect(sum).toBe(result.boxCents)
  })

  it('odhod brez izplačila pusti blagajno pri miru', async () => {
    const { session, seats } = await setup()

    // Igralec odide, denar pa pusti do konca večera.
    await recordEarlyCashout(db, seats[0]!.id, 3500, 0)

    expect(await sessionPaidOutTotal(db, session.id)).toBe(0)

    await db.sessionPlayers.update(seats[1]!.id, { cashoutCents: 1500 })
    await db.sessionPlayers.update(seats[2]!.id, { cashoutCents: 1000 })
    await transitionSessionStatus(db, session.id, 'zakljucena')

    const result = await computeForSession(db, session.id)
    expect(result.boxCents).toBe(6000)
    expect(result.payoutCents[seats[0]!.playerId]).toBe(3500) // mu še pripada
  })

  it('vrnitev za mizo počisti odhod, izplačanega denarja pa ne pobriše', async () => {
    const { seats } = await setup()

    await recordEarlyCashout(db, seats[0]!.id, 3500, 3500)
    const back = await undoEarlyCashout(db, seats[0]!.id)

    expect(back.cashoutCents).toBeNull()
    expect(back.leftAt).toBeNull()
    // Denar je zamenjal roke — evidenca o tem mora ostati.
    expect(back.paidOutCents).toBe(3500)
  })

  it('negativni zneski so zavrnjeni', async () => {
    const { seats } = await setup()
    await expect(recordEarlyCashout(db, seats[0]!.id, -1, 0)).rejects.toThrow()
    await expect(recordEarlyCashout(db, seats[0]!.id, 1000, -1)).rejects.toThrow()
  })
})
