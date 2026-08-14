import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/schema.ts'
import { sessionTotals, type SessionTotals } from '../../db/repositories/index.ts'

const EMPTY_TOTALS: SessionTotals = { perPlayer: {}, boxCents: 0 }

/** Vsote za kontrolo blagajne (spec 3.4), živo posodobljene ob vsakem buy-inu/undo. */
export function useSessionTotals(sessionId: string | null): SessionTotals {
  return useLiveQuery(() => (sessionId ? sessionTotals(db, sessionId) : EMPTY_TOTALS), [sessionId], EMPTY_TOTALS)
}
