/**
 * Tanki, tipizirani ovoji okrog posameznih metod Bot API-ja. Vsaka funkcija
 * sprejme `transport` in `token` kot parametra — brez modulnih singletonov,
 * da lahko testi vbrizgajo `mockTransport`.
 */
import type { TelegramTransport } from './transport.ts'
import type {
  AnswerCallbackQueryParams,
  GetUpdatesParams,
  SendMessageParams,
  TelegramApiResponse,
  TelegramMessage,
  TelegramUpdate,
} from './types.ts'

export function sendMessage(
  transport: TelegramTransport,
  token: string,
  params: SendMessageParams,
): Promise<TelegramApiResponse<TelegramMessage>> {
  return transport.callMethod<TelegramMessage>(token, 'sendMessage', params)
}

export function answerCallbackQuery(
  transport: TelegramTransport,
  token: string,
  params: AnswerCallbackQueryParams,
): Promise<TelegramApiResponse<true>> {
  return transport.callMethod<true>(token, 'answerCallbackQuery', params)
}

export function getUpdates(
  transport: TelegramTransport,
  token: string,
  params: GetUpdatesParams,
): Promise<TelegramApiResponse<TelegramUpdate[]>> {
  return transport.callMethod<TelegramUpdate[]>(token, 'getUpdates', params)
}

export function getMe(transport: TelegramTransport, token: string) {
  return transport.callMethod<{ id: number; username?: string }>(token, 'getMe', {})
}
