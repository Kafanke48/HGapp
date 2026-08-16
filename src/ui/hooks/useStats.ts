import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/schema.ts'
import { computeForSession, listPlayers, listSessions, readSettings } from '../../db/repositories/index.ts'
import type { DiscrepancyRecord } from '../../db/types.ts'
import type { DiscrepancyMethod } from '../../domain/settlement/types.ts'
import type { Cents } from '../../domain/money.ts'
import { centsForCsv } from '../../domain/csv.ts'
import { computePlayerStats, playersInResults, type PlayerStats, type SessionResult } from '../../domain/stats.ts'

/**
 * Zgodovina in statistika (spec, razdelek 9).
 *
 * Samo BRANJE — nikoli klic funkcije, ki piše, znotraj `useLiveQuery`. Dexie
 * znotraj `liveQuery` zavrže vsak poskus pisanja z `ReadOnlyError`, kar je
 * aplikacijo na tem mestu že dvakrat sesulo v bel zaslon (glej opombo v
 * useSettings.ts in debts.ts) — zato tu beremo izključno prek `readSettings`,
 * `listSessions`, `listPlayers` in `computeForSession` (slednji sam ne piše,
 * glej settlement.ts: "vrne rezultat BREZ pisanja v bazo").
 */

export type DateRangeFilter = 'vse' | 'zadnji-3-meseci' | 'letos'

export interface StatsFilters {
  dateRange: DateRangeFilter
  /** null pomeni "vse lokacije". */
  location: string | null
}

export interface StatsData {
  /** True, brž ko je bila KADAR KOLI poravnana vsaj ena seja — neodvisno od trenutnih filtrov. Loči "prazno praznino" od "filter je vse skril". */
  hasAnySettled: boolean
  /** Vse lokacije, ki se pojavijo v KATERI KOLI poravnani seji — za spustni seznam filtra, neodvisno od trenutno izbranega filtra. */
  locations: string[]
  /** Rezultati sej, ki ustrezajo trenutnim filtrom. */
  results: SessionResult[]
  /** Lestvica igralcev, izračunana iz `results` (že filtrirano). */
  playerStats: PlayerStats[]
  /** Ime igralca po playerId, za prikaz. */
  playerNames: Record<string, string>
  /** Stabilen, s filtri NEODVISEN vrstni red VSEH igralcev, ki so kdaj nastopali v poravnani seji — uporabi ga SaldoChart za barvne reže, da filter, ki izloči enega igralca, ne prebarva ostalih. */
  stablePlayerOrder: string[]
  sessionCount: number
  /** PlayerId lastnika aplikacije (glej AppSettings.hostPlayerId) — null, dokler ni nastavljen v Nastavitvah. */
  ownerPlayerId: string | null
  /** Skupni neto lastnika znotraj trenutnih filtrov. null samo, kadar `ownerPlayerId` sploh ni nastavljen. */
  ownerNetCents: Cents | null
}

/**
 * Iz shranjenega `DiscrepancyRecord` obnovi `DiscrepancyMethod`, ki ga
 * pričakuje `computeForSession`. To je edini način, da zgodovina prikaže
 * ISTO številko, kot je bila dejansko izplačana — obračun neskladja in
 * delitve stroškov se ne sme na tem mestu ponoviti na roko, ker bi lahko
 * tiho odstopal od tega, kar je bilo dejansko poravnano.
 */
function reconstructDiscrepancyMethod(record: DiscrepancyRecord): DiscrepancyMethod {
  switch (record.method) {
    case 'enakomerno':
      return { method: 'enakomerno' }
    case 'sorazmerno':
      return { method: 'sorazmerno' }
    case 'pripisi':
      if (!record.assignedPlayerId) {
        throw new Error(`Zapis neskladja seje ${record.sessionId} je 'pripisi', a manjka assignedPlayerId.`)
      }
      return { method: 'pripisi', playerId: record.assignedPlayerId }
    case 'rocno':
      return { method: 'rocno', adjustmentsCents: record.adjustmentsCents, note: record.note ?? '' }
  }
}

function sessionPlayedAt(session: { settledAt: number | null; endedAt: number | null; startedAt: number | null; createdAt: number }): number {
  return session.settledAt ?? session.endedAt ?? session.startedAt ?? session.createdAt
}

/**
 * Prebere VSE poravnane seje in za vsako ponovno požene tesnino testiran
 * obračun (`computeForSession`), namesto da bi sama preračunala `C − B`. Surov
 * `C − B` bi tiho prezrl razrešitev neskladja žetonov in delitev stroškov —
 * zgodovina bi kazala številko, ki se ne ujema s tem, kar je nekdo dejansko
 * prejel ali plačal. To je edini razlog, da tem številkam sploh lahko zaupamo.
 *
 * Seja, ki jo je nemogoče izračunati (npr. star zapis brez cashout-a), se
 * PRESKOČI z opozorilom v konzoli — ena poškodovana seja ne sme sesuti
 * celotnega zaslona zgodovine.
 */
async function loadSettledSessionResults(): Promise<SessionResult[]> {
  const sessions = await listSessions(db)
  const settled = sessions.filter((s) => s.status === 'poravnana')

  const results: SessionResult[] = []
  for (const session of settled) {
    try {
      const discrepancyRecord = await db.discrepancies.where('sessionId').equals(session.id).first()
      const discrepancy = discrepancyRecord ? reconstructDiscrepancyMethod(discrepancyRecord) : null
      const result = await computeForSession(db, session.id, { discrepancy })
      results.push({
        sessionId: session.id,
        playedAt: sessionPlayedAt(session),
        location: session.location,
        netByPlayer: result.netCents,
      })
    } catch (err) {
      console.warn(
        `Zgodovina: seja ${session.id} je preskočena — obračuna ni bilo mogoče obnoviti (${
          err instanceof Error ? err.message : String(err)
        }).`,
      )
    }
  }
  return results
}

function withinDateRange(playedAt: number, range: DateRangeFilter, now: number): boolean {
  if (range === 'vse') return true
  if (range === 'letos') return new Date(playedAt).getFullYear() === new Date(now).getFullYear()
  // 'zadnji-3-meseci': koledarski meseci, ne fiksnih 90 dni, da se meja ne premika za en dan zaradi prestopnih let ipd.
  const cutoff = new Date(now)
  cutoff.setMonth(cutoff.getMonth() - 3)
  return playedAt >= cutoff.getTime()
}

/**
 * Vsi podatki za `ZgodovinaScreen`, izračunani iz VSEH poravnanih sej in nato
 * zoženi na trenutne filtre. `locations` in `stablePlayerOrder` namerno
 * izhajata iz NEfiltriranega nabora, da spustni seznam lokacij in barvne reže
 * igralcev ne "poskakujejo", ko uporabnik spreminja filter.
 */
export function useStats(filters: StatsFilters): StatsData | undefined {
  return useLiveQuery(async () => {
    const [allResults, players, settings] = await Promise.all([
      loadSettledSessionResults(),
      listPlayers(db, { includeArchived: true }),
      readSettings(db),
    ])

    const hasAnySettled = allResults.length > 0

    const locationSet = new Set<string>()
    for (const r of allResults) {
      if (r.location) locationSet.add(r.location)
    }
    const locations = [...locationSet].sort((a, b) => a.localeCompare(b, 'sl'))

    // Stabilen vrstni red VSEH igralcev, ki so kdaj nastopali v poravnani seji.
    //
    // Urejeno po `createdAt` igralca, NE po imenu: barvna reža mora pripadati
    // igralcu za vedno. Po imenu bi nov igralec "Bine" pristal med "Ano" in
    // "Cenetom" in prestavil barve vsem za sabo — lestvica in graf bi po vsakem
    // novem igralcu izgledala kot tuja. Po `createdAt` se novi vedno pripnejo
    // na konec, zato obstoječi igralci barve nikoli ne izgubijo. Preimenovanje
    // iz istega razloga ne sme vplivati na barvo.
    const everPlayedIds = new Set(playersInResults(allResults))
    const createdAtById = new Map(players.map((p) => [p.id, p.createdAt] as const))
    const stablePlayerOrder = [...everPlayedIds].sort((a, b) => {
      const ca = createdAtById.get(a) ?? 0
      const cb = createdAtById.get(b) ?? 0
      // Enak createdAt (npr. uvoz iz varnostne kopije) razrešimo po id — ta je
      // nespremenljiv, zato je izid determinističen.
      return ca - cb || (a < b ? -1 : a > b ? 1 : 0)
    })

    const now = Date.now()
    const results = allResults.filter(
      (r) => withinDateRange(r.playedAt, filters.dateRange, now) && (filters.location === null || r.location === filters.location),
    )

    const playerStats = computePlayerStats(results)
    const playerNames: Record<string, string> = {}
    for (const p of players) playerNames[p.id] = p.name

    const ownerPlayerId = settings.hostPlayerId
    const ownerStat = ownerPlayerId ? playerStats.find((p) => p.playerId === ownerPlayerId) : undefined
    const ownerNetCents = ownerPlayerId ? (ownerStat?.totalNetCents ?? 0) : null

    return {
      hasAnySettled,
      locations,
      results,
      playerStats,
      playerNames,
      stablePlayerOrder,
      sessionCount: results.length,
      ownerPlayerId,
      ownerNetCents,
    }
  }, [filters.dateRange, filters.location])
}

/**
 * Ena vrstica CSV izvoza na igralca na poravnano sejo (spec 9, razdelek CSV
 * izvoz): `datum;lokacija;igralec;neto`. Vključuje glavo stolpcev.
 */
export function buildCsvRows(results: readonly SessionResult[], playerNames: Record<string, string>): string[][] {
  const rows: string[][] = [['datum', 'lokacija', 'igralec', 'neto']]
  const sorted = [...results].sort((a, b) => a.playedAt - b.playedAt)
  for (const session of sorted) {
    const datum = new Date(session.playedAt).toLocaleDateString('sl-SI', {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    })
    const lokacija = session.location ?? ''
    const playerIds = Object.keys(session.netByPlayer).sort((a, b) => a.localeCompare(b, 'sl'))
    for (const playerId of playerIds) {
      const igralec = playerNames[playerId] ?? playerId
      rows.push([datum, lokacija, igralec, centsForCsv(session.netByPlayer[playerId]!)])
    }
  }
  return rows
}
