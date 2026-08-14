/**
 * Lažni transport za razvoj in teste. Beleži vse klice in vrača vnaprej
 * pripravljene (ali privzete) odgovore — nikoli ne pride blizu pravega
 * omrežja (glej specifikacijo 12: "razvoj proti lažnemu transportu, nikoli
 * proti pravi skupini").
 */
import type { TelegramApiResponse } from './types.ts'
import { TelegramNetworkError, type TelegramTransport } from './transport.ts'

export interface RecordedCall {
  token: string
  method: string
  params: Record<string, unknown>
}

/** En element v vrsti odgovorov: ali uspešen/napačen JSON odgovor, ali simulacija omrežne napake. */
export type QueuedOutcome<T = unknown> = TelegramApiResponse<T> | { networkError: string }

export type DefaultHandler = (method: string, params: Record<string, unknown>) => QueuedOutcome

function defaultOkHandler(): QueuedOutcome {
  return { ok: true, result: {} }
}

export interface MockTelegramTransport {
  transport: TelegramTransport
  /** Vsi klici v vrstnem redu, kot so bili izvedeni. */
  calls: RecordedCall[]
  /** Doda odgovor na konec vrste (FIFO) — porabi ga naslednji klic `callMethod`. */
  queueResponse(outcome: QueuedOutcome): void
  /** Privzeti odgovor, kadar je vrsta prazna (privzeto: uspešen prazen odgovor). */
  setDefaultHandler(handler: DefaultHandler): void
  /** Pomožno: prešteje klice dane metode. */
  countCalls(method: string): number
}

export function createMockTransport(): MockTelegramTransport {
  const calls: RecordedCall[] = []
  const queue: QueuedOutcome[] = []
  let defaultHandler: DefaultHandler = defaultOkHandler

  const transport: TelegramTransport = {
    async callMethod<T>(token: string, method: string, params: Record<string, unknown> = {}): Promise<TelegramApiResponse<T>> {
      calls.push({ token, method, params })
      const outcome = queue.shift() ?? defaultHandler(method, params)
      if ('networkError' in outcome) {
        throw new TelegramNetworkError(outcome.networkError)
      }
      return outcome as TelegramApiResponse<T>
    },
  }

  return {
    transport,
    calls,
    queueResponse(outcome) {
      queue.push(outcome)
    },
    setDefaultHandler(handler) {
      defaultHandler = handler
    },
    countCalls(method) {
      return calls.filter((c) => c.method === method).length
    },
  }
}
