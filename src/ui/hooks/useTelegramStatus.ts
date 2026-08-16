import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/schema.ts'
import { readSettings } from '../../db/repositories/index.ts'

export interface TelegramStatusInfo {
  /** Sta žeton IN ID skupine nastavljena — brez obeh Telegram sloj počiva. */
  configured: boolean
  /** Koliko sporočil čaka na pošiljanje (stanje 'caka'). */
  pendingCount: number
  /** Koliko sporočil je trajno obupalo (stanje 'napaka') — vidno, ne tiho izgubljeno. */
  failedCount: number
}

const EMPTY_STATUS: TelegramStatusInfo = { configured: false, pendingCount: 0, failedCount: 0 }

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
      const configured = Boolean(settings.telegramBotToken && settings.telegramGroupChatId)
      const [pendingCount, failedCount] = await Promise.all([
        db.outbox.where('status').equals('caka').count(),
        db.outbox.where('status').equals('napaka').count(),
      ])
      return { configured, pendingCount, failedCount }
    },
    [],
    EMPTY_STATUS,
  )
}
