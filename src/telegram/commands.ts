/**
 * Ukazi, na katere bot odgovarja v skupini (glej specifikacijo 7.6).
 *
 * Deluje samo, dokler je aplikacija odprta — iOS izvajanje v ozadju ustavi.
 * To ni napaka te datoteke, ampak cena zahteve "brez strežnika"; uporabnik je
 * na to opozorjen v nastavitvah.
 */
import type { HGappDB } from '../db/schema.ts'
import { sessionTotals } from '../db/repositories/buyins.ts'
import { listSessionPlayers } from '../db/repositories/sessions.ts'
import { enqueue } from './outbox.ts'
import { formatCurrentStandings, type StandingRow } from './formatters.ts'
import type { TelegramMessage } from './types.ts'

/** Iz "/stanje@MojBot" naredi "/stanje" — Telegram v skupinah pripne ime bota. */
function normalizeCommand(text: string): string {
  const first = text.trim().split(/\s+/)[0] ?? ''
  const atIndex = first.indexOf('@')
  return (atIndex === -1 ? first : first.slice(0, atIndex)).toLowerCase()
}

/**
 * Obdela sporočilo, če je ukaz. Vrne `true`, kadar je bilo sporočilo ukaz in je
 * bilo obravnavano — klicatelj ga v tem primeru ne sme obravnavati še kot
 * odgovor z razlogom zavrnitve.
 */
export async function handleCommand(db: HGappDB, message: TelegramMessage): Promise<boolean> {
  const text = message.text?.trim()
  if (!text || !text.startsWith('/')) return false

  const command = normalizeCommand(text)
  if (command !== '/stanje') {
    // Neznan ukaz namenoma tiho prezremo: v skupini so lahko tudi drugi boti
    // in odgovarjanje na tuje ukaze bi bilo motenje.
    return false
  }

  const session = await db.sessions.where('status').equals('aktivna').first()
  if (!session) {
    await enqueue(db, {
      dedupKey: `stanje:${message.message_id}`,
      method: 'sendMessage',
      params: { chat_id: message.chat.id, text: 'Trenutno ni aktivne seje.' },
    })
    return true
  }

  const [sessionPlayers, totals] = await Promise.all([
    listSessionPlayers(db, session.id),
    sessionTotals(db, session.id),
  ])

  const rows: StandingRow[] = []
  for (const sp of sessionPlayers) {
    const player = await db.players.get(sp.playerId)
    const bucket = totals.perPlayer[sp.playerId] ?? { takenCents: 0, paidCents: 0 }
    rows.push({
      name: player?.name ?? 'Neznan igralec',
      takenCents: bucket.takenCents,
      paidCents: bucket.paidCents,
    })
  }

  await enqueue(db, {
    // Ključ vsebuje message_id, zato je vsak zahtevek svoj — `/stanje` se sme
    // ponoviti, isti zahtevek pa se ne sme obdelati dvakrat.
    dedupKey: `stanje:${message.message_id}`,
    method: 'sendMessage',
    params: { chat_id: message.chat.id, text: formatCurrentStandings(rows, totals.boxCents) },
    relatedTable: 'sessions',
    relatedId: session.id,
  })

  return true
}
