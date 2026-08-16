import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/schema.ts'
import { readSettings } from '../../db/repositories/index.ts'

export interface TelegramStatusInfo {
  /** Je nastavljen žeton — edini pogoj, da Telegram sloj sploh teče. */
  configured: boolean
  /** Je nastavljen ID skupine — pogoj samo za sporočila v skupino. */
  groupConfigured: boolean
  /** Koliko sporočil čaka na pošiljanje (stanje 'caka'). */
  pendingCount: number
  /** Koliko sporočil je trajno obupalo (stanje 'napaka') — vidno, ne tiho izgubljeno. */
  failedCount: number
}

const EMPTY_STATUS: TelegramStatusInfo = {
  configured: false,
  groupConfigured: false,
  pendingCount: 0,
  failedCount: 0,
}

/**
 * Majhen, živ povzetek stanja Telegram sloja — za nevsiljiv indikator v UI
 * (glej nalogo). Uporablja SAMO `readSettings` (branje), nikoli `getSettings`
 * — slednji bi znotraj `useLiveQuery` vrgel `ReadOnlyError` in obelil zaslon
 * (glej opozorilo v settings.ts, to se je že zgodilo).
 */
export function useTelegramStatus(): TelegramStatusInfo {
  return useLiveQuery(
    async () => {
      const settings = await readSettings(db)
      // Ločeno: žeton odklene pošiljanje, ID skupine samo sporočila v skupino.
      // Prej je bilo oboje zvezano, zato se ob nastavljenem samo žetonu ni
      // videlo niti tega, da sporočila čakajo v vrsti — dvojna nevidnost.
      const configured = Boolean(settings.telegramBotToken)
      const groupConfigured = Boolean(settings.telegramGroupChatId)
      const [pendingCount, failedCount] = await Promise.all([
        db.outbox.where('status').equals('caka').count(),
        db.outbox.where('status').equals('napaka').count(),
      ])
      return { configured, groupConfigured, pendingCount, failedCount }
    },
    [],
    EMPTY_STATUS,
  )
}
