import { useMemo, useState } from 'react'
import type { Cents } from '../../domain/money.ts'
import { formatEurSigned, parseEurToCents } from '../../domain/money.ts'
import { computeSettlement } from '../../domain/settlement/index.ts'
import type { DiscrepancyMethod, ExpenseSplitMethod, PlayerInput } from '../../domain/settlement/index.ts'

export interface StroskiPlayer extends PlayerInput {
  name: string
}

export interface StroskiDraft {
  totalCents: Cents
  method: ExpenseSplitMethod
  paidByPlayerId: string
}

export interface StroskiInitial {
  totalCents: Cents
  method: ExpenseSplitMethod
  paidByPlayerId: string | null
}

interface StroskiSheetProps {
  players: readonly StroskiPlayer[]
  /**
   * Ista razrešitev neskladja, uporabljena za predogled poravnave (glej
   * PoravnavaScreen.tsx). Nujna, ker se stroški delijo na saldih PO razrešitvi
   * neskladja, ne pred njo (spec, razdelek 4.1 — koraka 2 in 3 se ne smeta
   * zamenjati).
   */
  discrepancy: DiscrepancyMethod | null
  /** Trenutna konfiguracija, kadar je strošek že vklopljen — polja se prednastavijo. */
  initial: StroskiInitial | null
  /**
   * Privzeti založnik, kadar strošek še ni vklopljen — host te seje, če je med
   * udeleženci. Samo predizpolnitev; uporabnik lahko izbere drugega.
   */
  defaultPaidByPlayerId: string | null
  onApply: (draft: StroskiDraft) => void
  onClose: () => void
}

function byIdAsc(a: { playerId: string }, b: { playerId: string }): number {
  return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0
}

function centsToPlainInput(cents: Cents): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`
}

/**
 * List za vklop in urejanje delitve skupnega stroška seje (spec, razdelek 4.6).
 *
 * List sam NIKOLI ne piše v bazo — predogled znotraj njega kliče isti čisti
 * obračun (`computeSettlement`) kot dejanska poravnava, samo z OSNUTKOM
 * stroška namesto s tistim, shranjenim na seji. Tako predogled ob vsakem
 * vnosu natanko ustreza temu, kar bo prikazano, potem ko klicatelj
 * (PoravnavaScreen.tsx) spremembo dejansko zapiše prek `updateSession` — glej
 * nalogo: "this is also how computeForSession picks it up", zato se tukaj ne
 * sme izumljati ločena pot za uveljavitev stroška.
 */
export function StroskiSheet({
  players,
  discrepancy,
  initial,
  defaultPaidByPlayerId,
  onApply,
  onClose,
}: StroskiSheetProps) {
  const sorted = useMemo(() => [...players].sort(byIdAsc), [players])

  const [totalInput, setTotalInput] = useState<string>(
    initial && initial.totalCents > 0 ? centsToPlainInput(initial.totalCents) : '',
  )
  const [method, setMethod] = useState<ExpenseSplitMethod>(initial?.method ?? 'po_glavah')
  const [paidByPlayerId, setPaidByPlayerId] = useState<string | null>(
    initial?.paidByPlayerId ?? defaultPaidByPlayerId,
  )

  const parsedTotal = parseEurToCents(totalInput)
  const totalTouched = totalInput.trim() !== ''
  // Znesek 0 z vklopljenim stroškom je brez učinka in samo zmede — dokler ni
  // vpisan pozitiven znesek, vklop blokiramo namesto da bi dovolili "vklopljen,
  // a brezpredmeten" strošek (glej nalogo: eno od dveh dovoljenih ravnanj).
  const totalError = !totalTouched
    ? null
    : parsedTotal === null
      ? 'Vpiši veljaven znesek, npr. 30,00.'
      : parsedTotal < 0
        ? 'Znesek ne sme biti negativen.'
        : parsedTotal === 0
          ? 'Znesek mora biti večji od 0 €.'
          : null

  const validTotal = parsedTotal !== null && parsedTotal > 0 ? parsedTotal : null
  // Nikoli ne sme biti mogoče potrditi "vklopljeno" brez izbranega založnika —
  // computeForSession bi sicer ob obračunu vrgel napako (glej nalogo).
  const canConfirm = validTotal !== null && paidByPlayerId !== null

  const preview = useMemo(() => {
    if (validTotal === null || paidByPlayerId === null) return null
    try {
      return computeSettlement({
        players: sorted,
        discrepancy,
        expense: { totalCents: validTotal, method, paidByPlayerId },
        mode: 'blagajna',
      })
    } catch {
      return null
    }
  }, [sorted, discrepancy, validTotal, method, paidByPlayerId])

  const adjustmentByPlayer = useMemo(
    () => new Map((preview?.expenseAdjustments ?? []).map((a) => [a.playerId, a.deltaCents])),
    [preview],
  )

  function confirm(): void {
    if (validTotal === null || paidByPlayerId === null) return
    onApply({ totalCents: validTotal, method, paidByPlayerId })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/60" role="dialog" aria-modal="true">
      <div className="bg-surface safe-bottom max-h-[85vh] w-full overflow-y-auto rounded-t-2xl p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-bone text-lg font-semibold">Skupni strošek</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zapri"
            className="text-bone-dim flex size-11 items-center justify-center text-2xl"
          >
            ×
          </button>
        </div>
        <p className="text-bone-faint mt-1 text-xs">
          To razdeli dejanski skupen strošek seje (pijača, hrana, karte) med igralce po dogovoru — ni hišni delež.
          Rake ta aplikacija namenoma ne podpira.
        </p>

        <label className="mt-4 flex flex-col gap-1">
          <span className="eyebrow">Skupen znesek</span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            className="num bg-raised border-line text-bone min-h-11 rounded-lg border px-3 py-2 text-lg"
            value={totalInput}
            onChange={(e) => setTotalInput(e.target.value)}
            aria-label="Skupen znesek stroška"
          />
          {totalError && <span className="text-oxblood text-xs">{totalError}</span>}
        </label>

        <div className="mt-4">
          <p className="eyebrow">Način delitve</p>
          <div className="mt-2 flex gap-2">
            <MethodButton label="Po glavah" active={method === 'po_glavah'} onClick={() => setMethod('po_glavah')} />
            <MethodButton
              label="Po dobičku"
              active={method === 'po_dobicku'}
              onClick={() => setMethod('po_dobicku')}
            />
          </div>
        </div>

        <div className="mt-4">
          <p className="eyebrow">Kdo je založil</p>
          <div className="mt-2 flex flex-col gap-1.5">
            {sorted.map((p) => (
              <button
                key={p.playerId}
                type="button"
                onClick={() => setPaidByPlayerId(p.playerId)}
                className={`border-line flex min-h-11 items-center justify-between rounded-lg border px-3 py-2 text-left ${
                  paidByPlayerId === p.playerId ? 'bg-raised border-bone' : 'bg-night'
                }`}
              >
                <span className="text-bone text-sm">{p.name}</span>
              </button>
            ))}
          </div>
        </div>

        {preview && (
          <div className="mt-4">
            <p className="eyebrow">Predogled</p>
            {preview.expenseFellBackToHeadcount && (
              <p className="text-oxblood mt-1 text-xs font-medium">
                Nihče ni v plusu — "po dobičku" ni definirano, zato je uporabljena delitev "po glavah".
              </p>
            )}
            <div className="mt-2 flex flex-col gap-1.5">
              {sorted.map((p) => {
                const delta = adjustmentByPlayer.get(p.playerId) ?? 0
                const isPayer = p.playerId === paidByPlayerId
                return (
                  <div key={p.playerId} className="flex items-center justify-between">
                    <span className="text-bone text-sm">
                      {p.name}
                      {isPayer && <span className="text-bone-faint"> · založil</span>}
                    </span>
                    <span className={`num text-sm ${delta < 0 ? 'text-oxblood' : delta > 0 ? 'text-jade' : 'text-bone-dim'}`}>
                      {formatEurSigned(delta)}
                    </span>
                  </div>
                )
              })}
            </div>
            {paidByPlayerId && (
              <p className="text-bone-dim mt-2 text-xs">
                Založnik plača svoj delež in prejme povrnjen celoten znesek — njegov neto učinek je{' '}
                <span className="text-bone font-semibold">
                  {formatEurSigned(adjustmentByPlayer.get(paidByPlayerId) ?? 0)}
                </span>
                .
              </p>
            )}
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="border-line text-bone min-h-11 flex-1 rounded-lg border py-3 font-medium"
          >
            Prekliči
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={confirm}
            className="bg-bone text-night min-h-11 flex-1 rounded-lg py-3 font-semibold disabled:opacity-40"
          >
            Shrani
          </button>
        </div>
      </div>
    </div>
  )
}

function MethodButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-11 flex-1 rounded-lg border py-2 text-sm font-medium ${
        active ? 'bg-raised border-bone text-bone' : 'border-line text-bone-dim'
      }`}
    >
      {label}
    </button>
  )
}
