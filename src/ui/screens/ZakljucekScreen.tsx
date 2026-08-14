import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/schema.ts'
import { listSessionPlayers } from '../../db/repositories/sessions.ts'
import { sessionTotals } from '../../db/repositories/buyins.ts'
import { setCashout } from '../../db/repositories/cashouts.ts'
import { chipCountsToCents } from '../../domain/chips.ts'
import type { Cents } from '../../domain/money.ts'
import { formatEur, parseEurToCents } from '../../domain/money.ts'
import type { DiscrepancyMethod } from '../../domain/settlement/types.ts'
import { Money } from '../components/Money.tsx'
import { ChipCounter } from '../components/ChipCounter.tsx'
import { NeskladjeSheet, readDiscrepancyDraft, writeDiscrepancyDraft } from '../components/NeskladjeSheet.tsx'

interface ZakljucekScreenProps {
  sessionId: string
  onNaprej: () => void
  onNazaj: () => void
}

/** Cente v besedilo za vnosno polje, BREZ znaka €  (npr. 4750 -> "47,50"). */
function centsToPlainInput(cents: Cents): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`
}

/**
 * Zaključek seje — vnos končnega stanja (cashout) vsakega igralca.
 *
 * To je prva od dveh zaslonov, kjer aplikacija odloča o pravem denarju (glej
 * specifikacijo, razdelek 6.2). Vsak vnos se takoj shrani (`setCashout`), zato
 * "Nazaj" nikoli ne izgubi podatkov. Neskladje žetonov je tu namerno
 * najbolj vpadljiv element zaslona — tiho ga ne smemo nikoli spregledati.
 */
export function ZakljucekScreen({ sessionId, onNaprej, onNazaj }: ZakljucekScreenProps) {
  const session = useLiveQuery(() => db.sessions.get(sessionId), [sessionId])
  const sessionPlayers = useLiveQuery(() => listSessionPlayers(db, sessionId), [sessionId])
  const totals = useLiveQuery(() => sessionTotals(db, sessionId), [sessionId])
  const allPlayers = useLiveQuery(() => db.players.toArray(), [])

  const nameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of allPlayers ?? []) m.set(p.id, p.name)
    return m
  }, [allPlayers])

  const sortedPlayers = useMemo(
    () => [...(sessionPlayers ?? [])].sort((a, b) => a.seatOrder - b.seatOrder),
    [sessionPlayers],
  )

  const cashoutMode = session?.cashoutMode ?? 'eur'
  const denominations = session?.chipDenominations ?? []

  // --- Osnutek vnosa: eur besedilo ALI štetje po barvah, en na sedež igralca ---
  const [eurDraft, setEurDraft] = useState<Record<string, string>>({})
  const [chipDraft, setChipDraft] = useState<Record<string, Record<string, number>>>({})
  // Ali je uporabnik za tega igralca že karkoli vnesel (ali je v bazi že vrednost).
  // Potreben ločeno od izračunanih centov, ker je "0 žetonov vseh barv" veljaven
  // vnos (igralec je bust) in ga ne smemo zamenjati z "še ni vnešeno".
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const seeded = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!sessionPlayers) return
    for (const sp of sessionPlayers) {
      if (seeded.current.has(sp.id)) continue
      seeded.current.add(sp.id)
      if (sp.cashoutCents !== null) {
        setEurDraft((prev) => ({ ...prev, [sp.id]: centsToPlainInput(sp.cashoutCents!) }))
        setTouched((prev) => ({ ...prev, [sp.id]: true }))
      }
      if (sp.cashoutChipCounts) {
        setChipDraft((prev) => ({ ...prev, [sp.id]: sp.cashoutChipCounts! }))
      }
    }
  }, [sessionPlayers])

  function cashoutCentsFor(spId: string): Cents | null {
    if (cashoutMode === 'eur') {
      return parseEurToCents(eurDraft[spId] ?? '')
    }
    if (!touched[spId]) return null
    return chipCountsToCents(chipDraft[spId] ?? {}, denominations)
  }

  function handleEurChange(spId: string, text: string): void {
    setEurDraft((prev) => ({ ...prev, [spId]: text }))
    const cents = parseEurToCents(text)
    if (cents !== null) {
      setTouched((prev) => ({ ...prev, [spId]: true }))
      void setCashout(db, spId, cents, null)
    }
  }

  function handleChipChange(spId: string, counts: Record<string, number>): void {
    setChipDraft((prev) => ({ ...prev, [spId]: counts }))
    setTouched((prev) => ({ ...prev, [spId]: true }))
    const cents = chipCountsToCents(counts, denominations)
    void setCashout(db, spId, cents, counts)
  }

  const perPlayerCents = new Map(sortedPlayers.map((sp) => [sp.id, cashoutCentsFor(sp.id)]))
  const sumB = sortedPlayers.reduce((s, sp) => s + (totals?.perPlayer[sp.playerId]?.takenCents ?? 0), 0)
  const sumC = sortedPlayers.reduce((s, sp) => s + (perPlayerCents.get(sp.id) ?? 0), 0)
  const diff = sumC - sumB
  const allComplete = sortedPlayers.length > 0 && sortedPlayers.every((sp) => perPlayerCents.get(sp.id) !== null)

  const [discrepancyMethod, setDiscrepancyMethod] = useState<DiscrepancyMethod | null>(() =>
    readDiscrepancyDraft(sessionId),
  )
  const [sheetOpen, setSheetOpen] = useState(false)

  // Če je bila izbrana ROČNA razrešitev, njeni zneski so vezani na takratno
  // razliko. Če se razlika kasneje spremeni (uporabnik popravi cashout), ti
  // zneski ne izničijo več nove razlike — razveljavimo jih, namesto da bi
  // aplikacija tiho uporabila zastarelo (in napačno) razrešitev.
  useEffect(() => {
    if (discrepancyMethod?.method !== 'rocno') return
    const sum = Object.values(discrepancyMethod.adjustmentsCents).reduce((a, b) => a + b, 0)
    if (sum !== -diff) {
      setDiscrepancyMethod(null)
      writeDiscrepancyDraft(sessionId, null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diff])

  const discrepancyResolved = diff === 0 || discrepancyMethod !== null
  const canProceed = allComplete && discrepancyResolved

  let disabledReason: string | null = null
  if (!allComplete) disabledReason = 'Vpiši cashout za vse igralce, preden nadaljuješ.'
  else if (!discrepancyResolved) disabledReason = 'Razreši neskladje žetonov, preden nadaljuješ.'

  if (!session || !sessionPlayers) {
    return (
      <div className="px-5 py-8">
        <p className="text-bone-dim text-sm">Nalagam …</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="safe-top flex items-center gap-3 px-5 pb-2">
        <button
          type="button"
          onClick={onNazaj}
          aria-label="Nazaj"
          className="text-bone flex size-11 items-center justify-center text-xl"
        >
          ‹
        </button>
        <div>
          <p className="eyebrow">Zaključek seje</p>
          <h1 className="text-bone text-lg font-semibold">{session.name ?? 'Vpiši končno stanje'}</h1>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 pb-4">
        <div className="flex flex-col gap-3">
          {sortedPlayers.map((sp) => {
            const name = nameById.get(sp.playerId) ?? sp.playerId
            const bucket = totals?.perPlayer[sp.playerId]
            return (
              <div key={sp.id} className="tile flex flex-col gap-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-bone truncate font-semibold">{name}</span>
                  <div className="flex shrink-0 gap-3 text-[0.6875rem]">
                    <span className="text-bone-dim">
                      B <Money cents={bucket?.takenCents ?? 0} className="text-bone-dim" />
                    </span>
                    <span className="text-bone-dim">
                      P <Money cents={bucket?.paidCents ?? 0} className="text-bone-dim" />
                    </span>
                  </div>
                </div>

                {cashoutMode === 'eur' ? (
                  <input
                    type="text"
                    inputMode="decimal"
                    className="num bg-raised border-line text-bone w-full rounded-lg border px-3 py-3 text-lg"
                    value={eurDraft[sp.id] ?? ''}
                    onChange={(e) => handleEurChange(sp.id, e.target.value)}
                    placeholder="0,00"
                    aria-label={`Cashout za ${name}`}
                  />
                ) : (
                  <ChipCounter
                    denominations={denominations}
                    counts={chipDraft[sp.id] ?? {}}
                    onChange={(counts) => handleChipChange(sp.id, counts)}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="border-line bg-surface safe-bottom sticky bottom-0 border-t px-5 pt-3">
        <p className="eyebrow">Σ žetonov vs Σ buy-inov</p>
        <div className="mt-1 flex items-baseline gap-2">
          <Money cents={sumC} className="text-lg" />
          <span className="text-bone-faint text-sm">vs</span>
          <Money cents={sumB} className="text-lg" />
        </div>

        {diff === 0 ? (
          <p className="text-jade mt-1.5 text-sm font-medium">Blagajna se izide.</p>
        ) : (
          <div className="border-oxblood bg-oxblood/10 mt-2 rounded-lg border p-3">
            <p className="text-oxblood text-sm font-semibold">
              Neskladje {formatEur(Math.abs(diff))} — {diff > 0 ? 'žetonov je preveč' : 'žetonov manjka'}.
            </p>
            {discrepancyMethod && (
              <p className="text-bone-dim mt-1 text-xs">Izbrana razrešitev: {razresitevOpis(discrepancyMethod)}.</p>
            )}
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="bg-oxblood text-bone mt-2 min-h-11 w-full rounded-lg text-sm font-semibold"
            >
              {discrepancyMethod ? 'Spremeni razrešitev' : 'Razreši neskladje'}
            </button>
          </div>
        )}

        {disabledReason && <p className="text-bone-dim mt-2 text-xs">{disabledReason}</p>}

        <div className="flex gap-2 py-3">
          <button
            type="button"
            onClick={onNazaj}
            className="border-line text-bone min-h-11 flex-1 rounded-lg border py-3 font-medium"
          >
            Nazaj
          </button>
          <button
            type="button"
            disabled={!canProceed}
            onClick={onNaprej}
            className="bg-bone text-night min-h-11 flex-1 rounded-lg py-3 font-semibold disabled:opacity-40"
          >
            Naprej
          </button>
        </div>
      </div>

      {sheetOpen && (
        <NeskladjeSheet
          discrepancyCents={diff}
          players={sortedPlayers.map((sp) => ({
            playerId: sp.playerId,
            name: nameById.get(sp.playerId) ?? sp.playerId,
            cashoutCents: perPlayerCents.get(sp.id) ?? 0,
          }))}
          initial={discrepancyMethod}
          onApply={(method) => {
            setDiscrepancyMethod(method)
            writeDiscrepancyDraft(sessionId, method)
          }}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  )
}

function razresitevOpis(method: DiscrepancyMethod): string {
  switch (method.method) {
    case 'enakomerno':
      return 'enakomerno med vse igralce'
    case 'sorazmerno':
      return 'sorazmerno s končnim stackom'
    case 'pripisi':
      return 'pripisano eni osebi'
    case 'rocno':
      return 'ročno'
  }
}
