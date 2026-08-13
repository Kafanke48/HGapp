/**
 * Čisti obračun poravnave. Glej specifikacijo, razdelka 3 in 4.
 *
 * Vrstni red korakov je nespremenljiv in namerno fiksen (spec 4.1):
 *   1. neto saldi
 *   2. razrešitev neskladja žetonov (Σneto mora biti 0 po tem koraku)
 *   3. delitev stroškov na že popravljenih saldih (Σneto spet 0)
 *   4. izplačila = neto + P
 *   5. poravnalni načrt (transferji)
 *
 * Obraten vrstni red korakov 2 in 3 bi dal drugačen rezultat na ravni centov —
 * zato se tega ne sme "optimizirati" ali preurediti.
 */
import {
  type Cents,
  sumCents,
  splitEvenly,
  splitProportional,
  assertZeroSum,
  DenarnaNapaka,
} from '../money.ts'
import type { Adjustment, SettlementInput, SettlementResult, Transfer } from './types.ts'
import { ObracunNapaka } from './types.ts'

/** Vozlišče med sestavljanjem poravnalnega načrta: koliko igralcu še ostane. */
interface ClaimNode {
  playerId: string
  remaining: Cents
}

function byIdAsc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function computeSettlement(input: SettlementInput): SettlementResult {
  const { players } = input
  if (players.length === 0) {
    throw new ObracunNapaka('computeSettlement: seznam igralcev je prazen')
  }

  const playerIds = players.map((p) => p.playerId)
  const playerIdSet = new Set(playerIds)
  // Determinističen vrstni red je nujen za deljenje po metodi največjega ostanka
  // (spec 4.7): isti vhod mora vedno dati isti izhod.
  const sortedIds = [...playerIds].sort(byIdAsc)
  const byId = new Map(players.map((p) => [p.playerId, p]))

  // --- 1. neto saldi ---
  const net: Record<string, Cents> = {}
  for (const p of players) net[p.playerId] = p.cashoutCents - p.takenCents

  const sumC = sumCents(players.map((p) => p.cashoutCents))
  const sumB = sumCents(players.map((p) => p.takenCents))
  const discrepancyCents = sumC - sumB

  const discrepancyAdjustments: Adjustment[] = []

  // --- 2. razrešitev neskladja žetonov ---
  if (discrepancyCents !== 0) {
    const resolution = input.discrepancy
    if (!resolution) {
      throw new ObracunNapaka(
        `computeSettlement: neskladje ${discrepancyCents} centov zahteva izbrano razrešitev`,
      )
    }
    // Popravki morajo natanko izničiti neskladje, da bo Σneto po tem koraku 0.
    const target = -discrepancyCents

    switch (resolution.method) {
      case 'enakomerno': {
        const shares = splitEvenly(target, sortedIds.length)
        sortedIds.forEach((id, i) => {
          const delta = shares[i]!
          net[id] = net[id]! + delta
          discrepancyAdjustments.push({
            playerId: id,
            deltaCents: delta,
            reason: 'Neskladje žetonov razdeljeno enakomerno med vse igralce',
          })
        })
        break
      }
      case 'sorazmerno': {
        const weights = sortedIds.map((id) => Math.max(0, byId.get(id)!.cashoutCents))
        let shares: Cents[]
        let fellBack = false
        try {
          shares = splitProportional(target, weights)
        } catch (e) {
          // Vsota uteži 0 (nihče ni odnesel žetonov) — sorazmerna delitev ni
          // definirana, zato se vrnemo na enakomerno namesto da bi obračun padel.
          if (e instanceof DenarnaNapaka) {
            shares = splitEvenly(target, sortedIds.length)
            fellBack = true
          } else {
            throw e
          }
        }
        sortedIds.forEach((id, i) => {
          const delta = shares[i]!
          net[id] = net[id]! + delta
          discrepancyAdjustments.push({
            playerId: id,
            deltaCents: delta,
            reason: fellBack
              ? 'Neskladje žetonov: sorazmerno ni bilo mogoče (vsi stacki 0), razdeljeno enakomerno'
              : 'Neskladje žetonov razdeljeno sorazmerno s končnim stackom',
          })
        })
        break
      }
      case 'pripisi': {
        if (!playerIdSet.has(resolution.playerId)) {
          throw new ObracunNapaka(
            `computeSettlement: igralec '${resolution.playerId}' ni udeleženec te seje`,
          )
        }
        net[resolution.playerId] = net[resolution.playerId]! + target
        discrepancyAdjustments.push({
          playerId: resolution.playerId,
          deltaCents: target,
          reason: `Celotno neskladje žetonov pripisano igralcu ${resolution.playerId}`,
        })
        break
      }
      case 'rocno': {
        const entries = Object.entries(resolution.adjustmentsCents)
        const sumAdjustments = sumCents(entries.map(([, v]) => v))
        if (sumAdjustments !== target) {
          throw new ObracunNapaka(
            `computeSettlement: ročni popravki (${sumAdjustments}) se ne izidejo z neskladjem (potrebno ${target})`,
          )
        }
        if (resolution.note.trim() === '') {
          throw new ObracunNapaka('computeSettlement: ročna razrešitev neskladja zahteva zapisek')
        }
        for (const [id, delta] of entries) {
          if (!playerIdSet.has(id)) {
            throw new ObracunNapaka(`computeSettlement: igralec '${id}' ni udeleženec te seje`)
          }
          net[id] = net[id]! + delta
          discrepancyAdjustments.push({ playerId: id, deltaCents: delta, reason: resolution.note })
        }
        break
      }
    }

    assertZeroSum(sortedIds.map((id) => net[id]!), 'po razrešitvi neskladja žetonov')
  }

  // --- 3. delitev stroškov (na že popravljenih saldih) ---
  const expenseAdjustments: Adjustment[] = []
  let expenseFellBackToHeadcount = false

  if (input.expense) {
    const exp = input.expense
    if (!playerIdSet.has(exp.paidByPlayerId)) {
      throw new ObracunNapaka(
        `computeSettlement: založnik stroška '${exp.paidByPlayerId}' ni udeleženec te seje`,
      )
    }

    let shares: Cents[]
    if (exp.method === 'po_glavah') {
      shares = splitEvenly(exp.totalCents, sortedIds.length)
    } else {
      // po_dobicku: uteži so pozitivni del trenutnega neta (kdor je v minusu, ne plača nič)
      const weights = sortedIds.map((id) => Math.max(0, net[id]!))
      if (weights.every((w) => w === 0)) {
        // Nihče ni v plusu — delitev "po dobičku" ni definirana (spec 4.6),
        // zato se vrnemo na "po glavah" in to eksplicitno zapišemo.
        expenseFellBackToHeadcount = true
        shares = splitEvenly(exp.totalCents, sortedIds.length)
      } else {
        shares = splitProportional(exp.totalCents, weights)
      }
    }

    const methodLabel = expenseFellBackToHeadcount
      ? 'po glavah (ni bilo zmagovalcev, prvotno izbrano "po dobičku")'
      : exp.method === 'po_glavah'
        ? 'po glavah'
        : 'po dobičku'

    sortedIds.forEach((id, i) => {
      const share = shares[i]!
      // Vsak plača svoj delež; založnik povrhu dobi povrnjen celoten znesek.
      let delta = -share
      if (id === exp.paidByPlayerId) delta += exp.totalCents
      net[id] = net[id]! + delta
      expenseAdjustments.push({
        playerId: id,
        deltaCents: delta,
        reason:
          id === exp.paidByPlayerId
            ? `Strošek razdeljen ${methodLabel}; založnik prejme povrnjen celoten znesek`
            : `Strošek razdeljen ${methodLabel}`,
      })
    })

    assertZeroSum(sortedIds.map((id) => net[id]!), 'po delitvi stroškov')
  }

  // --- 4. izplačila ---
  const boxCents = sumCents(players.map((p) => p.paidCents)) // Σ P velja ne glede na način
  const payout: Record<string, Cents> = {}
  for (const p of players) {
    const paid = input.mode === 'p2p' ? 0 : p.paidCents
    payout[p.playerId] = net[p.playerId]! + paid
  }
  const p2pWithNonEmptyBox = input.mode === 'p2p' && boxCents > 0

  // --- 5. poravnalni načrt ---
  const creditors: ClaimNode[] = sortedIds
    .filter((id) => payout[id]! > 0)
    .map((id) => ({ playerId: id, remaining: payout[id]! }))
    .sort((a, b) => b.remaining - a.remaining || byIdAsc(a.playerId, b.playerId))

  const debtors: ClaimNode[] = sortedIds
    .filter((id) => payout[id]! < 0)
    .map((id) => ({ playerId: id, remaining: -payout[id]! }))
    .sort((a, b) => b.remaining - a.remaining || byIdAsc(a.playerId, b.playerId))

  const transfers: Transfer[] = []

  for (const debtor of debtors) {
    let remainingDebt = debtor.remaining

    // Uporabnikova izbira prejemnika ima prednost, kolikor daleč seže njegova terjatev.
    const preferredId = input.preferredCreditors?.[debtor.playerId]
    if (preferredId !== undefined && remainingDebt > 0) {
      const preferred = creditors.find((c) => c.playerId === preferredId)
      if (preferred && preferred.remaining > 0) {
        const amt = Math.min(remainingDebt, preferred.remaining)
        if (amt > 0) {
          transfers.push({
            fromPlayerId: debtor.playerId,
            toPlayerId: preferred.playerId,
            amountCents: amt,
            kind: 'direktno',
          })
          preferred.remaining -= amt
          remainingDebt -= amt
        }
      }
    }

    // Preostanek po privzetem pravilu: največji dolg -> največji (preostali) zmagovalec.
    while (remainingDebt > 0) {
      let best: ClaimNode | null = null
      for (const c of creditors) {
        if (c.remaining <= 0) continue
        if (!best || c.remaining > best.remaining || (c.remaining === best.remaining && byIdAsc(c.playerId, best.playerId) < 0)) {
          best = c
        }
      }
      if (!best) {
        // Matematično se to ne sme zgoditi, dokler je Σ P >= 0 (glej opombo pri boxCents).
        throw new ObracunNapaka(
          `computeSettlement: ni mogoče razporediti preostalega dolga igralca ${debtor.playerId} (${remainingDebt} centov)`,
        )
      }
      const amt = Math.min(remainingDebt, best.remaining)
      transfers.push({
        fromPlayerId: debtor.playerId,
        toPlayerId: best.playerId,
        amountCents: amt,
        kind: 'direktno',
      })
      best.remaining -= amt
      remainingDebt -= amt
    }
  }

  if (input.mode === 'blagajna') {
    let fromBoxTotal = 0
    for (const c of creditors) {
      if (c.remaining > 0) {
        transfers.push({
          fromPlayerId: null,
          toPlayerId: c.playerId,
          amountCents: c.remaining,
          kind: 'iz_blagajne',
        })
        fromBoxTotal += c.remaining
      }
    }
    if (fromBoxTotal !== boxCents) {
      throw new ObracunNapaka(
        `computeSettlement: vsota izplačil iz blagajne (${fromBoxTotal}) se ne ujema z vsebino blagajne (${boxCents})`,
      )
    }
  } else {
    // p2p: direktna nakazila morajo sama izničiti vse terjatve, ker je Σ payout = Σ neto = 0.
    const leftover = sumCents(creditors.map((c) => c.remaining))
    if (leftover !== 0) {
      throw new ObracunNapaka(
        `computeSettlement: v p2p načinu je ostalo nepokritih ${leftover} centov terjatev`,
      )
    }
  }

  return {
    discrepancyCents,
    netCents: net,
    payoutCents: payout,
    boxCents,
    transfers,
    discrepancyAdjustments,
    expenseAdjustments,
    expenseFellBackToHeadcount,
    p2pWithNonEmptyBox,
  }
}
