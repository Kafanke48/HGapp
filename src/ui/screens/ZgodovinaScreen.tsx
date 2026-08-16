import { useState } from 'react'
import { toCsv } from '../../domain/csv.ts'
import { buildCsvRows, useStats, type DateRangeFilter } from '../hooks/useStats.ts'
import { Button } from '../components/Button.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { Money } from '../components/Money.tsx'
import { SaldoChart } from '../components/SaldoChart.tsx'

const DATE_RANGE_LABEL: Record<DateRangeFilter, string> = {
  vse: 'Vse obdobje',
  'zadnji-3-meseci': 'Zadnji 3 meseci',
  letos: 'Letos',
}

/** Slovenska dvojina za "seja". */
function sklonSeja(n: number): string {
  const r = n % 100
  if (r === 1) return 'seja'
  if (r === 2) return 'seji'
  if (r === 3 || r === 4) return 'seje'
  return 'sej'
}

interface NavigatorWithShare {
  canShare?: (data?: { files?: { name: string; type: string }[] }) => boolean
  share?: (data: { files?: File[] }) => Promise<void>
}

/**
 * Deli ali prenese CSV datoteko. Isti vzorec kot `downloadOrShareBackup` v
 * `src/platform/backup.ts` (deljenje prek iOS Share Sheeta, `<a download>`
 * blob kot nadomestilo) — namerno ne uvažamo tiste funkcije, ker je tipizirana
 * izključno za `BackupFile` (JSON), tu pa gre za CSV besedilo.
 */
async function shareOrDownloadCsv(csv: string, filename: string): Promise<{ cancelled: boolean }> {
  const nav = typeof navigator !== 'undefined' ? (navigator as unknown as NavigatorWithShare) : undefined
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })

  if (nav?.share && nav.canShare) {
    const file = new File([blob], filename, { type: 'text/csv' })
    if (nav.canShare({ files: [file] })) {
      try {
        await nav.share({ files: [file] })
        return { cancelled: false }
      } catch (err) {
        // Preklic deljenja je NORMALEN izid (uporabnik je zaprl Share Sheet), ne napaka.
        if (err instanceof Error && err.name === 'AbortError') return { cancelled: true }
        throw err
      }
    }
  }

  if (typeof document !== 'undefined') {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  }
  return { cancelled: false }
}

function csvFilename(): string {
  const iso = new Date().toISOString().replace(/[:.]/g, '-')
  return `hgapp-zgodovina-${iso}.csv`
}

/**
 * Zgodovina in statistika (spec, razdelek 9): filtri, ključni kazalniki,
 * lestvica, saldo skozi čas in izvoz CSV. Vsi podatki izhajajo iz
 * `useStats`, ki za vsako sejo znova požene tesnino testiran obračun namesto
 * surovega C−B (glej komentar tam) — tu se to samo prikazuje.
 */
export function ZgodovinaScreen() {
  const [dateRange, setDateRange] = useState<DateRangeFilter>('vse')
  const [location, setLocation] = useState<string | null>(null)
  const stats = useStats({ dateRange, location })
  const [csvStatus, setCsvStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle')

  if (stats === undefined) {
    return (
      <div className="px-5 py-8">
        <p className="text-bone-dim text-sm">Nalagam …</p>
      </div>
    )
  }

  if (!stats.hasAnySettled) {
    return (
      <div className="flex min-h-full flex-col px-5 pt-2 pb-6">
        <header className="safe-top py-3">
          <h1 className="text-bone text-xl font-semibold">Zgodovina</h1>
        </header>
        <div className="flex-1">
          <EmptyState
            title="Tu se bo zbirala zgodovina iger"
            description="Takoj ko poravnaš prvo sejo, se tu pojavijo skupni izidi, lestvica igralcev in graf salda skozi čas. Odigraj in poravnaj sejo, da začneš."
          />
        </div>
      </div>
    )
  }

  async function handleExportCsv(): Promise<void> {
    if (!stats) return
    setCsvStatus('working')
    try {
      const rows = buildCsvRows(stats.results, stats.playerNames)
      const csv = toCsv(rows)
      const r = await shareOrDownloadCsv(csv, csvFilename())
      setCsvStatus(r.cancelled ? 'idle' : 'done')
    } catch {
      setCsvStatus('error')
    }
  }

  return (
    <div className="flex min-h-full flex-col px-5 pt-2 pb-6">
      <header className="safe-top py-3">
        <h1 className="text-bone text-xl font-semibold">Zgodovina</h1>
      </header>

      {/* 1. Filtri, v eni vrstici nad vsem ostalim — spreminjajo, kateri
          rezultati se prikažejo v vseh spodnjih razdelkih (glej naloga). */}
      <div className="flex gap-2">
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as DateRangeFilter)}
          aria-label="Obdobje"
          className="border-line bg-surface text-bone min-h-11 flex-1 rounded-lg border px-2.5 text-[0.8125rem]"
        >
          {(Object.keys(DATE_RANGE_LABEL) as DateRangeFilter[]).map((key) => (
            <option key={key} value={key}>
              {DATE_RANGE_LABEL[key]}
            </option>
          ))}
        </select>
        <select
          value={location ?? ''}
          onChange={(e) => setLocation(e.target.value === '' ? null : e.target.value)}
          aria-label="Lokacija"
          className="border-line bg-surface text-bone min-h-11 flex-1 rounded-lg border px-2.5 text-[0.8125rem]"
        >
          <option value="">Vse lokacije</option>
          {stats.locations.map((loc) => (
            <option key={loc} value={loc}>
              {loc}
            </option>
          ))}
        </select>
      </div>

      {/* 2. Ključna kazalnika — velika številka z majhno oznako, ne graf. */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="tile flex flex-col justify-center p-4">
          <p className="eyebrow">{sklonSeja(stats.sessionCount)}</p>
          <p className="num text-bone mt-1 text-[2rem] leading-none font-semibold">{stats.sessionCount}</p>
        </div>
        <div className="tile flex flex-col justify-center p-4">
          <p className="eyebrow">Moj skupni izid</p>
          {stats.ownerNetCents === null ? (
            <>
              <p className="num text-bone-faint mt-1 text-[2rem] leading-none font-semibold">—</p>
              <p className="text-bone-faint mt-1 text-[0.6875rem] leading-snug">Nastavi svojega igralca v nastavitvah.</p>
            </>
          ) : (
            <Money
              cents={stats.ownerNetCents}
              signed
              colored
              className="mt-1 block text-[2rem] leading-none font-semibold"
            />
          )}
        </div>
      </div>

      {/* 3. Lestvica — urejen seznam s poravnanimi številkami, NE graf: pri
          peščici igralcev so same številke bistvo tega razdelka. */}
      <section className="mt-6">
        <p className="eyebrow">Lestvica</p>
        {stats.playerStats.length === 0 ? (
          <p className="text-bone-faint mt-2 text-sm">Za izbrano obdobje ni podatkov.</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {stats.playerStats.map((p, i) => (
              <li key={p.playerId} className="tile flex items-center gap-3 p-3">
                <span className="text-bone-dim w-5 shrink-0 text-center text-sm font-semibold">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-bone truncate text-[0.9375rem] font-medium">
                    {stats.playerNames[p.playerId] ?? p.playerId}
                  </p>
                  <p className="text-bone-faint text-[0.6875rem]">
                    {p.sessionCount} {sklonSeja(p.sessionCount)} · povprečje{' '}
                    <Money cents={p.averageNetCents} signed className="text-[0.6875rem]" />
                  </p>
                </div>
                <Money cents={p.totalNetCents} signed colored className="shrink-0 text-base font-semibold" />
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* 4. Saldo skozi čas — večserijski kumulativni graf. */}
      <section className="mt-6">
        <p className="eyebrow">Saldo skozi čas</p>
        <div className="mt-2">
          <SaldoChart results={stats.results} stablePlayerOrder={stats.stablePlayerOrder} playerNames={stats.playerNames} />
        </div>
      </section>

      {/* 5. Izvoz CSV — ena vrstica na igralca na poravnano sejo, znotraj trenutnih filtrov. */}
      <section className="mt-6">
        <p className="eyebrow">Izvoz</p>
        <Button onClick={() => void handleExportCsv()} disabled={csvStatus === 'working' || stats.results.length === 0} fullWidth className="mt-2">
          {csvStatus === 'working' ? 'Pripravljam …' : 'Izvozi CSV'}
        </Button>
        {stats.results.length === 0 && <p className="text-bone-faint mt-1 text-[0.75rem]">Za izbrano obdobje ni česa izvoziti.</p>}
        {csvStatus === 'done' && <p className="text-jade mt-1 text-xs">Izvoz je pripravljen.</p>}
        {csvStatus === 'error' && <p className="text-oxblood mt-1 text-xs">Izvoza ni bilo mogoče pripraviti. Poskusi znova.</p>}
      </section>
    </div>
  )
}
