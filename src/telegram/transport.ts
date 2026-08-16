/**
 * Transportna plast za Telegram Bot API.
 *
 * `api.telegram.org` vrača `Access-Control-Allow-Origin: *` (preverjeno z
 * živim klicem, glej specifikacijo 7.1), zato lahko kličemo neposredno iz
 * brskalnika — brez strežnika, brez proxyja.
 *
 * `TelegramTransport` je vmesnik, ne konkreten fetch klic, da lahko testi
 * (in `mockTransport.ts`) vbrizgajo lažno implementacijo. Noben modul v
 * `src/telegram/` ne sme klicati `fetch` neposredno mimo tega vmesnika.
 */
import type { TelegramApiResponse } from './types.ts'

/**
 * Napaka za omrežne težave (brez povezave, DNS, itd.) ali za odgovore, ki jih
 * ni bilo mogoče razčleniti kot JSON (npr. 5xx z HTML stranjo namesto
 * Telegramovega običajnega JSON telesa napake). `outbox.ts` to obravnava
 * enako kot 5xx — z eksponentnim odmikom, ne kot trajno napako.
 */
export class TelegramNetworkError extends Error {}

/**
 * Pretvori parametre Bot API-ja v form-urlencoded telo.
 *
 * Sestavljene vrednosti (npr. `reply_markup` z inline tipkovnico ali
 * `allowed_updates`) Telegram pričakuje kot JSON NIZ znotraj polja — zato jih
 * tu serializiramo posebej. `undefined` in `null` izpustimo, da ne pošljemo
 * praznih polj, ki bi jih Telegram razumel kot vrednost.
 */
export function encodeParams(params: Record<string, unknown>): URLSearchParams {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    body.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
  }
  return body
}

export interface TelegramTransport {
  /**
   * Pokliče metodo Bot API-ja. `token` gre samo v URL zahteve (glej varnostno
   * zahtevo v specifikaciji 7.8 in nalogi) — nikoli v vrnjeno vrednost, dnevnik
   * ali napako.
   */
  callMethod<T>(token: string, method: string, params?: Record<string, unknown>): Promise<TelegramApiResponse<T>>
}

/**
 * Prava implementacija prek `fetch`. Token je viden IZKLJUČNO v URL-ju te
 * zahteve — ni ga nikjer drugje v tej datoteki (glej varnostno zahtevo).
 */
export const realTelegramTransport: TelegramTransport = {
  async callMethod<T>(token: string, method: string, params: Record<string, unknown> = {}): Promise<TelegramApiResponse<T>> {
    const url = `https://api.telegram.org/bot${token}/${method}`
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        // NAMERNO form-urlencoded in NE application/json.
        //
        // `application/json` naredi zahtevo "nepreprosto", zato brskalnik pred
        // njo pošlje preflight OPTIONS — Telegram pa na OPTIONS odgovori s
        // 501 Not Implemented. Brskalnik tak preflight zavrne in zahteva
        // nikoli ne odide (opaženo kot "blocked by CORS policy: Response to
        // preflight request doesn't pass access control check").
        //
        // form-urlencoded je ena od treh vrst, ki preflighta NE sprožijo, zato
        // gre zahteva naravnost ven. Content-Type namenoma ne nastavljamo sami
        // — brskalnik ga za URLSearchParams postavi pravilno; ročno nastavljanje
        // bi ga lahko spet spremenilo v nepreprosto zahtevo.
        body: encodeParams(params),
      })
    } catch (err) {
      // Brez interneta, DNS napaka ipd. — obravnavamo enako kot 5xx.
      throw new TelegramNetworkError(err instanceof Error ? err.message : 'Napaka omrežja pri klicu Telegrama')
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      // Telegram ob 4xx/5xx praviloma vrne JSON telo napake; če ga ni,
      // gre za nepričakovano infrastrukturno napako (npr. HTML stran).
      throw new TelegramNetworkError(`Nepričakovan (ne-JSON) odgovor Telegrama, status ${response.status}`)
    }

    return body as TelegramApiResponse<T>
  },
}
