import { describe, it, expect } from 'vitest'
import { computeSettlement } from './engine.ts'
import { ObracunNapaka } from './types.ts'
import type { PlayerInput, SettlementInput, Transfer } from './types.ts'
import { sumCents } from '../money.ts'

/** Pomožno: gradi SettlementInput brez ponavljanja privzetih polj po vsakem testu. */
function mkInput(
  players: readonly PlayerInput[],
  overrides: Partial<Omit<SettlementInput, 'players'>> = {},
): SettlementInput {
  const base: SettlementInput = {
    players,
    discrepancy: null,
    expense: null,
    mode: 'blagajna',
  }
  return { ...base, ...overrides }
}

describe('computeSettlement — osnovni primeri', () => {
  it('en sam igralec, vse se izide', () => {
    const input = mkInput([{ playerId: 'p1', takenCents: 1000, paidCents: 1000, cashoutCents: 1000, paidOutCents: 0 }])
    const result = computeSettlement(input)
    expect(result.discrepancyCents).toBe(0)
    expect(result.netCents).toEqual({ p1: 0 })
    expect(result.payoutCents).toEqual({ p1: 1000 })
    expect(result.boxCents).toBe(1000)
    expect(result.transfers).toEqual([
      { fromPlayerId: null, toPlayerId: 'p1', amountCents: 1000, kind: 'iz_blagajne' },
    ])
  })

  it('vsi na nuli → brez transferjev', () => {
    const players: PlayerInput[] = [
      { playerId: 'p1', takenCents: 1000, paidCents: 0, cashoutCents: 1000, paidOutCents: 0 },
      { playerId: 'p2', takenCents: 1000, paidCents: 0, cashoutCents: 1000, paidOutCents: 0 },
      { playerId: 'p3', takenCents: 1000, paidCents: 0, cashoutCents: 1000, paidOutCents: 0 },
    ]
    const result = computeSettlement(mkInput(players))
    expect(result.netCents).toEqual({ p1: 0, p2: 0, p3: 0 })
    expect(result.payoutCents).toEqual({ p1: 0, p2: 0, p3: 0 })
    expect(result.boxCents).toBe(0)
    expect(result.transfers).toEqual([])
  })

  it('missing discrepancy resolution when discrepancy != 0 → throws', () => {
    const players: PlayerInput[] = [
      { playerId: 'p1', takenCents: 1000, paidCents: 1000, cashoutCents: 900, paidOutCents: 0 },
      { playerId: 'p2', takenCents: 1000, paidCents: 1000, cashoutCents: 1000, paidOutCents: 0 },
    ]
    expect(() => computeSettlement(mkInput(players, { discrepancy: null }))).toThrow(ObracunNapaka)
  })
})

describe('computeSettlement — štirje primeri iz spec 3.3 (buy-in 20 €)', () => {
  it('gotovina+plus, kredo+plus, kredo+minus, gotovina+minus dajo natanko pričakovana izplačila', () => {
    // Da vsota C ustreza vsoti B brez umazane matematike, dodamo "ponor" (sink)
    // igralca, na katerega z metodo 'pripisi' pripišemo celotno umetno neskladje.
    // Njegov obstoj ne vpliva na izplačila preostalih štirih — to je bistvo testa.
    const players: PlayerInput[] = [
      { playerId: 'cashWin', takenCents: 2000, paidCents: 2000, cashoutCents: 5000, paidOutCents: 0 },
      { playerId: 'kredoWin', takenCents: 2000, paidCents: 0, cashoutCents: 5000, paidOutCents: 0 },
      { playerId: 'kredoLoss', takenCents: 2000, paidCents: 0, cashoutCents: 500, paidOutCents: 0 },
      { playerId: 'cashLoss', takenCents: 2000, paidCents: 2000, cashoutCents: 500, paidOutCents: 0 },
      { playerId: 'sink', takenCents: 0, paidCents: 0, cashoutCents: 0, paidOutCents: 0 },
    ]
    const result = computeSettlement(
      mkInput(players, { discrepancy: { method: 'pripisi', playerId: 'sink' } }),
    )
    expect(result.discrepancyCents).toBe(3000) // ΣC (11000) − ΣB (8000)
    expect(result.payoutCents.cashWin).toBe(5000)
    expect(result.payoutCents.kredoWin).toBe(3000)
    expect(result.payoutCents.kredoLoss).toBe(-1500)
    expect(result.payoutCents.cashLoss).toBe(500)
    expect(result.payoutCents.sink).toBe(-3000)
    expect(sumCents(Object.values(result.netCents))).toBe(0)
    expect(sumCents(Object.values(result.payoutCents))).toBe(result.boxCents)
  })
})

describe('computeSettlement — razrešitev neskladja', () => {
  it('ostanek enega centa: neskladje −50 razdeljeno enakomerno na 3 → [17,17,16]', () => {
    const players: PlayerInput[] = [
      { playerId: 'p1', takenCents: 1000, paidCents: 0, cashoutCents: 1000, paidOutCents: 0 },
      { playerId: 'p2', takenCents: 1000, paidCents: 0, cashoutCents: 1000, paidOutCents: 0 },
      { playerId: 'p3', takenCents: 1000, paidCents: 0, cashoutCents: 950, paidOutCents: 0 },
    ]
    const result = computeSettlement(mkInput(players, { discrepancy: { method: 'enakomerno' } }))
    expect(result.discrepancyCents).toBe(-50)
    expect(result.discrepancyAdjustments).toEqual([
      { playerId: 'p1', deltaCents: 17, reason: expect.any(String) },
      { playerId: 'p2', deltaCents: 17, reason: expect.any(String) },
      { playerId: 'p3', deltaCents: 16, reason: expect.any(String) },
    ])
    expect(result.netCents).toEqual({ p1: 17, p2: 17, p3: -34 })
    expect(sumCents(Object.values(result.netCents))).toBe(0)
  })

  it('sorazmerna delitev neskladja, kjer je pomemben največji ostanek', () => {
    const players: PlayerInput[] = [
      { playerId: 'p1', takenCents: 2701, paidCents: 0, cashoutCents: 200, paidOutCents: 0 },
      { playerId: 'p2', takenCents: 0, paidCents: 0, cashoutCents: 300, paidOutCents: 0 },
      { playerId: 'p3', takenCents: 0, paidCents: 0, cashoutCents: 500, paidOutCents: 0 },
    ]
    // ΣC = 1000, ΣB = 2701 → neskladje = −1701, ciljna vsota popravkov = +1701
    // uteži [200,300,500]: točno 340.2 / 510.3 / 850.5 → ostanek gre p3 (največji decimalni del)
    const result = computeSettlement(mkInput(players, { discrepancy: { method: 'sorazmerno' } }))
    expect(result.discrepancyCents).toBe(-1701)
    expect(result.discrepancyAdjustments.map((a) => a.deltaCents)).toEqual([340, 510, 851])
    expect(result.netCents).toEqual({ p1: -2161, p2: 810, p3: 1351 })
    expect(sumCents(Object.values(result.netCents))).toBe(0)
  })

  it('sorazmerna delitev pade nazaj na enakomerno, če so vsi stacki 0', () => {
    const players: PlayerInput[] = [
      { playerId: 'p1', takenCents: 100, paidCents: 0, cashoutCents: 0, paidOutCents: 0 },
      { playerId: 'p2', takenCents: 100, paidCents: 0, cashoutCents: 0, paidOutCents: 0 },
    ]
    // ΣC=0, ΣB=200 → neskladje −200, a vsi cashouti so 0 → uteži same ničle
    const result = computeSettlement(mkInput(players, { discrepancy: { method: 'sorazmerno' } }))
    expect(result.discrepancyAdjustments.map((a) => a.deltaCents)).toEqual([100, 100])
    expect(sumCents(Object.values(result.netCents))).toBe(0)
  })

  it('pripiši enemu igralcu, ki ni udeleženec → vrže napako', () => {
    const players: PlayerInput[] = [
      { playerId: 'p1', takenCents: 1000, paidCents: 0, cashoutCents: 900, paidOutCents: 0 },
    ]
    expect(() =>
      computeSettlement(mkInput(players, { discrepancy: { method: 'pripisi', playerId: 'ne-obstaja' } })),
    ).toThrow(ObracunNapaka)
  })

  it('ročna razrešitev brez zapiska → vrže napako', () => {
    const players: PlayerInput[] = [
      { playerId: 'p1', takenCents: 1000, paidCents: 0, cashoutCents: 900, paidOutCents: 0 },
    ]
    expect(() =>
      computeSettlement(
        mkInput(players, {
          discrepancy: { method: 'rocno', adjustmentsCents: { p1: 100 }, note: '' },
        }),
      ),
    ).toThrow(ObracunNapaka)
  })

  it('ročna razrešitev, ki se ne izide z neskladjem → vrže napako', () => {
    const players: PlayerInput[] = [
      { playerId: 'p1', takenCents: 1000, paidCents: 0, cashoutCents: 900, paidOutCents: 0 },
    ]
    expect(() =>
      computeSettlement(
        mkInput(players, {
          discrepancy: { method: 'rocno', adjustmentsCents: { p1: 50 }, note: 'napačen popravek' },
        }),
      ),
    ).toThrow(ObracunNapaka)
  })

  it('ročna razrešitev z veljavnim zapiskom uspe', () => {
    const players: PlayerInput[] = [
      { playerId: 'p1', takenCents: 1000, paidCents: 0, cashoutCents: 900, paidOutCents: 0 },
    ]
    const result = computeSettlement(
      mkInput(players, {
        discrepancy: { method: 'rocno', adjustmentsCents: { p1: 100 }, note: 'našteli smo napačno' },
      }),
    )
    expect(result.netCents).toEqual({ p1: 0 })
  })
})

describe('computeSettlement — delitev stroškov', () => {
  it('neskladje IN strošek skupaj: preverjeni natančni končni centi', () => {
    const players: PlayerInput[] = [
      { playerId: 'p1', takenCents: 1000, paidCents: 1000, cashoutCents: 900, paidOutCents: 0 },
      { playerId: 'p2', takenCents: 1000, paidCents: 0, cashoutCents: 1000, paidOutCents: 0 },
      { playerId: 'p3', takenCents: 1000, paidCents: 1000, cashoutCents: 1050, paidOutCents: 0 },
    ]
    const result = computeSettlement(
      mkInput(players, {
        discrepancy: { method: 'enakomerno' },
        expense: { totalCents: 300, method: 'po_glavah', paidByPlayerId: 'p2' },
      }),
    )
    // neskladje: ΣC=2950, ΣB=3000 → −50, enakomerno [17,17,16] → p1:-83, p2:17, p3:66
    // strošek: 300/3=100, p2 dobi +300 nazaj → p1:-183, p2:217, p3:-34
    expect(result.netCents).toEqual({ p1: -183, p2: 217, p3: -34 })
    expect(result.payoutCents).toEqual({ p1: 817, p2: 217, p3: 966 })
    expect(result.boxCents).toBe(2000)
    expect(sumCents(Object.values(result.netCents))).toBe(0)
    expect(sumCents(Object.values(result.payoutCents))).toBe(result.boxCents)
  })

  it('"po dobičku", ko nihče ni v plusu → pade nazaj na "po glavah", zastavica nastavljena', () => {
    const players: PlayerInput[] = [
      { playerId: 'p1', takenCents: 1000, paidCents: 500, cashoutCents: 1000, paidOutCents: 0 },
      { playerId: 'p2', takenCents: 1000, paidCents: 500, cashoutCents: 1000, paidOutCents: 0 },
      { playerId: 'p3', takenCents: 1000, paidCents: 500, cashoutCents: 1000, paidOutCents: 0 },
    ]
    const result = computeSettlement(
      mkInput(players, {
        expense: { totalCents: 300, method: 'po_dobicku', paidByPlayerId: 'p2' },
      }),
    )
    expect(result.expenseFellBackToHeadcount).toBe(true)
    expect(result.netCents).toEqual({ p1: -100, p2: 200, p3: -100 })
    expect(sumCents(Object.values(result.netCents))).toBe(0)
  })

  it('založnik plača svoj delež in dobi poln povrat (5 igralcev, 3000 centov → +2400)', () => {
    const players: PlayerInput[] = Array.from({ length: 5 }, (_, i) => ({
      playerId: `p${i + 1}`,
      takenCents: 1000,
      paidCents: 1000,
      cashoutCents: 1000,
      paidOutCents: 0,
    }))
    const result = computeSettlement(
      mkInput(players, {
        expense: { totalCents: 3000, method: 'po_glavah', paidByPlayerId: 'p3' },
      }),
    )
    expect(result.netCents.p3).toBe(2400)
    const payerAdjustment = result.expenseAdjustments.find((a) => a.playerId === 'p3')
    expect(payerAdjustment?.deltaCents).toBe(2400)
    expect(sumCents(Object.values(result.netCents))).toBe(0)
  })
})

describe('computeSettlement — poravnalni načrt', () => {
  it('preferredCreditors se upošteva, preostanek gre po privzetem pravilu (p2p)', () => {
    // p1 dolguje 130. Preferira p2, a p2 terja le 30 → preostalih 100 gre p3 (edini drug prejemnik).
    const players: PlayerInput[] = [
      { playerId: 'p1', takenCents: 130, paidCents: 0, cashoutCents: 0, paidOutCents: 0 },
      { playerId: 'p2', takenCents: 0, paidCents: 0, cashoutCents: 30, paidOutCents: 0 },
      { playerId: 'p3', takenCents: 0, paidCents: 0, cashoutCents: 100, paidOutCents: 0 },
    ]
    const result = computeSettlement(
      mkInput(players, { mode: 'p2p', preferredCreditors: { p1: 'p2' } }),
    )
    expect(result.payoutCents).toEqual({ p1: -130, p2: 30, p3: 100 })
    expect(result.transfers).toEqual([
      { fromPlayerId: 'p1', toPlayerId: 'p2', amountCents: 30, kind: 'direktno' },
      { fromPlayerId: 'p1', toPlayerId: 'p3', amountCents: 100, kind: 'direktno' },
    ])
  })

  it('p2p način z nepraznо blagajno nastavi opozorilo p2pWithNonEmptyBox', () => {
    const players: PlayerInput[] = [
      { playerId: 'p1', takenCents: 1000, paidCents: 1000, cashoutCents: 1050, paidOutCents: 0 },
      { playerId: 'p2', takenCents: 1000, paidCents: 500, cashoutCents: 950, paidOutCents: 0 },
    ]
    const result = computeSettlement(mkInput(players, { mode: 'p2p' }))
    expect(result.p2pWithNonEmptyBox).toBe(true)
    expect(result.boxCents).toBe(1500) // Σ P velja ne glede na način
    expect(result.payoutCents).toEqual({ p1: 50, p2: -50 }) // v p2p je P=0 pri izračunu izplačila
    expect(result.transfers).toEqual([
      { fromPlayerId: 'p2', toPlayerId: 'p1', amountCents: 50, kind: 'direktno' },
    ])
  })

  it('blagajna: direktna nakazila najprej, preostanek iz blagajne', () => {
    const players: PlayerInput[] = [
      { playerId: 'debtor', takenCents: 1000, paidCents: 0, cashoutCents: 800, paidOutCents: 0 }, // net -200, payout -200
      { playerId: 'winner', takenCents: 1000, paidCents: 1000, cashoutCents: 1200, paidOutCents: 0 }, // net +200, payout +1200
    ]
    const result = computeSettlement(mkInput(players))
    expect(result.boxCents).toBe(1000)
    expect(result.payoutCents).toEqual({ debtor: -200, winner: 1200 })
    expect(result.transfers).toEqual([
      { fromPlayerId: 'debtor', toPlayerId: 'winner', amountCents: 200, kind: 'direktno' },
      { fromPlayerId: null, toPlayerId: 'winner', amountCents: 1000, kind: 'iz_blagajne' },
    ])
  })
})

describe('computeSettlement — lastnost negativnega izplačila', () => {
  it('negativno izplačilo lahko nastane izključno zaradi krede', () => {
    // Če vsak plača sproti (P = B), je izplačilo vedno C, torej nikoli negativno,
    // razen če je C samo negativen (fizično nemogoče za cashout).
    const players: PlayerInput[] = [
      { playerId: 'p1', takenCents: 2000, paidCents: 2000, cashoutCents: 0, paidOutCents: 0 },
      { playerId: 'p2', takenCents: 0, paidCents: 0, cashoutCents: 2000, paidOutCents: 0 },
    ]
    const result = computeSettlement(mkInput(players))
    // p1 je vzel 20€ in vse plačal sproti, a končal na 0 → izplačilo = cashout = 0, ne negativno.
    expect(result.payoutCents.p1).toBe(0)
    expect(result.payoutCents.p1).toBeGreaterThanOrEqual(0)
  })
})

// --- Deterministični PRNG (mulberry32) — brez Math.random, da je fuzz test ponovljiv. ---
function mulberry32(seed: number): () => number {
  let a = seed
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('computeSettlement — lastnostni (property) test', () => {
  it('za ~200 naključnih scenarijev veljajo vse invariante', () => {
    const rand = mulberry32(0xc0ffee)
    const randInt = (max: number) => Math.floor(rand() * max)
    const pick = <T,>(arr: readonly T[]): T => arr[randInt(arr.length)]!

    const discrepancyMethods = ['enakomerno', 'sorazmerno', 'pripisi', 'rocno'] as const
    const expenseMethods = ['po_glavah', 'po_dobicku'] as const

    for (let scenario = 0; scenario < 200; scenario++) {
      const n = 2 + randInt(5) // 2..6 igralcev
      const ids = Array.from({ length: n }, (_, i) => `player-${i}`)

      const players: PlayerInput[] = ids.map((playerId) => {
        const takenCents = randInt(5000)
        // paidCents je vedno <= takenCents, kot v resničnosti (ne moreš plačati več kot vzameš).
        const paidCents = randInt(takenCents + 1)
        const cashoutCents = randInt(10000)
        // Predčasno izplačilo omejimo na to, kar je ta igralec vplačal: tako
        // Σ paidOut <= Σ paid, blagajna torej nikoli ne pade pod nič in
        // ostanemo v fizično možnem stanju.
        const paidOutCents = randInt(paidCents + 1)
        return { playerId, takenCents, paidCents, cashoutCents, paidOutCents }
      })

      const sumC = sumCents(players.map((p) => p.cashoutCents))
      const sumB = sumCents(players.map((p) => p.takenCents))
      const discrepancyCents = sumC - sumB

      let discrepancy: SettlementInput['discrepancy'] = null
      if (discrepancyCents !== 0) {
        const methodName = pick(discrepancyMethods)
        const targetId = pick(ids)
        if (methodName === 'pripisi') {
          discrepancy = { method: 'pripisi', playerId: targetId }
        } else if (methodName === 'rocno') {
          discrepancy = {
            method: 'rocno',
            adjustmentsCents: { [targetId]: -discrepancyCents },
            note: 'fuzz test popravek',
          }
        } else {
          discrepancy = { method: methodName }
        }
      }

      let expense: SettlementInput['expense'] = null
      if (rand() < 0.5) {
        expense = {
          totalCents: randInt(5000),
          method: pick(expenseMethods),
          paidByPlayerId: pick(ids),
        }
      }

      const preferredCreditors: Record<string, string> = {}
      if (rand() < 0.5) {
        for (const id of ids) {
          if (rand() < 0.5) preferredCreditors[id] = pick(ids)
        }
      }

      // Način je vedno 'blagajna': invarianta "Σ payout === Σ P" po specifikaciji
      // velja za privzeti način. V p2p načinu je P namenoma ignoriran (glej ločen test).
      const input: SettlementInput = {
        players,
        discrepancy,
        expense,
        mode: 'blagajna',
        preferredCreditors,
      }

      const result = computeSettlement(input)

      // Blagajna je Σ P MINUS že izplačano med sejo (predčasni odhodi).
      const expectedBox =
        sumCents(players.map((p) => p.paidCents)) - sumCents(players.map((p) => p.paidOutCents))

      expect(sumCents(Object.values(result.netCents))).toBe(0)
      expect(sumCents(Object.values(result.payoutCents))).toBe(expectedBox)
      expect(result.boxCents).toBe(expectedBox)

      const netEffect: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]))
      for (const t of result.transfers as Transfer[]) {
        expect(t.amountCents).toBeGreaterThan(0)
        if (t.toPlayerId !== null) netEffect[t.toPlayerId] = (netEffect[t.toPlayerId] ?? 0) + t.amountCents
        if (t.fromPlayerId !== null) netEffect[t.fromPlayerId] = (netEffect[t.fromPlayerId] ?? 0) - t.amountCents
      }
      for (const id of ids) {
        expect(netEffect[id]).toBe(result.payoutCents[id])
      }
    }
  })
})
