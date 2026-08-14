/**
 * Povezovanje igralcev s Telegram uporabniki (glej spec 7.3).
 *
 * Bot ne more prvi pisati uporabniku, zato edini način, da ga "odkrijemo", je
 * pregled prejetih posodobitev (`message`/`callback_query`) za pošiljatelje,
 * ki še niso povezani z nobenim igralcem.
 */
import type { HGappDB } from '../db/schema.ts'
import type { Player } from '../db/types.ts'
import { updatePlayer } from '../db/repositories/players.ts'
import type { TelegramUpdate, TelegramUser } from './types.ts'

export interface LinkCandidate {
  tgUserId: string
  tgUsername: string | null
  firstName: string | null
}

function extractUser(update: TelegramUpdate): TelegramUser | undefined {
  return update.message?.from ?? update.callback_query?.from
}

/**
 * Iz podanega paketa posodobitev izlušči kandidate za povezavo — pošiljatelje,
 * ki se še ne pojavijo kot `telegramUserId` na nobenem igralcu. Klicatelj
 * (poller/UI) je odgovoren za ohranjanje paketa posodobitev med klici, če želi
 * kandidate kopičiti čez čas — ta funkcija sama ne hrani stanja (glej pravilo:
 * brez modulnih singletonov).
 */
export async function findLinkCandidates(db: HGappDB, updates: readonly TelegramUpdate[]): Promise<LinkCandidate[]> {
  const byId = new Map<string, LinkCandidate>()
  for (const update of updates) {
    const user = extractUser(update)
    if (!user || user.is_bot) continue
    const tgUserId = String(user.id)
    byId.set(tgUserId, {
      tgUserId,
      tgUsername: user.username ?? null,
      firstName: user.first_name,
    })
  }

  if (byId.size === 0) return []

  const players = await db.players.toArray()
  const linkedIds = new Set(players.map((p) => p.telegramUserId).filter((id): id is string => id !== null))

  return [...byId.values()].filter((c) => !linkedIds.has(c.tgUserId))
}

/** Poveže obstoječega igralca z Telegram uporabnikom (glej spec 7.3: en tap na kandidata). */
export async function linkPlayer(
  db: HGappDB,
  playerId: string,
  tgUserId: string,
  tgUsername: string | null,
): Promise<Player> {
  return updatePlayer(db, playerId, { telegramUserId: tgUserId, telegramUsername: tgUsername })
}

/** Prekine povezavo (npr. napačno povezan igralec). */
export async function unlinkPlayer(db: HGappDB, playerId: string): Promise<Player> {
  return updatePlayer(db, playerId, { telegramUserId: null, telegramUsername: null })
}
