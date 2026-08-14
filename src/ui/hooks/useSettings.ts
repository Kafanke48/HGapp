import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/schema.ts'
import { readSettings } from '../../db/repositories/index.ts'
import type { AppSettings } from '../../db/types.ts'

/**
 * Nastavitve aplikacije (privzeti buy-in, hitri zneski, ...).
 *
 * Uporablja `readSettings`, ne `getSettings`: slednji ob prvem zagonu vrstico
 * ustvari, Dexie pa znotraj `liveQuery` pisanja ne dovoli — posledica je
 * `ReadOnlyError` in bel zaslon. Vrstica se ustvari ob zagonu v `App`.
 */
export function useSettings(): AppSettings | undefined {
  return useLiveQuery(() => readSettings(db), [])
}
