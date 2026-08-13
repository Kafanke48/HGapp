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
