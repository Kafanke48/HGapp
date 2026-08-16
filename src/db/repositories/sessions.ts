import type { HGappDB } from '../schema.ts'
import type { CashoutMode, Session, SessionPlayer, SessionStatus } from '../types.ts'
import type { Cents } from '../../domain/money.ts'
import type { ExpenseSplitMethod, SettlementMode } from '../../domain/settlement/types.ts'
import type { ChipDenomination } from '../types.ts'
import { newId, now } from '../ids.ts'
import { snapshot, withAudit } from '../audit.ts'

/** Fiksno, edino dovoljeno zaporedje stanj seje. Brez preskakovanja, brez vračanja nazaj. */
const STATUS_ORDER: readonly SessionStatus[] = ['nacrtovana', 'aktivna', 'zakljucena', 'poravnana']

/**
 * Čista validacija prehoda (brez baze), da jo lahko uporabita tako
 * `transitionSessionStatus` kot `finalizeSettlement` (settlement.ts) znotraj
 * SVOJE lastne transakcije, ne da bi morala gnezditi Dexie transakcije.
 */
export function assertValidTransition(current: SessionStatus, target: SessionStatus): void {
  const currentIdx = STATUS_ORDER.indexOf(current)
  const targetIdx = STATUS_ORDER.indexOf(target)
  if (targetIdx !== currentIdx + 1) {
    throw new Error(
      `Neveljaven prehod stanja seje: '${current}' → '${target}'. ` +
        `Dovoljeno je le zaporedje ${STATUS_ORDER.join(' → ')}.`,
    )
  }
}

/** Čista funkcija: iz seje in ciljnega stanja sestavi posodobljeno sejo (brez pisanja v bazo). */
export function applyTransition(session: Session, target: SessionStatus, timestamp: number): Session {
  const updated: Session = {
    ...session,
    status: target,
    version: session.version + 1,
    updatedAt: timestamp,
  }
  if (target === 'aktivna') updated.startedAt = timestamp
  if (target === 'zakljucena') updated.endedAt = timestamp
  if (target === 'poravnana') updated.settledAt = timestamp
  return updated
}

export interface CreateSessionInput {
  name?: string | null
  location?: string | null
  blindsLabel?: string | null
  scheduledAt?: number | null
  hostPlayerId?: string | null
  cashoutMode?: CashoutMode
  chipDenominations?: ChipDenomination[]
  defaultBuyInCents: Cents
  settlementMode?: SettlementMode
  expenseEnabled?: boolean
  expenseTotalCents?: Cents
  expenseSplitMethod?: ExpenseSplitMethod
  expensePaidByPlayerId?: string | null
}

export async function createSession(db: HGappDB, input: CreateSessionInput): Promise<Session> {
  return withAudit(db, [db.sessions], async (audit) => {
    const timestamp = now()
    const session: Session = {
      id: newId(),
      name: input.name ?? null,
      location: input.location ?? null,
      status: 'nacrtovana',
      blindsLabel: input.blindsLabel ?? null,
      scheduledAt: input.scheduledAt ?? null,
      startedAt: null,
      endedAt: null,
      settledAt: null,
      hostPlayerId: input.hostPlayerId ?? null,
      cashoutMode: input.cashoutMode ?? 'eur',
      chipDenominations: input.chipDenominations ?? [],
      defaultBuyInCents: input.defaultBuyInCents,
      settlementMode: input.settlementMode ?? 'blagajna',
      expenseEnabled: input.expenseEnabled ?? false,
      expenseTotalCents: input.expenseTotalCents ?? 0,
      expenseSplitMethod: input.expenseSplitMethod ?? 'po_glavah',
      expensePaidByPlayerId: input.expensePaidByPlayerId ?? null,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.sessions.add(session)
    audit.record({
      sessionId: session.id,
      entityTable: 'sessions',
      entityId: session.id,
      action: 'create',
      before: null,
      after: snapshot(session),
      versionAfter: session.version,
    })
    return session
  })
}

export async function transitionSessionStatus(
  db: HGappDB,
  sessionId: string,
  target: SessionStatus,
): Promise<Session> {
  return withAudit(db, [db.sessions], async (audit) => {
    const existing = await db.sessions.get(sessionId)
    if (!existing) throw new Error(`Seja ${sessionId} ne obstaja.`)
    // KLJUČNO: posnetek pred spremembo, preden karkoli mutiramo (glej audit.ts)
    const before = snapshot(existing)

    assertValidTransition(existing.status, target)
    const updated = applyTransition(existing, target, now())
    await db.sessions.put(updated)
    audit.record({
      sessionId: sessionId,
      entityTable: 'sessions',
      entityId: sessionId,
      action: 'status',
      before,
      after: snapshot(updated),
      versionAfter: updated.version,
    })
    return updated
  })
}

/** Poljubna sprememba nastavitev seje, ki ni prehod stanja (npr. gostitelj, delitev stroškov). */
export type UpdateSessionInput = Partial<
  Omit<Session, 'id' | 'status' | 'version' | 'createdAt' | 'updatedAt' | 'startedAt' | 'endedAt' | 'settledAt'>
>

export async function updateSession(db: HGappDB, sessionId: string, patch: UpdateSessionInput): Promise<Session> {
  return withAudit(db, [db.sessions], async (audit) => {
    const existing = await db.sessions.get(sessionId)
    if (!existing) throw new Error(`Seja ${sessionId} ne obstaja.`)
    const before = snapshot(existing)
    const updated: Session = { ...existing, ...patch, version: existing.version + 1, updatedAt: now() }
    await db.sessions.put(updated)
    audit.record({
      sessionId,
      entityTable: 'sessions',
      entityId: sessionId,
      action: 'update',
      before,
      after: snapshot(updated),
      versionAfter: updated.version,
    })
    return updated
  })
}

export async function getSession(db: HGappDB, sessionId: string): Promise<Session | undefined> {
  return db.sessions.get(sessionId)
}

export async function listSessions(db: HGappDB): Promise<Session[]> {
  return db.sessions.toArray()
}

export async function addSessionPlayer(
  db: HGappDB,
  sessionId: string,
  playerId: string,
  seatOrder: number,
): Promise<SessionPlayer> {
  return withAudit(db, [db.sessionPlayers], async (audit) => {
    const timestamp = now()
    const sessionPlayer: SessionPlayer = {
      id: newId(),
      sessionId,
      playerId,
      seatOrder,
      cashoutCents: null,
      cashoutChipCounts: null,
      paidOutCents: 0,
      leftAt: null,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.sessionPlayers.add(sessionPlayer)
    audit.record({
      sessionId,
      entityTable: 'sessionPlayers',
      entityId: sessionPlayer.id,
      action: 'create',
      before: null,
      after: snapshot(sessionPlayer),
      versionAfter: sessionPlayer.version,
    })
    return sessionPlayer
  })
}

export async function listSessionPlayers(db: HGappDB, sessionId: string): Promise<SessionPlayer[]> {
  return db.sessionPlayers.where('sessionId').equals(sessionId).toArray()
}
