import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/schema.ts'
import { listPlayers } from '../../db/repositories/index.ts'
import type { Player } from '../../db/types.ts'

/** Živ seznam igralcev. Privzeto brez arhiviranih (glej listPlayers). */
export function usePlayers(includeArchived = false): Player[] | undefined {
  return useLiveQuery(() => listPlayers(db, { includeArchived }), [includeArchived])
}
