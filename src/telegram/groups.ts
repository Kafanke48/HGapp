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
