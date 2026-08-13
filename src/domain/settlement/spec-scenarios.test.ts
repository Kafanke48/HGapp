/**
 * Neodvisna preverba proti specifikaciji.
 *
 * Ti testi so napisani ločeno od `engine.test.ts` in namenoma podvajajo del
 * pokritosti: preverjajo natanko tiste primere, ki so v specifikaciji zapisani
 * s številkami (razdelka 3.3 in 4.3), po načelu "test naj napiše nekdo drug kot
 * implementacijo". Če se specifikacija in koda kdaj razideta, pade tukaj.
 */
import { describe, expect, it } from 'vitest'
import { computeSettlement } from './engine.ts'
import type { PlayerInput, SettlementInput } from './types.ts'

function player(
  playerId: string,
  takenCents: number,
  paidCents: number,
  cashoutCents: number,
): PlayerInput {
  return { playerId, takenCents, paidCents, cashoutCents }
}

function run(players: PlayerInput[], overrides: Partial<SettlementInput> = {}) {
  return computeSettlement({
    players,
    discrepancy: null,
    expense: null,
    mode: 'blagajna',
    ...overrides,
  })
}

describe('spec 3.3 — štiri vrstice tabele izplačil', () => {
  // Vsi štirje primeri uporabljajo buy-in 20 €. Da ostane vsota žetonov enaka
  // vsoti buy-inov (brez neskladja), je vsakemu primeru dodan protiigralec.
  it('plačal gotovino, konča s 50 € → dobi 50 €', () => {
    const r = run([player('a-igralec', 2000, 2000, 5000), player('b-nasprotnik', 4000, 4000, 1000)])
    expect(r.discrepancyCents).toBe(0)
    expect(r.payoutCents['a-igralec']).toBe(5000)
  })

  it('vzel na kredo, konča s 50 € → dobi 30 €, kredo je poplačan', () => {
    const r = run([player('a-igralec', 2000, 0, 5000), player('b-nasprotnik', 4000, 4000, 1000)])
    expect(r.payoutCents['a-igralec']).toBe(3000)
    // Blagajna vsebuje samo denar nasprotnika.
    expect(r.boxCents).toBe(4000)
  })

  it('vzel na kredo, konča s 5 € → VPLAČA 15 €', () => {
    const r = run([player('a-igralec', 2000, 0, 500), player('b-nasprotnik', 2000, 2000, 3500)])
    expect(r.payoutCents['a-igralec']).toBe(-1500)
  })

  it('plačal gotovino, konča s 5 € → dobi 5 € nazaj', () => {
    const r = run([player('a-igralec', 2000, 2000, 500), player('b-nasprotnik', 2000, 2000, 3500)])
    expect(r.payoutCents['a-igralec']).toBe(500)
  })
})

describe('spec 3.2 — invarianti', () => {
  it('vsota izplačil je natanko enaka blagajni', () => {
    const players = [
      player('ana', 6000, 6000, 2000),
      player('bor', 4000, 0, 9000),
      player('cene', 5000, 5000, 4000),
    ]
    const r = run(players)
    const sumPayout = Object.values(r.payoutCents).reduce((a, b) => a + b, 0)
    expect(sumPayout).toBe(r.boxCents)
    expect(r.boxCents).toBe(11000)
  })

  it('negativno izplačilo se pojavi izključno pri kredi', () => {
    // Nihče ni vzel na kredo → P === B za vse → nobeno izplačilo ni negativno.
    const r = run([
      player('ana', 3000, 3000, 100),
      player('bor', 3000, 3000, 5900),
      player('cene', 3000, 3000, 3000),
    ])
    for (const v of Object.values(r.payoutCents)) expect(v).toBeGreaterThanOrEqual(0)
  })
})

describe('spec 4.3 — načrt: dolžnik nakaže največjemu zmagovalcu, ostalo iz blagajne', () => {
  it('kredo dolžnik plača direktno, preostanek pokrije blagajna', () => {
    const r = run([player('miha', 2000, 0, 500), player('ana', 2000, 2000, 3500)])

    const direktno = r.transfers.filter((t) => t.kind === 'direktno')
    const izBlagajne = r.transfers.filter((t) => t.kind === 'iz_blagajne')

    expect(direktno).toEqual([
      { fromPlayerId: 'miha', toPlayerId: 'ana', amountCents: 1500, kind: 'direktno' },
    ])
    expect(izBlagajne).toEqual([
      { fromPlayerId: null, toPlayerId: 'ana', amountCents: 2000, kind: 'iz_blagajne' },
    ])
    // Iz blagajne se izplača natanko toliko, kolikor je v njej.
    expect(izBlagajne.reduce((s, t) => s + t.amountCents, 0)).toBe(r.boxCents)
  })

  it('privzeti prejemnik je največji zmagovalec, ne prvi po abecedi', () => {
    const r = run([
      player('a-mali-zmagovalec', 2000, 2000, 2500),
      player('b-veliki-zmagovalec', 2000, 2000, 4000),
      player('c-dolznik', 3000, 0, 500),
    ])
    const direktno = r.transfers.filter((t) => t.kind === 'direktno')
    expect(direktno[0]?.toPlayerId).toBe('b-veliki-zmagovalec')
  })

  it('izbran prejemnik prevlada nad privzetim', () => {
    const r = run(
      [
        player('a-mali-zmagovalec', 2000, 2000, 2500),
        player('b-veliki-zmagovalec', 2000, 2000, 4000),
        player('c-dolznik', 3000, 0, 500),
      ],
      { preferredCreditors: { 'c-dolznik': 'a-mali-zmagovalec' } },
    )
    const direktno = r.transfers.filter((t) => t.kind === 'direktno')
    expect(direktno[0]?.toPlayerId).toBe('a-mali-zmagovalec')
    // Vsota se mora izidti tudi po ročni izbiri.
    const sumPayout = Object.values(r.payoutCents).reduce((a, b) => a + b, 0)
    expect(sumPayout).toBe(r.boxCents)
  })
})

describe('spec 4.6 — delitev stroškov', () => {
  it('založnik plača svoj delež in prejme povrnjen celoten znesek', () => {
    // 5 igralcev, strošek 30 € po glavah = 6 € vsak.
    // Založnik: −6 € delež + 30 € povračilo = neto učinek +24 €.
    const players = Array.from({ length: 5 }, (_, i) =>
      player(`igralec-${i}`, 2000, 2000, 2000),
    )
    const r = run(players, {
      expense: { totalCents: 3000, method: 'po_glavah', paidByPlayerId: 'igralec-0' },
    })
    expect(r.netCents['igralec-0']).toBe(2400)
    expect(r.netCents['igralec-1']).toBe(-600)
    expect(Object.values(r.netCents).reduce((a, b) => a + b, 0)).toBe(0)
  })

  it('po dobičku brez zmagovalcev pade nazaj na po glavah in to javi', () => {
    const players = Array.from({ length: 3 }, (_, i) => player(`igralec-${i}`, 2000, 2000, 2000))
    const r = run(players, {
      expense: { totalCents: 1000, method: 'po_dobicku', paidByPlayerId: 'igralec-0' },
    })
    expect(r.expenseFellBackToHeadcount).toBe(true)
  })
})

describe('spec 4.7 — zaokroževanje', () => {
  it('neskladje 50 centov na 3 igralce da 17/17/16 in se izide', () => {
    // Σ B = 6000, Σ C = 5950 → neskladje −50.
    const r = run(
      [
        player('a', 2000, 2000, 2000),
        player('b', 2000, 2000, 2000),
        player('c', 2000, 2000, 1950),
      ],
      { discrepancy: { method: 'enakomerno' } },
    )
    expect(r.discrepancyCents).toBe(-50)
    expect(r.discrepancyAdjustments.map((a) => a.deltaCents)).toEqual([17, 17, 16])
    expect(Object.values(r.netCents).reduce((a, b) => a + b, 0)).toBe(0)
  })

  it('neskladje brez izbrane razrešitve vrže napako namesto tihega popravka', () => {
    expect(() =>
      run([player('a', 2000, 2000, 2000), player('b', 2000, 2000, 1950)]),
    ).toThrow()
  })
})

describe('spec 4.5 — P2P opozorilo', () => {
  it('P2P z denarjem v blagajni sproži opozorilo', () => {
    const r = run([player('a', 2000, 2000, 500), player('b', 2000, 2000, 3500)], { mode: 'p2p' })
    expect(r.p2pWithNonEmptyBox).toBe(true)
    expect(r.transfers.every((t) => t.kind === 'direktno')).toBe(true)
  })
})
