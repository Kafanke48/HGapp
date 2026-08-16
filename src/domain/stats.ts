import type { Cents } from './money.ts'
import { sumCents } from './money.ts'

/**
 * Statistika zgodovine sej. Ta datoteka je ČISTA: brez baze, brez Reacta,
 * brez `Date.now()`, brez `Math.random()`. Vhod je vedno že poravnan
 * rezultat seje (glej settlement/types.ts) — ne dostopa do Dexie.
 */

/** Rezultat ene poravnane seje. */
export interface SessionResult {
  sessionId: string
  playedAt: number // epoch ms
  location: string | null
  netByPlayer: Readonly<Record<string, Cents>> // koncni neto po igralcu; vsota je 0
}

export interface PlayerStats {
  playerId: string
  sessionCount: number
  totalNetCents: Cents
  averageNetCents: Cents // celo stevilo centov
  bestCents: Cents // najboljsa posamezna seja
  worstCents: Cents // najslabsa posamezna seja
  winningSessions: number // net > 0
}

export interface CumulativePoint {
  sessionId: string
  playedAt: number
  cumulativeCents: Cents
}

/** Vsi playerId, ki nastopajo v katerem koli rezultatu. */
export function playersInResults(results: readonly SessionResult[]): string[] {
  const ids = new Set<string>()
  for (const result of results) {
    for (const playerId of Object.keys(result.netByPlayer)) {
      ids.add(playerId)
    }
  }
  return [...ids]
}

/** Urejeno padajoce po totalNetCents; pri izenacenju po playerId narascajoce. */
export function computePlayerStats(results: readonly SessionResult[]): PlayerStats[] {
  const byPlayer = new Map<string, Cents[]>()

  for (const result of results) {
    for (const [playerId, net] of Object.entries(result.netByPlayer)) {
      // Igralec, ki v tej seji ni nastopal, preprosto nima vnosa v netByPlayer —
      // ne sme se pojaviti kot 0, zato beremo izkljucno iz Object.entries.
      const list = byPlayer.get(playerId)
      if (list) {
        list.push(net)
      } else {
        byPlayer.set(playerId, [net])
      }
    }
  }

  const stats: PlayerStats[] = []
  for (const [playerId, nets] of byPlayer) {
    const sessionCount = nets.length
    const totalNetCents = sumCents(nets)
    // Zaokrozanje PROTI NIC (Math.trunc, ne Math.floor/Math.round): povprecje
    // nikoli ne sme delovati bolje ali slabse, kot je bilo dejansko odigrano.
    // Math.floor bi -100/3 spremenil v -34 (videti se je slabsi izid), Math.round
    // bi pri .5 mejah pristransko zaokrozal navzgor. Trunc odreze proti 0 v obe smeri.
    const averageNetCents = Math.trunc(totalNetCents / sessionCount)
    let bestCents = nets[0]!
    let worstCents = nets[0]!
    let winningSessions = 0
    for (const net of nets) {
      if (net > bestCents) bestCents = net
      if (net < worstCents) worstCents = net
      if (net > 0) winningSessions += 1
    }
    stats.push({
      playerId,
      sessionCount,
      totalNetCents,
      averageNetCents,
      bestCents,
      worstCents,
      winningSessions,
    })
  }

  stats.sort((a, b) => {
    if (b.totalNetCents !== a.totalNetCents) return b.totalNetCents - a.totalNetCents
    return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0
  })

  return stats
}

/** Kumulativni saldo enega igralca skozi cas, urejen po playedAt narascajoce. */
export function computeCumulativeSeries(
  results: readonly SessionResult[],
  playerId: string,
): CumulativePoint[] {
  // Filtriramo samo seje, kjer je igralec dejansko nastopal (ima vnos v netByPlayer),
  // nato razvrstimo po casu odigranja pred izracunom tekoce vsote — vhodni seznam
  // ni nujno urejen.
  const played = results
    .filter((r) => Object.prototype.hasOwnProperty.call(r.netByPlayer, playerId))
    .slice()
    .sort((a, b) => a.playedAt - b.playedAt)

  const points: CumulativePoint[] = []
  let running = 0
  for (const result of played) {
    running += result.netByPlayer[playerId]!
    points.push({
      sessionId: result.sessionId,
      playedAt: result.playedAt,
      cumulativeCents: running,
    })
  }
  return points
}
