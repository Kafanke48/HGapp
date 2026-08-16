import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/schema.ts'
import { listDebtsForSession, listPaymentsForDebt, listPlayers, listSessions } from '../../db/repositories/index.ts'
import type { Cents } from '../../domain/money.ts'
import type { DebtPayment, OpenDebt, Session } from '../../db/types.ts'

/** Ena vrstica dolga, obogatena z imeni in sejo — za prikaz, ne za shrambo. */
export interface DebtRow {
  debt: OpenDebt
  debtorName: string
  /** null pomeni "blagajna" (dolg do hosta/blagajne, glej formatOpenDebtReminder). */
  creditorName: string | null
  /** Datum seje, iz katere dolg izvira. null, če seje ni bilo mogoče najti. */
  sessionDate: number | null
  sessionLabel: string
  remainingCents: Cents
}

export interface DebtorGroup {
  debtorPlayerId: string
  debtorName: string
  totalRemainingCents: Cents
  rows: DebtRow[]
}

export interface DebtsOverview {
  groups: DebtorGroup[]
  /** Vsota vseh neporavnanih dolgov, ne glede na `includeSettled` — plačani dolgovi prispevajo 0. */
  totalRemainingCents: Cents
}

/**
 * Repozitorij nima funkcije "vsi dolgovi ne glede na sejo, vključno s
 * plačanimi" — `listOpenDebts` namerno filtrira samo `odprto`/`delno` (glej
 * debts.ts). Ker plačani dolgovi ostanejo skriti privzeto, a jih uporabnik
 * lahko razkrije, jih tu sestavimo iz `listSessions` + `listDebtsForSession`,
 * brez odpiranja lastne Dexie transakcije (repozitoriji so edino mesto, ki
 * to sme).
 */
async function listAllDebts(): Promise<OpenDebt[]> {
  const sessions = await listSessions(db)
  const perSession = await Promise.all(sessions.map((session) => listDebtsForSession(db, session.id)))
  return perSession.flat()
}

function formatSessionDate(ts: number): string {
  return new Date(ts).toLocaleDateString('sl-SI', { day: 'numeric', month: 'numeric', year: 'numeric' })
}

function sessionLabelFor(session: Session | undefined): { date: number | null; label: string } {
  if (!session) return { date: null, label: 'neznana seja' }
  const date = session.startedAt ?? session.scheduledAt ?? session.createdAt
  const dateText = formatSessionDate(date)
  return { date, label: session.name ? `${dateText} · ${session.name}` : dateText }
}

/**
 * Odprti dolgovi, združeni po dolžniku ("kdo meni še dolguje", glej spec 5) —
 * praktično vprašanje ni "iz katere seje", ampak "kdo".
 *
 * `includeSettled` doda tudi `placano` dolgove (privzeto skriti v zaslonu —
 * nikoli izbrisani, glej types.ts).
 */
export function useDebtsOverview(includeSettled: boolean): DebtsOverview | undefined {
  return useLiveQuery(async () => {
    const [allDebts, players, sessions] = await Promise.all([listAllDebts(), listPlayers(db, { includeArchived: true }), listSessions(db)])

    const nameById = new Map(players.map((p) => [p.id, p.name] as const))
    const sessionById = new Map(sessions.map((s) => [s.id, s] as const))
    const nameOf = (id: string | null): string | null => (id === null ? null : (nameById.get(id) ?? id))

    const visibleDebts = includeSettled ? allDebts : allDebts.filter((d) => d.status !== 'placano')

    const groupsByDebtor = new Map<string, DebtRow[]>()
    for (const debt of visibleDebts) {
      const { date, label } = sessionLabelFor(sessionById.get(debt.sessionId))
      const row: DebtRow = {
        debt,
        debtorName: nameOf(debt.debtorPlayerId) ?? debt.debtorPlayerId,
        creditorName: nameOf(debt.creditorPlayerId),
        sessionDate: date,
        sessionLabel: label,
        remainingCents: debt.originalCents - debt.paidCents,
      }
      const arr = groupsByDebtor.get(debt.debtorPlayerId) ?? []
      arr.push(row)
      groupsByDebtor.set(debt.debtorPlayerId, arr)
    }

    const groups: DebtorGroup[] = [...groupsByDebtor.entries()].map(([debtorPlayerId, rows]) => {
      // Znotraj dolžnika: najnovejša seja najprej, brez datuma na konec.
      rows.sort((a, b) => (b.sessionDate ?? -Infinity) - (a.sessionDate ?? -Infinity) || b.debt.createdAt - a.debt.createdAt)
      return {
        debtorPlayerId,
        debtorName: rows[0]?.debtorName ?? debtorPlayerId,
        totalRemainingCents: rows.reduce((sum, r) => sum + r.remainingCents, 0),
        rows,
      }
    })

    // Kdo dolguje največ, je na vrhu — to je praktično najbolj uporabno vprašanje.
    groups.sort((a, b) => b.totalRemainingCents - a.totalRemainingCents || a.debtorName.localeCompare(b.debtorName, 'sl'))

    // Skupni znesek je vedno neodvisen od `includeSettled`, ker plačani dolgovi
    // prispevajo natanko 0 (glej remainingCents zgoraj) — zato lahko računamo
    // iz istega `allDebts`, ne le iz `visibleDebts`.
    const totalRemainingCents = allDebts.reduce((sum, d) => sum + (d.originalCents - d.paidCents), 0)

    return { groups, totalRemainingCents }
  }, [includeSettled])
}

/** Zgodovina plačil za en dolg, urejena od najnovejšega — glej spec 5 (delna plačila so sporna). */
export function useDebtPayments(debtId: string | null): DebtPayment[] | undefined {
  return useLiveQuery(async () => {
    if (!debtId) return []
    const payments = await listPaymentsForDebt(db, debtId)
    return [...payments].sort((a, b) => b.paidAt - a.paidAt)
  }, [debtId])
}
