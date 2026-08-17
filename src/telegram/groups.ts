/**
 * Zaznavanje skupin, v katerih je bot.
 *
 * Zakaj to sploh obstaja: ID skupine je edini podatek, ki ga mora uporabnik
 * ročno prepisati, in prav tam se najlažje zmoti (manjkajoč minus, odrezana
 * številka, ID stare skupine po nadgradnji v supergrupo). Še huje — odkar
 * poslušalec teče, ko je aplikacija odprta, posodobitve pobere on, zato jih
 * uporabnik v `getUpdates` v brskalniku sploh ne vidi več.
 *
 * Zato si vsako skupino, iz katere bot kaj sliši, zapomnimo. Uporabnik jo
 * potem samo izbere s tapom — brez prepisovanja.
 */
import type { HGappDB } from '../db/schema.ts'
import { getSettings, updateSettings } from '../db/repositories/settings.ts'
import type { TelegramMessage } from './types.ts'

export interface SeenGroup {
  chatId: string
  title: string
}

/** Koliko skupin hranimo. Domača raba — več kot nekaj jih ne bo. */
const MAX_SEEN_GROUPS = 5

/**
 * Če sporočilo prihaja iz skupine, si jo zapomni. Zasebni klepeti se ne
 * beležijo — tam ni ničesar, kar bi uporabnik izbiral.
 *
 * Vrne `true`, kadar je bil seznam spremenjen.
 */
export async function recordSeenGroup(db: HGappDB, message: TelegramMessage): Promise<boolean> {
  const chat = message.chat
  if (chat.type !== 'group' && chat.type !== 'supergroup') return false

  const chatId = String(chat.id)
  const title = chat.title ?? 'Skupina brez imena'

  const settings = await getSettings(db)
  const existing = settings.telegramSeenGroups ?? []

  const already = existing.find((g) => g.chatId === chatId)
  if (already && already.title === title) return false

  // Najnovejša na vrh; podvojene odstranimo, da se seznam ne razraste.
  const next: SeenGroup[] = [
    { chatId, title },
    ...existing.filter((g) => g.chatId !== chatId),
  ].slice(0, MAX_SEEN_GROUPS)

  await updateSettings(db, { telegramSeenGroups: next })
  return true
}

export async function listSeenGroups(db: HGappDB): Promise<SeenGroup[]> {
  const settings = await getSettings(db)
  return settings.telegramSeenGroups ?? []
}

export interface SeenUser {
  tgUserId: string
  tgUsername: string | null
  /** Nullable zaradi ujemanja z `LinkCandidate` — vmesnik ju zdruzuje v en seznam. */
  firstName: string | null
}

const MAX_SEEN_USERS = 20

/**
 * Zapomni si pošiljatelja, da ga je mogoče povezati z igralcem tudi kasneje.
 *
 * Nujno zato, ker poslušalec teče, dokler je aplikacija odprta, in posodobitve
 * pobere PRVI — s tem premakne kazalec branja. Igralec, ki pritisne Start
 * takrat, bi bil za "Poišči nove" nevidljiv za vedno, ker `getUpdates` istega
 * sporočila ne vrne dvakrat.
 *
 * Botov ne beležimo. Vrne `true`, kadar je bil seznam spremenjen.
 */
export async function recordSeenUser(db: HGappDB, message: TelegramMessage): Promise<boolean> {
  const from = message.from
  if (!from || from.is_bot) return false

  const tgUserId = String(from.id)
  const tgUsername = from.username ?? null
  const firstName: string | null = from.first_name ?? null

  const settings = await getSettings(db)
  const existing = settings.telegramSeenUsers ?? []

  const already = existing.find((u) => u.tgUserId === tgUserId)
  if (already && already.tgUsername === tgUsername && already.firstName === firstName) return false

  const next: SeenUser[] = [
    { tgUserId, tgUsername, firstName },
    ...existing.filter((u) => u.tgUserId !== tgUserId),
  ].slice(0, MAX_SEEN_USERS)

  await updateSettings(db, { telegramSeenUsers: next })
  return true
}

/** Zaznani pošiljatelji, ki še niso povezani z nobenim igralcem. */
export async function listUnlinkedSeenUsers(db: HGappDB): Promise<SeenUser[]> {
  const settings = await getSettings(db)
  const seen = settings.telegramSeenUsers ?? []
  if (seen.length === 0) return []

  const players = await db.players.toArray()
  const linked = new Set(
    players.map((p) => p.telegramUserId).filter((id): id is string => id !== null),
  )
  return seen.filter((u) => !linked.has(u.tgUserId))
}
