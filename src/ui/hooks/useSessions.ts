import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/schema.ts'
import { listSessionPlayers, listSessions } from '../../db/repositories/index.ts'
import type { Session } from '../../db/types.ts'

export interface SessionOverview {
  session: Session
  playerCount: number
}

/**
 * Seje z izpeljanim številom igralcev, urejene od najnovejše. Ločevanje
 * "aktivne" seje za prikaz na vrhu je stvar zaslona (SejeScreen), ne tega kljuka.
 */
export function useSessionsOverview(): SessionOverview[] | undefined {
  return useLiveQuery(async () => {
    const sessions = await listSessions(db)
    const withCounts = await Promise.all(
      sessions.map(async (session) => ({
        session,
        playerCount: (await listSessionPlayers(db, session.id)).length,
      })),
    )
    return withCounts.sort((a, b) => b.session.createdAt - a.session.createdAt)
  }, [])
}
