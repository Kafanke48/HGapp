/**
 * Žični tipi za Telegram Bot API — samo podmnožica, ki jo HGapp dejansko
 * uporablja (glej specifikacijo, razdelek 7). Ta datoteka je ČISTA: brez
 * uvoza baze, brez Reacta.
 *
 * Vir resnice za obliko je https://core.telegram.org/bots/api — polja tu
 * namerno večinoma opcijska, ker Telegram redno dodaja nova, mi pa
 * potrebujemo le tista, ki jih beremo.
 */

export interface TelegramUser {
  id: number
  is_bot: boolean
  first_name: string
  last_name?: string
  username?: string
}

export interface TelegramChat {
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel'
  title?: string
  username?: string
}

export interface TelegramMessage {
  message_id: number
  from?: TelegramUser
  chat: TelegramChat
  date: number
  text?: string
  /** Prisotno, kadar je uporabnik uporabil Telegramov "Reply" na naše sporočilo. */
  reply_to_message?: TelegramMessage
}

export interface TelegramCallbackQuery {
  id: string
  from: TelegramUser
  /** Sporočilo, na katerega je bil pripet inline keyboard (naša potrditvena vprašanja). */
  message?: TelegramMessage
  /** Naš `callback_data`, npr. "confirm:<buyInId>" ali "reject:<buyInId>". */
  data?: string
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  callback_query?: TelegramCallbackQuery
}

export interface InlineKeyboardButton {
  text: string
  callback_data?: string
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][]
}

export interface ForceReplyMarkup {
  force_reply: true
  selective?: boolean
}

export type ReplyMarkup = InlineKeyboardMarkup | ForceReplyMarkup

export interface SendMessageParams {
  chat_id: string | number
  text: string
  reply_markup?: ReplyMarkup
  [key: string]: unknown
}

export interface AnswerCallbackQueryParams {
  callback_query_id: string
  text?: string
  show_alert?: boolean
  [key: string]: unknown
}

export interface GetUpdatesParams {
  offset?: number
  timeout?: number
  allowed_updates?: ReadonlyArray<'message' | 'callback_query'>
  [key: string]: unknown
}

/** Uspešen odgovor Bot API-ja: `{ ok: true, result: T }`. */
export interface TelegramApiSuccess<T> {
  ok: true
  result: T
}

/**
 * Napaka Bot API-ja. `parameters.retry_after` je prisoten samo pri
 * `error_code === 429` (glej `outbox.ts` — to je edino mesto, ki mu zaupa).
 */
export interface TelegramApiError {
  ok: false
  error_code: number
  description: string
  parameters?: {
    retry_after?: number
    migrate_to_chat_id?: number
  }
}

export type TelegramApiResponse<T> = TelegramApiSuccess<T> | TelegramApiError
