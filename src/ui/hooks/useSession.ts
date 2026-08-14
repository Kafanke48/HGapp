import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/schema.ts'
import { getSession } from '../../db/repositories/index.ts'
import type { Session } from '../../db/types.ts'

/** Ena seja, živo posodobljena (npr. ob prehodu stanja). */
export function useSession(sessionId: string | null): Session | undefined {
  return useLiveQuery(() => (sessionId ? getSession(db, sessionId) : undefined), [sessionId])
}
