import type { HGappDB } from '../schema.ts'
import type { SessionPlayer } from '../types.ts'
import type { Cents } from '../../domain/money.ts'
import { now } from '../ids.ts'
import { snapshot, withAudit } from '../audit.ts'

/**
 * Vpiše C (cashout) za igralca v seji. `cashoutChipCounts` hranimo tudi, kadar
 * je seja v načinu 'zetoni', zaradi revizijske sledljivosti surovega vnosa
 * po barvah (glej SessionPlayer.cashoutChipCounts).
 */
export async function setCashout(
  db: HGappDB,
  sessionPlayerId: string,
  cashoutCents: Cents,
  cashoutChipCounts: Record<string, number> | null = null,
): Promise<SessionPlayer> {
  return withAudit(db, [db.sessionPlayers], async (audit) => {
    const existing = await db.sessionPlayers.get(sessionPlayerId)
    if (!existing) throw new Error(`Sedež igralca ${sessionPlayerId} ne obstaja.`)
    // KLJUČNO: posnetek pred spremembo, preden karkoli mutiramo (glej audit.ts)
    const before = snapshot(existing)

    const updated: SessionPlayer = {
      ...existing,
      cashoutCents,
      cashoutChipCounts,
      version: existing.version + 1,
      updatedAt: now(),
    }
    await db.sessionPlayers.put(updated)
    audit.record({
      sessionId: existing.sessionId,
      entityTable: 'sessionPlayers',
      entityId: sessionPlayerId,
      action: 'update',
      before,
      after: snapshot(updated),
      versionAfter: updated.version,
    })
    return updated
  })
}

export async function getSessionPlayerByPlayer(
  db: HGappDB,
  sessionId: string,
  playerId: string,
): Promise<SessionPlayer | undefined> {
  return db.sessionPlayers.where('[sessionId+playerId]').equals([sessionId, playerId]).first()
}

/**
 * Predčasni odhod: igralec zapusti mizo sredi seje.
 *
 * Cash game — igralci prihajajo in odhajajo. Zabeležimo C (vrednost žetonov ob
 * odhodu) in `paidOutCents` (koliko denarja je ob tem dejansko vzel iz
 * blagajne). Oboje je ločeno namenoma: nekdo lahko odide in denar pusti do
 * konca večera, kar je `paidOutCents: 0`.
 *
 * Blagajna se s tem zmanjša za `paidOutCents`, terjatev igralca pa za isti
 * znesek — zato invarianta "vsota terjatev = vsebina blagajne" ostane cela
 * (glej domain/settlement/engine.ts, korak 4).
 */
export async function recordEarlyCashout(
  db: HGappDB,
  sessionPlayerId: string,
  cashoutCents: Cents,
  paidOutCents: Cents,
  cashoutChipCounts: Record<string, number> | null = null,
): Promise<SessionPlayer> {
  if (!Number.isInteger(cashoutCents) || cashoutCents < 0) {
    throw new Error('Vrednost žetonov ob odhodu mora biti nenegativen znesek.')
  }
  if (!Number.isInteger(paidOutCents) || paidOutCents < 0) {
    throw new Error('Izplačan znesek mora biti nenegativen.')
  }

  return withAudit(db, [db.sessionPlayers], async (audit) => {
    const existing = await db.sessionPlayers.get(sessionPlayerId)
    if (!existing) throw new Error(`Sedež igralca ${sessionPlayerId} ne obstaja.`)
    const before = snapshot(existing)

    const updated: SessionPlayer = {
      ...existing,
      cashoutCents,
      cashoutChipCounts,
      paidOutCents,
      leftAt: now(),
      version: existing.version + 1,
      updatedAt: now(),
    }
    await db.sessionPlayers.put(updated)
    audit.record({
      sessionId: existing.sessionId,
      entityTable: 'sessionPlayers',
      entityId: sessionPlayerId,
      action: 'update',
      before,
      after: snapshot(updated),
      versionAfter: updated.version,
      note: `Predčasni odhod: žetoni ${cashoutCents}, izplačano ${paidOutCents}`,
    })
    return updated
  })
}

/**
 * Igralec se vrne za mizo. Počisti podatke o odhodu, da lahko spet kupuje.
 * Predčasno izplačilo se NE briše — denar je zamenjal roke in mora ostati v
 * evidenci; kdor se vrne, preprosto kupi znova.
 */
export async function undoEarlyCashout(
  db: HGappDB,
  sessionPlayerId: string,
): Promise<SessionPlayer> {
  return withAudit(db, [db.sessionPlayers], async (audit) => {
    const existing = await db.sessionPlayers.get(sessionPlayerId)
    if (!existing) throw new Error(`Sedež igralca ${sessionPlayerId} ne obstaja.`)
    const before = snapshot(existing)

    const updated: SessionPlayer = {
      ...existing,
      cashoutCents: null,
      cashoutChipCounts: null,
      leftAt: null,
      version: existing.version + 1,
      updatedAt: now(),
    }
    await db.sessionPlayers.put(updated)
    audit.record({
      sessionId: existing.sessionId,
      entityTable: 'sessionPlayers',
      entityId: sessionPlayerId,
      action: 'update',
      before,
      after: snapshot(updated),
      versionAfter: updated.version,
      note: 'Igralec se je vrnil za mizo',
    })
    return updated
  })
}

/** Σ že izplačanega iz blagajne med sejo — odšteje se od `Σ P` pri prikazu blagajne. */
export async function sessionPaidOutTotal(db: HGappDB, sessionId: string): Promise<Cents> {
  const rows = await db.sessionPlayers.where('sessionId').equals(sessionId).toArray()
  return rows.reduce((sum, sp) => sum + (sp.paidOutCents ?? 0), 0)
}
