import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/schema.ts'
import { listBuyIns } from '../../db/repositories/index.ts'
import type { BuyIn } from '../../db/types.ts'

/** Vsi buy-ini seje (vključno s preklicanimi — filtriranje je stvar klicatelja). */
export function useBuyIns(sessionId: string | null): BuyIn[] | undefined {
  return useLiveQuery(() => (sessionId ? listBuyIns(db, sessionId) : []), [sessionId])
}
