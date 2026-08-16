import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { formatEur } from '../../domain/money.ts'
import { computeCumulativeSeries, playersInResults, type CumulativePoint, type SessionResult } from '../../domain/stats.ts'

/**
 * Kategorijska paleta za identiteto igralca v grafu (validirano: ločljivost za
 * barvno slepoto, kroma, kontrast na `--color-surface` #161c26).
 *
 * TA VRSTNI RED IN TE HEKSADECIMALNE VREDNOSTI SE NE SPREMINJAJO. Uporabljene
 * so IZKLJUČNO tu, za identiteto serije — nikjer drugje, in nikoli namesto
 * `text-jade`/`text-oxblood` (dobiček/izguba) ali medenine (rezervirana za
 * blagajno, glej BlagajnaStrip.tsx).
 */
const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'] as const
const MAX_SERIES = PALETTE.length

interface SaldoChartProps {
  /** Že filtrirani rezultati sej (glej useStats) — vhod je vedno poravnan obračun, ne surov C−B. */
  results: readonly SessionResult[]
  /**
   * Stabilen, S FILTRI NEODVISEN vrstni red VSEH igralcev, ki so kdaj
   * nastopali (glej useStats.stablePlayerOrder). Barvna reža igralca je
   * njegov položaj v TEM seznamu, mod 6 — tako filter, ki izloči enega
   * igralca, nikoli ne prebarva preostalih (barva sledi igralcu, ne rangu).
   */
  stablePlayerOrder: readonly string[]
  playerNames: Readonly<Record<string, string>>
}

interface SeriesDatum {
  playerId: string
  name: string
  colorIndex: number
  points: CumulativePoint[]
  totalNetCents: number
}

function buildSeries(
  results: readonly SessionResult[],
  stablePlayerOrder: readonly string[],
  playerNames: Readonly<Record<string, string>>,
): SeriesDatum[] {
  const slotById = new Map(stablePlayerOrder.map((id, i) => [id, i % MAX_SERIES]))
  const ids = playersInResults(results)
  return ids.map((id) => {
    const points = computeCumulativeSeries(results, id)
    return {
      playerId: id,
      name: playerNames[id] ?? id,
      colorIndex: slotById.get(id) ?? 0,
      points,
      totalNetCents: points.length > 0 ? points[points.length - 1]!.cumulativeCents : 0,
    }
  })
}

function defaultSelection(series: readonly SeriesDatum[]): Set<string> {
  const top = [...series].sort((a, b) => Math.abs(b.totalNetCents) - Math.abs(a.totalNetCents)).slice(0, MAX_SERIES)
  return new Set(top.map((s) => s.playerId))
}

function nearestPoint(points: readonly CumulativePoint[], t: number): CumulativePoint | undefined {
  let best: CumulativePoint | undefined
  let bestDiff = Infinity
  for (const p of points) {
    const diff = Math.abs(p.playedAt - t)
    if (diff < bestDiff) {
      bestDiff = diff
      best = p
    }
  }
  return best
}

function formatAxisDate(ts: number): string {
  return new Date(ts).toLocaleDateString('sl-SI', { day: 'numeric', month: 'numeric' })
}

function formatFullDate(ts: number): string {
  return new Date(ts).toLocaleDateString('sl-SI', { day: 'numeric', month: 'numeric', year: 'numeric' })
}

const VB_WIDTH = 340
const VB_HEIGHT = 210
const MARGIN_TOP = 14
const MARGIN_BOTTOM = 26

/**
 * Saldo skozi čas, po igralcu — večserijski kumulativni linijski graf,
 * ročno narisan v SVG (brez knjižnice za grafe: aplikacija mora ostati
 * lahkotna in v celoti offline, glej spec 10.2).
 */
export function SaldoChart({ results, stablePlayerOrder, playerNames }: SaldoChartProps) {
  const series = useMemo(
    () => buildSeries(results, stablePlayerOrder, playerNames),
    [results, stablePlayerOrder, playerNames],
  )
  const seriesByName = useMemo(() => [...series].sort((a, b) => a.name.localeCompare(b.name, 'sl')), [series])
  const idsKey = useMemo(() => series.map((s) => s.playerId).sort().join('|'), [series])

  const [selected, setSelected] = useState<Set<string>>(() => defaultSelection(series))
  const prevKey = useRef(idsKey)
  useEffect(() => {
    if (prevKey.current !== idsKey) {
      prevKey.current = idsKey
      setSelected(defaultSelection(series))
    }
    // `series` je namerno izven odvisnosti: ponovni izračun privzete izbire
    // sprožimo samo, ko se SPREMENI nabor igralcev (idsKey), ne ob vsakem
    // preračunu vsot — sicer bi vsak nov filter povozil uporabnikov izbor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])

  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        // Trdna zgornja meja: nikoli ne prižgemo 7. serije — barv je natanko 6.
        if (next.size >= MAX_SERIES) return prev
        next.add(id)
      }
      return next
    })
  }

  if (series.length === 0) {
    return (
      <div className="tile flex items-center justify-center p-6">
        <p className="text-bone-dim text-center text-sm">Ni podatkov za izbrano obdobje.</p>
      </div>
    )
  }

  const visible = seriesByName.filter((s) => selected.has(s.playerId))

  const allPoints = visible.flatMap((s) => s.points)
  const hasAnyPoints = allPoints.length > 0

  const times = [...new Set(allPoints.map((p) => p.playedAt))].sort((a, b) => a - b)
  const minT = times[0] ?? 0
  const maxT = times[times.length - 1] ?? 0

  let minC = Math.min(0, ...allPoints.map((p) => p.cumulativeCents))
  let maxC = Math.max(0, ...allPoints.map((p) => p.cumulativeCents))
  if (minC === maxC) {
    // Enake vrednosti (vključno s samimi ničlami) ne smejo sesuti skale na
    // višino 0 — umetno razširimo obseg, da je ravna črta sploh vidna.
    const pad = Math.max(Math.round(Math.abs(maxC) * 0.2), 1000)
    minC -= pad
    maxC += pad
  }

  const showDirectLabels = visible.length > 0 && visible.length <= 4
  const marginLeft = 50
  const marginRight = showDirectLabels ? 62 : 12
  const innerWidth = VB_WIDTH - marginLeft - marginRight
  const innerHeight = VB_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM

  const xScale = (t: number): number => (minT === maxT ? marginLeft + innerWidth / 2 : marginLeft + ((t - minT) / (maxT - minT)) * innerWidth)
  const yScale = (c: number): number => MARGIN_TOP + (1 - (c - minC) / (maxC - minC)) * innerHeight

  const yTickCount = 4
  const yTicks = Array.from({ length: yTickCount + 1 }, (_, i) => minC + ((maxC - minC) * i) / yTickCount)
  const zeroY = yScale(0)

  function handlePointer(e: ReactPointerEvent<SVGRectElement>): void {
    if (times.length === 0) return
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    const vbX = ratio * VB_WIDTH
    // Najdi najbližji dejanski čas seje glede na x pozicijo kazalca.
    let best = times[0]!
    let bestDiff = Infinity
    for (const t of times) {
      const diff = Math.abs(xScale(t) - vbX)
      if (diff < bestDiff) {
        bestDiff = diff
        best = t
      }
    }
    setHoverTime(best)
  }

  const hoverEntries =
    hoverTime === null
      ? []
      : visible
          .map((s) => ({ s, point: nearestPoint(s.points, hoverTime) }))
          .filter((e): e is { s: SeriesDatum; point: CumulativePoint } => e.point !== undefined)

  const hoverXPercent = hoverTime === null ? null : (xScale(hoverTime) / VB_WIDTH) * 100
  const tooltipLeftPercent = hoverXPercent === null ? null : Math.min(86, Math.max(14, hoverXPercent))

  return (
    <div>
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
          className="block w-full"
          style={{ height: 'auto' }}
          role="img"
          aria-label="Saldo skozi čas po igralcu"
        >
          {/* Mreža — recesivna, ne sme tekmovati z linijami serij za pozornost. */}
          {yTicks.map((val, i) => {
            const y = yScale(val)
            return (
              <g key={i}>
                <line
                  x1={marginLeft}
                  x2={VB_WIDTH - marginRight}
                  y1={y}
                  y2={y}
                  stroke="var(--color-bone-faint)"
                  strokeWidth={1}
                  strokeOpacity={0.35}
                  strokeDasharray="2 3"
                />
                <text x={marginLeft - 6} y={y} textAnchor="end" dominantBaseline="middle" className="num" fill="var(--color-bone-dim)" fontSize={8}>
                  {formatEur(Math.round(val))}
                </text>
              </g>
            )
          })}

          {/* Ničelna izhodiščna črta — vidno RAZLIČNA od mreže, ker je prehod čez njo bistvo grafa. */}
          <line
            x1={marginLeft}
            x2={VB_WIDTH - marginRight}
            y1={zeroY}
            y2={zeroY}
            stroke="var(--color-line)"
            strokeWidth={1.5}
          />

          {/* Datumska os: prvi, srednji in zadnji čas. */}
          {hasAnyPoints && (
            <>
              <text x={marginLeft} y={VB_HEIGHT - 8} textAnchor="start" fill="var(--color-bone-dim)" fontSize={8}>
                {formatAxisDate(minT)}
              </text>
              {minT !== maxT && (
                <text x={(marginLeft + (VB_WIDTH - marginRight)) / 2} y={VB_HEIGHT - 8} textAnchor="middle" fill="var(--color-bone-dim)" fontSize={8}>
                  {formatAxisDate(times[Math.floor(times.length / 2)]!)}
                </text>
              )}
              {minT !== maxT && (
                <text x={VB_WIDTH - marginRight} y={VB_HEIGHT - 8} textAnchor="end" fill="var(--color-bone-dim)" fontSize={8}>
                  {formatAxisDate(maxT)}
                </text>
              )}
            </>
          )}

          {/* Navpična vodilna črta ob dotiku/kazalcu. */}
          {hoverTime !== null && (
            <line
              x1={xScale(hoverTime)}
              x2={xScale(hoverTime)}
              y1={MARGIN_TOP}
              y2={VB_HEIGHT - MARGIN_BOTTOM}
              stroke="var(--color-bone-faint)"
              strokeWidth={1}
            />
          )}

          {visible.map((s) => {
            const color = PALETTE[s.colorIndex]!
            const last = s.points[s.points.length - 1]!
            return (
              <g key={s.playerId}>
                {s.points.length >= 2 && (
                  <polyline
                    points={s.points.map((p) => `${xScale(p.playedAt)},${yScale(p.cumulativeCents)}`).join(' ')}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                {s.points.map((p) => (
                  <g key={p.sessionId}>
                    {/* Nevidno večje tarčno območje — najmanj 8px v prikazani velikosti. */}
                    <circle cx={xScale(p.playedAt)} cy={yScale(p.cumulativeCents)} r={8} fill="transparent" />
                    <circle cx={xScale(p.playedAt)} cy={yScale(p.cumulativeCents)} r={3} fill={color} />
                  </g>
                ))}
                {showDirectLabels && (
                  // Neposredna oznaka na koncu vrstice: BESEDILNI žeton (bone), NIKOLI
                  // pobarvan z barvo serije — barva je rezervirana za same oznake/črte.
                  <text
                    x={xScale(last.playedAt) + 6}
                    y={yScale(last.cumulativeCents)}
                    dominantBaseline="middle"
                    fill="var(--color-bone)"
                    fontSize={8}
                    fontWeight={600}
                  >
                    {s.name.length > 10 ? `${s.name.slice(0, 9)}…` : s.name}
                  </text>
                )}
              </g>
            )
          })}

          {/* Prekrivna plast za dotik/kazalec: nariše prek celotnega risalnega območja. */}
          <rect
            x={marginLeft}
            y={MARGIN_TOP}
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            onPointerMove={handlePointer}
            onPointerDown={handlePointer}
            onPointerLeave={() => setHoverTime(null)}
          />
        </svg>

        {hoverEntries.length > 0 && tooltipLeftPercent !== null && (
          <div
            className="border-line bg-raised pointer-events-none absolute top-1 max-w-[85%] -translate-x-1/2 rounded-lg border px-2.5 py-1.5 text-[0.6875rem] shadow-none"
            style={{ left: `${tooltipLeftPercent}%` }}
          >
            <p className="text-bone-dim mb-1 font-medium">{formatFullDate(hoverTime!)}</p>
            <ul className="space-y-0.5">
              {hoverEntries.map(({ s, point }) => (
                <li key={s.playerId} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: PALETTE[s.colorIndex] }}
                    aria-hidden="true"
                  />
                  <span className="text-bone-dim">{s.name}</span>
                  <span className={`num ml-auto font-semibold ${point.cumulativeCents > 0 ? 'text-jade' : point.cumulativeCents < 0 ? 'text-oxblood' : 'text-bone'}`}>
                    {formatEur(point.cumulativeCents)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Legenda — VEDNO prisotna, tudi kadar je direktna oznaka na voljo:
          barva sama nikoli ni edini nosilec identitete. Tap preklopi prikaz;
          nad mejo 6 hkrati prikazanih serij se dodajanje ustavi (glej toggle). */}
      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5" aria-label="Prikazani igralci">
        {seriesByName.map((s) => {
          const isSelected = selected.has(s.playerId)
          const capReached = !isSelected && selected.size >= MAX_SERIES
          return (
            <li key={s.playerId}>
              <button
                type="button"
                onClick={() => toggle(s.playerId)}
                disabled={capReached}
                aria-pressed={isSelected}
                className={`flex min-h-11 items-center gap-1.5 rounded-lg px-1.5 text-[0.8125rem] font-medium ${
                  isSelected ? 'text-bone' : 'text-bone-faint'
                } ${capReached ? 'opacity-40' : ''}`}
              >
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: PALETTE[s.colorIndex], opacity: isSelected ? 1 : 0.35 }}
                  aria-hidden="true"
                />
                {s.name}
              </button>
            </li>
          )
        })}
      </ul>
      {series.length > MAX_SERIES && (
        <p className="text-bone-faint mt-1 text-[0.6875rem]">Hkrati je prikazanih največ {MAX_SERIES} igralcev.</p>
      )}
    </div>
  )
}
