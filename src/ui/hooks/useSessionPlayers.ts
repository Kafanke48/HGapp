import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/schema.ts'
import { getPlayer, listSessionPlayers } from '../../db/repositories/index.ts'
import type { Player, SessionPlayer } from '../../db/types.ts'

export interface SessionPlayerRow {
  sessionPlayer: SessionPlayer
  player: Player
}

/**
 * Sedeži seje, povezani z igralcem, urejeni po vrstnem redu sedežev. Sedeži
 * brez najdenega igralca (ne bi se smelo zgoditi — igralci se ne brišejo
 * trdo) so izločeni, da UI ne poka.
 */
export function useSessionPlayerRows(sessionId: string | null): SessionPlayerRow[] | undefined {
  return useLiveQuery(async () => {
    if (!sessionId) return []
    const seats = await listSessionPlayers(db, sessionId)
    const rows = await Promise.all(
      seats.map(async (sessionPlayer): Promise<SessionPlayerRow | null> => {
        const player = await getPlayer(db, sessionPlayer.playerId)
        return player ? { sessionPlayer, player } : null
      }),
    )
    return rows
      .filter((r): r is SessionPlayerRow => r !== null)
      .sort((a, b) => a.sessionPlayer.seatOrder - b.sessionPlayer.seatOrder)
  }, [sessionId])
}
