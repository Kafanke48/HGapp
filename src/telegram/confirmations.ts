/**
 * Stanjski avtomat potrjevanja buy-inov (glej specifikacijo 7.5).
 *
 * NAMERNA ODLOČITEV: potrjevanje je nezavezujoče in izključno informativno.
 * Buy-in šteje v izračun TAKOJ ob vnosu in ostane veljaven ne glede na to,
 * kaj igralec kasneje odgovori na Telegramu — tudi zavrnitev NIKOLI ne
 * spremeni nobenega zneska tiho. Zavrnitev le dvigne zastavico
 * (`confirmation: 'zavrnjen'` + `rejectionReason`), na katero se odzove
 * gostitelj ročno. Samodejna sprememba bi lahko podrla kontrolo blagajne, ne
 * da bi kdo opazil (glej `sessionTotals` v `db/repositories/buyins.ts`, ki
 * namerno filtrira samo po `voided`, nikoli po `confirmation`).
 */
import type { HGappDB } from '../db/schema.ts'
import type { BuyIn, Player } from '../db/types.ts'
import { now } from '../db/ids.ts'
import { setConfirmation } from '../db/repositories/buyins.ts'
import { enqueue } from './outbox.ts'
import { handleCommand } from './commands.ts'
import { formatBuyInConfirmationPrompt } from './formatters.ts'
import type { TelegramCallbackQuery, TelegramMessage } from './types.ts'

/**
 * Odgovori na `callback_query` moramo Telegramu poslati vedno, tudi kadar je
 * zadeven buy-in medtem izginil — sicer se uporabnikov gumb v Telegramovem
 * klientu vrti v neskončnost. Po tem času odgovor ni več smiseln (Telegram ga
 * itak ignorira), zato ga `drain()` raje zavrže kot pošlje zastarelega.
 */
const ANSWER_CALLBACK_TTL_MS = 2 * 60_000

function callbackAnswerDedupKey(callbackQueryId: string): string {
  return `answer-callback:${callbackQueryId}`
}

/** Pošlje potrditveno DM sporočilo z gumboma [Potrdim] [Zavrnem] (glej spec 7.5). */
export async function enqueueConfirmationPrompt(db: HGappDB, player: Player, buyIn: BuyIn): Promise<void> {
  // Igralec brez povezanega Telegram računa je NORMALNO stanje, ne napaka
  // (glej spec 7.3) — preprosto ne prejema zasebnih sporočil.
  if (!player.telegramUserId) return

  await enqueue(db, {
    dedupKey: `confirm-prompt:${buyIn.id}`,
    method: 'sendMessage',
    params: {
      chat_id: player.telegramUserId,
      text: formatBuyInConfirmationPrompt(buyIn.amountCents, buyIn.paymentMethod),
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Potrdim', callback_data: `confirm:${buyIn.id}` },
            { text: 'Zavrnem', callback_data: `reject:${buyIn.id}` },
          ],
        ],
      },
    },
    relatedTable: 'buyIns',
    relatedId: buyIn.id,
  })
}

/**
 * Obdela pritisk na [Potrdim]/[Zavrnem]. VEDNO pokliče `answerCallbackQuery`
 * (prek vrste) — tudi kadar buy-in ne obstaja več, kar zabeleži z opozorilom
 * namesto da bi klienta pustili v neskončnem vrtenju.
 */
export async function handleCallbackQuery(db: HGappDB, callbackQuery: TelegramCallbackQuery): Promise<void> {
  const data = callbackQuery.data ?? ''
  const separatorIndex = data.indexOf(':')
  const action = separatorIndex === -1 ? data : data.slice(0, separatorIndex)
  const buyInId = separatorIndex === -1 ? '' : data.slice(separatorIndex + 1)

  const buyIn = buyInId ? await db.buyIns.get(buyInId) : undefined

  if (!buyIn) {
    // eslint-disable-next-line no-console -- namerno: vidno opozorilo za gostitelja med razvojem/uporabo, brez tokena
    console.warn(`Telegram: prejet callback za neobstoječi buy-in (id="${buyInId}")`)
    await enqueue(db, {
      dedupKey: callbackAnswerDedupKey(callbackQuery.id),
      method: 'answerCallbackQuery',
      params: { callback_query_id: callbackQuery.id, text: 'Ta buy-in ne obstaja več.' },
      expiresAt: now() + ANSWER_CALLBACK_TTL_MS,
    })
    return
  }

  if (action === 'confirm') {
    await setConfirmation(db, buyIn.id, 'potrjen')
    await enqueue(db, {
      dedupKey: callbackAnswerDedupKey(callbackQuery.id),
      method: 'answerCallbackQuery',
      params: { callback_query_id: callbackQuery.id, text: 'Potrjeno, hvala.' },
      relatedTable: 'buyIns',
      relatedId: buyIn.id,
      expiresAt: now() + ANSWER_CALLBACK_TTL_MS,
    })
    return
  }

  if (action === 'reject') {
    // Razlog še ni znan — pripnemo ga, ko igralec odgovori (glej `handleMessage`).
    // To NE spremeni izračuna (glej komentar na vrhu datoteke), le dvigne zastavico.
    await setConfirmation(db, buyIn.id, 'zavrnjen', null)
    await enqueue(db, {
      dedupKey: callbackAnswerDedupKey(callbackQuery.id),
      method: 'answerCallbackQuery',
      params: { callback_query_id: callbackQuery.id, text: 'Zavrnjeno — prosim, napiši razlog.' },
      relatedTable: 'buyIns',
      relatedId: buyIn.id,
      expiresAt: now() + ANSWER_CALLBACK_TTL_MS,
    })

    const chatId = callbackQuery.message?.chat.id
    if (chatId !== undefined) {
      await enqueue(db, {
        dedupKey: `reject-reason-prompt:${buyIn.id}`,
        method: 'sendMessage',
        params: {
          chat_id: chatId,
          text: 'Razlog za zavrnitev?',
          reply_markup: { force_reply: true },
        },
        relatedTable: 'buyIns',
        relatedId: buyIn.id,
      })
    }
    return
  }

  // Neznano dejanje (npr. iz stare različice aplikacije) — kljub temu odgovorimo.
  await enqueue(db, {
    dedupKey: callbackAnswerDedupKey(callbackQuery.id),
    method: 'answerCallbackQuery',
    params: { callback_query_id: callbackQuery.id },
    expiresAt: now() + ANSWER_CALLBACK_TTL_MS,
  })
}

/**
 * Obdela navadno (ne-gumbno) zasebno sporočilo igralca.
 *
 * Realnost je, da igralci pogosto NE uporabijo Telegramovega "Reply", ampak
 * preprosto natipkajo razlog kot navadno sporočilo (glej spec/nalogo). Zato
 * tu ne preverjamo `reply_to_message` — vsako prosto besedilo od igralca, ki
 * ima nerazložen zavrnjen buy-in, štejemo kot odgovor na najnovejšega od njih.
 */
export async function handleMessage(db: HGappDB, message: TelegramMessage): Promise<void> {
  const text = message.text
  if (!text || text.trim() === '') return

  // Ukazi (npr. /stanje) niso razlog zavrnitve.
  if (await handleCommand(db, message)) return

  // SAMO zasebni klepet. Brez te omejitve bi vsako sporočilo igralca V SKUPINI
  // pristalo kot razlog zavrnitve njegovega buy-ina — dovolj je, da nekdo
  // zavrne buy-in in nato v skupini vpraša "kdaj se dobimo?", pa se to tiho
  // zapiše kot razlog. Razlog se zbira izključno prek zasebnega sporočila.
  if (message.chat.type !== 'private') return

  const tgUserId = message.from ? String(message.from.id) : ''
  if (!tgUserId) return

  const player = await db.players.where('telegramUserId').equals(tgUserId).first()
  if (!player) return // Nepovezan pošiljatelj — normalno stanje, ne napaka (glej spec 7.3).

  const pending = await findMostRecentUnexplainedRejection(db, player.id)
  if (!pending) return

  await setConfirmation(db, pending.id, 'zavrnjen', text.trim())
}

async function findMostRecentUnexplainedRejection(db: HGappDB, playerId: string): Promise<BuyIn | undefined> {
  const buyIns = await db.buyIns.where('playerId').equals(playerId).toArray()
  const candidates = buyIns.filter((b) => !b.voided && b.confirmation === 'zavrnjen' && b.rejectionReason === null)
  candidates.sort((a, b) => b.createdAt - a.createdAt)
  return candidates[0]
}
