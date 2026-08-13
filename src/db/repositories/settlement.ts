import type { HGappDB } from '../schema.ts'
import type { DiscrepancyRecord, OpenDebt, SettlementLine } from '../types.ts'
import type {
  DiscrepancyMethod,
  ExpenseInput,
  PlayerInput,
  SettlementInput,
  SettlementMode,
  SettlementResult,
} from '../../domain/settlement/types.ts'
// Domenski obračun je last druge, vzporedno razvijane naloge. Ne smemo urejati
// ničesar pod src/domain/ — samo uvažamo dogovorjeni javni vmesnik.
import { computeSettlement } from '../../domain/settlement/index.ts'
import { newId, now } from '../ids.ts'
import { snapshot, withAudit } from '../audit.ts'
import { sessionTotals } from './buyins.ts'
import { listSessionPlayers } from './sessions.ts'
import { applyTransition, assertValidTransition } from './sessions.ts'

export interface ComputeSettlementOptions {
  /** Obvezno, kadar se Σ cashout ne ujema s Σ buy-in. Posredovano neposredno v obračun. */
  discrepancy?: DiscrepancyMethod | null
  preferredCreditors?: Readonly<Record<string, string>>
  /** Privzeto session.settlementMode; tu ga lahko uporabnik za predogled preglasi. */
  mode?: SettlementMode
}

/**
 * Prebere buy-ine, cashout-e in nastavitve stroškov iz Dexie, jih preslika v
 * `SettlementInput` domenskega obračuna in vrne rezultat BREZ pisanja v bazo.
 * Tako lahko uporabniški vmesnik predlog poravnave prikaže, uporabnik pa
 * spremeni prejemnike, preden karkoli obvelja (glej `finalizeSettlement`).
 */
export async function computeForSession(
  db: HGappDB,
  sessionId: string,
  opts: ComputeSettlementOptions = {},
): Promise<SettlementResult> {
  const session = await db.sessions.get(sessionId)
  if (!session) throw new Error(`Seja ${sessionId} ne obstaja.`)

  const [sessionPlayers, totals] = await Promise.all([
    listSessionPlayers(db, sessionId),
    sessionTotals(db, sessionId),
  ])

  const players: PlayerInput[] = sessionPlayers.map((sp) => {
    if (sp.cashoutCents === null) {
      throw new Error(`Manjka cashout za igralca ${sp.playerId} — vpiši končno stanje pred obračunom.`)
    }
    const bucket = totals.perPlayer[sp.playerId] ?? { takenCents: 0, paidCents: 0 }
    return {
      playerId: sp.playerId,
      takenCents: bucket.takenCents,
      paidCents: bucket.paidCents,
      cashoutCents: sp.cashoutCents,
    }
  })

  const expense: ExpenseInput | null = session.expenseEnabled
    ? {
        totalCents: session.expenseTotalCents,
        method: session.expenseSplitMethod,
        paidByPlayerId:
          session.expensePaidByPlayerId ??
          (() => {
            throw new Error('Delitev stroškov je vklopljena, a ni določeno, kdo je strošek založil.')
          })(),
      }
    : null

  const input: SettlementInput = {
    players,
    discrepancy: opts.discrepancy ?? null,
    expense,
    mode: opts.mode ?? session.settlementMode,
    ...(opts.preferredCreditors !== undefined ? { preferredCreditors: opts.preferredCreditors } : {}),
  }

  return computeSettlement(input)
}

export interface FinalizeSettlementOptions {
  /** Metoda razrešitve neskladja, uporabljena pri izračunu — potrebna za zapis DiscrepancyRecord. */
  discrepancy?: DiscrepancyMethod | null
  /**
   * Indeksi v `result.transfers`, ki jih je uporabnik takoj označil kot plačane
   * (npr. gotovina je zamenjala roke na mestu). Zanje se NE ustvari OpenDebt.
   */
  immediatelyPaidTransferIndexes?: readonly number[]
  /**
   * Isti `preferredCreditors`, uporabljen pri `computeForSession`. Potreben tu
   * le zato, da lahko `SettlementLine.manuallyReassigned` pravilno označi,
   * katere vrstice so posledica ročne izbire prejemnika (glej specifikacijo 4.4).
   */
  preferredCreditors?: Readonly<Record<string, string>>
}

/**
 * V ENI transakciji: zapiše vrstice poravnalnega načrta, odprt dolg za vsako
 * vrstico, ki ni bila takoj plačana, morebiten zapis neskladja, in sejo
 * prestavi v 'poravnana'. Vse skupaj se revidira.
 */
export async function finalizeSettlement(
  db: HGappDB,
  sessionId: string,
  result: SettlementResult,
  opts: FinalizeSettlementOptions = {},
): Promise<{ lines: SettlementLine[]; debts: OpenDebt[]; discrepancy: DiscrepancyRecord | null }> {
  return withAudit(db, [db.sessions, db.settlementLines, db.openDebts, db.discrepancies], async (audit) => {
    const session = await db.sessions.get(sessionId)
    if (!session) throw new Error(`Seja ${sessionId} ne obstaja.`)
    const sessionBefore = snapshot(session)

    // Poravnava je dovoljena samo iz 'zakljucena' — ista pravila kot za ročni
    // prehod stanja (glej sessions.ts), da ne obstajata dve različni resnici
    // o tem, kateri prehodi so veljavni.
    assertValidTransition(session.status, 'poravnana')

    const timestamp = now()
    const paidImmediately = new Set(opts.immediatelyPaidTransferIndexes ?? [])

    const preferredCreditors = opts.preferredCreditors ?? {}
    const lines: SettlementLine[] = result.transfers.map((transfer) => {
      // Vrstica je "ročno spremenjena", kadar je bil za tega plačnika izbran
      // prejemnik, ki ustreza uporabnikovi izbiri v preferredCreditors.
      const manuallyReassigned =
        transfer.fromPlayerId !== null && preferredCreditors[transfer.fromPlayerId] === transfer.toPlayerId
      return {
        id: newId(),
        sessionId,
        fromPlayerId: transfer.fromPlayerId,
        toPlayerId: transfer.toPlayerId,
        amountCents: transfer.amountCents,
        kind: transfer.kind,
        manuallyReassigned,
        createdAt: timestamp,
      }
    })

    for (const line of lines) {
      audit.record({
        sessionId,
        entityTable: 'settlementLines',
        entityId: line.id,
        action: 'settle',
        before: null,
        after: snapshot(line),
        versionAfter: null,
      })
    }

    // Dolg nastane za vsako vrstico, kjer nekdo nekaj DOLGUJE (plačnik obstaja):
    // 'direktno' (plačniku -> prejemniku) in 'v_blagajno' (plačniku -> blagajna).
    // 'iz_blagajne' nima plačnika (fromPlayerId je null) — to je gostitelj, ki
    // izplača iz blagajne, in ne ustvari dolga.
    const debts: OpenDebt[] = []
    lines.forEach((line, index) => {
      if (line.fromPlayerId === null) return
      if (paidImmediately.has(index)) return
      const debt: OpenDebt = {
        id: newId(),
        sessionId,
        settlementLineId: line.id,
        debtorPlayerId: line.fromPlayerId,
        creditorPlayerId: line.toPlayerId,
        originalCents: line.amountCents,
        paidCents: 0,
        status: 'odprto',
        note: null,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      debts.push(debt)
    })

    if (lines.length > 0) await db.settlementLines.bulkAdd(lines)
    if (debts.length > 0) {
      await db.openDebts.bulkAdd(debts)
      for (const debt of debts) {
        audit.record({
          sessionId,
          entityTable: 'openDebts',
          entityId: debt.id,
          action: 'create',
          before: null,
          after: snapshot(debt),
          versionAfter: debt.version,
        })
      }
    }

    let discrepancy: DiscrepancyRecord | null = null
    if (result.discrepancyCents !== 0) {
      const method = opts.discrepancy ?? null
      const adjustmentsCents: Record<string, number> = {}
      for (const adj of result.discrepancyAdjustments) {
        adjustmentsCents[adj.playerId] = adj.deltaCents
      }
      discrepancy = {
        id: newId(),
        sessionId,
        discrepancyCents: result.discrepancyCents,
        method: method?.method ?? 'rocno',
        assignedPlayerId: method?.method === 'pripisi' ? method.playerId : null,
        adjustmentsCents,
        note: method?.method === 'rocno' ? method.note : null,
        createdAt: timestamp,
      }
      await db.discrepancies.add(discrepancy)
      audit.record({
        sessionId,
        entityTable: 'discrepancies',
        entityId: discrepancy.id,
        action: 'discrepancy',
        before: null,
        after: snapshot(discrepancy),
        versionAfter: null,
      })
    }

    const updatedSession = applyTransition(session, 'poravnana', timestamp)
    await db.sessions.put(updatedSession)
    audit.record({
      sessionId,
      entityTable: 'sessions',
      entityId: sessionId,
      action: 'status',
      before: sessionBefore,
      after: snapshot(updatedSession),
      versionAfter: updatedSession.version,
    })

    return { lines, debts, discrepancy }
  })
}
