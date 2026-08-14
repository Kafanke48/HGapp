import { useMemo, useState } from 'react'
import type { Cents } from '../../domain/money.ts'
import { formatEur, formatEurSigned, parseEurToCents, splitEvenly, splitProportional, sumCents } from '../../domain/money.ts'
import type { DiscrepancyMethod } from '../../domain/settlement/types.ts'

export interface NeskladjePlayer {
  playerId: string
  name: string
  /** C — trenutno vpisan cashout. Uporabljen kot utež pri "sorazmerno s stackom". */
  cashoutCents: Cents
}

interface NeskladjeSheetProps {
  /** Σ C − Σ B pred razrešitvijo (glej engine.ts). Predznak: >0 preveč žetonov, <0 premalo. */
  discrepancyCents: Cents
  players: readonly NeskladjePlayer[]
  initial: DiscrepancyMethod | null
  onApply: (method: DiscrepancyMethod) => void
  onClose: () => void
}

type Tab = DiscrepancyMethod['method']

const DRAFT_PREFIX = 'hgapp:neskladje-osnutek:'

/**
 * Shrani izbrano razrešitev neskladja v `sessionStorage`.
 *
 * Zakaj tukaj in ne v bazi: po dogovorjenem vmesniku ZakljucekScreen in
 * PoravnavaScreen ne prejemata podatkov drug od drugega prek props (oba
 * imata samo `sessionId`). Razrešitev neskladja pa mora "preživeti" prehod
 * med njima, ker uporabnik ne sme neskladja razreševati dvakrat. `sessionStorage`
 * je za to namenoma pravo mesto — ni trajen podatek (ne pristane v izvozu baze),
 * izgine ob zaprtju zavihka, in ni to nikakršna poslovna resnica: dokončna
 * razrešitev se zapiše šele v `finalizeSettlement`.
 */
export function readDiscrepancyDraft(sessionId: string): DiscrepancyMethod | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_PREFIX + sessionId)
    if (!raw) return null
    return JSON.parse(raw) as DiscrepancyMethod
  } catch {
    return null
  }
}

export function writeDiscrepancyDraft(sessionId: string, method: DiscrepancyMethod | null): void {
  try {
    if (method === null) sessionStorage.removeItem(DRAFT_PREFIX + sessionId)
    else sessionStorage.setItem(DRAFT_PREFIX + sessionId, JSON.stringify(method))
  } catch {
    // sessionStorage lahko ni na voljo (npr. zaseben način) — uporabnik bo moral
    // razrešitev le ponovno izbrati na naslednjem zaslonu, kar ni napaka podatkov.
  }
}

export function clearDiscrepancyDraft(sessionId: string): void {
  writeDiscrepancyDraft(sessionId, null)
}

function byIdAsc(a: { playerId: string }, b: { playerId: string }): number {
  return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0
}

/**
 * List za razrešitev neskladja žetonov (spec, razdelek 4.2).
 *
 * Neskladje se NIKOLI ne razreši tiho — uporabnik vedno izbere eno od štirih
 * možnosti, izbira pa se kasneje zapiše v revizijski dnevnik z razlogom
 * (glej `finalizeSettlement`).
 */
export function NeskladjeSheet({ discrepancyCents, players, initial, onApply, onClose }: NeskladjeSheetProps) {
  const sorted = useMemo(() => [...players].sort(byIdAsc), [players])
  // Cilj: vsota popravkov mora natanko izničiti neskladje (glej engine.ts).
  const target = -discrepancyCents

  const [tab, setTab] = useState<Tab>(initial?.method ?? 'enakomerno')
  const [pripisiId, setPripisiId] = useState<string | null>(initial?.method === 'pripisi' ? initial.playerId : null)
  const [amounts, setAmounts] = useState<Record<string, string>>(() => {
    if (initial?.method !== 'rocno') return {}
    const init: Record<string, string> = {}
    for (const [id, cents] of Object.entries(initial.adjustmentsCents)) init[id] = centsToPlainInput(cents)
    return init
  })
  const [note, setNote] = useState<string>(initial?.method === 'rocno' ? initial.note : '')

  const evenPreview = splitEvenly(target, sorted.length)
  const weights = sorted.map((p) => Math.max(0, p.cashoutCents))
  const weightSum = sumCents(weights)
  const propPreview = weightSum > 0 ? splitProportional(target, weights) : null

  const enteredSum = sumCents(sorted.map((p) => parseEurToCents(amounts[p.playerId] ?? '') ?? 0))
  const remaining = target - enteredSum
  const rocnoValid = remaining === 0 && note.trim() !== ''

  const canConfirm =
    tab === 'enakomerno' ? true : tab === 'sorazmerno' ? true : tab === 'pripisi' ? pripisiId !== null : rocnoValid

  function confirm(): void {
    let method: DiscrepancyMethod
    if (tab === 'enakomerno') {
      method = { method: 'enakomerno' }
    } else if (tab === 'sorazmerno') {
      method = { method: 'sorazmerno' }
    } else if (tab === 'pripisi') {
      if (pripisiId === null) return
      method = { method: 'pripisi', playerId: pripisiId }
    } else {
      const adjustmentsCents: Record<string, Cents> = {}
      for (const p of sorted) {
        const c = parseEurToCents(amounts[p.playerId] ?? '')
        if (c !== null) adjustmentsCents[p.playerId] = c
      }
      method = { method: 'rocno', adjustmentsCents, note: note.trim() }
    }
    onApply(method)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/60" role="dialog" aria-modal="true">
      <div className="bg-surface safe-bottom max-h-[85vh] w-full overflow-y-auto rounded-t-2xl p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-bone text-lg font-semibold">Razreši neskladje</h2>
          <button type="button" onClick={onClose} aria-label="Zapri" className="text-bone-dim flex size-11 items-center justify-center text-2xl">
            ×
          </button>
        </div>
        <p className="text-bone-dim mt-1 text-sm">
          Σ žetonov in Σ buy-inov se razlikujeta za{' '}
          <span className="text-oxblood font-semibold">{formatEur(Math.abs(discrepancyCents))}</span>
          {discrepancyCents > 0 ? ' (žetonov je preveč).' : ' (žetonov manjka).'}
        </p>

        <div className="mt-4 flex gap-1.5 overflow-x-auto">
          <TabButton label="Enakomerno" active={tab === 'enakomerno'} onClick={() => setTab('enakomerno')} />
          <TabButton label="Sorazmerno" active={tab === 'sorazmerno'} onClick={() => setTab('sorazmerno')} />
          <TabButton label="Pripiši" active={tab === 'pripisi'} onClick={() => setTab('pripisi')} />
          <TabButton label="Ročno" active={tab === 'rocno'} onClick={() => setTab('rocno')} />
        </div>

        <div className="mt-4">
          {tab === 'enakomerno' && (
            <div className="flex flex-col gap-1.5">
              <p className="text-bone-dim text-sm">Razlika se razdeli enako na vsakega igralca.</p>
              {sorted.map((p, i) => (
                <PreviewRow key={p.playerId} name={p.name} deltaCents={evenPreview[i]!} />
              ))}
            </div>
          )}

          {tab === 'sorazmerno' && (
            <div className="flex flex-col gap-1.5">
              {propPreview === null ? (
                <p className="text-bone-dim text-sm">
                  Nihče ni odnesel žetonov (vsi stacki so 0) — sorazmerno ni mogoče. Uporabljena bo enakomerna delitev.
                </p>
              ) : (
                <>
                  <p className="text-bone-dim text-sm">Kdor ima večji stack ob koncu, nosi večji del razlike.</p>
                  {sorted.map((p, i) => (
                    <PreviewRow key={p.playerId} name={p.name} deltaCents={propPreview[i]!} />
                  ))}
                </>
              )}
            </div>
          )}

          {tab === 'pripisi' && (
            <div className="flex flex-col gap-1.5">
              <p className="text-bone-dim text-sm">Celotna razlika gre eni osebi (običajno host/banka).</p>
              {sorted.map((p) => (
                <button
                  key={p.playerId}
                  type="button"
                  onClick={() => setPripisiId(p.playerId)}
                  className={`border-line flex min-h-11 items-center justify-between rounded-lg border px-3 py-2 text-left ${
                    pripisiId === p.playerId ? 'bg-raised border-bone' : 'bg-night'
                  }`}
                >
                  <span className="text-bone text-sm">{p.name}</span>
                  {pripisiId === p.playerId && (
                    <span className={`num text-sm ${target >= 0 ? 'text-jade' : 'text-oxblood'}`}>
                      {formatEurSigned(target)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {tab === 'rocno' && (
            <div className="flex flex-col gap-2">
              <p className="text-bone-dim text-sm">
                Vpiši popravek za vsakega igralca. Vsota mora natanko izničiti razliko.
              </p>
              {sorted.map((p) => (
                <div key={p.playerId} className="flex items-center justify-between gap-2">
                  <span className="text-bone min-w-0 flex-1 truncate text-sm">{p.name}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0,00"
                    className="num bg-raised border-line text-bone w-24 rounded-lg border px-2 py-2 text-right text-sm"
                    value={amounts[p.playerId] ?? ''}
                    onChange={(e) => setAmounts((prev) => ({ ...prev, [p.playerId]: e.target.value }))}
                    aria-label={`Ročni popravek za ${p.name}`}
                  />
                </div>
              ))}
              <div className="border-line mt-1 flex items-center justify-between border-t pt-2">
                <span className="eyebrow">Preostane</span>
                <span className={`num text-sm font-semibold ${remaining === 0 ? 'text-jade' : 'text-oxblood'}`}>
                  {formatEurSigned(remaining)}
                </span>
              </div>
              <label className="mt-1 flex flex-col gap-1">
                <span className="eyebrow">Zapisek (obvezno)</span>
                <textarea
                  className="bg-raised border-line text-bone rounded-lg border p-2 text-sm"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Zakaj je prišlo do neskladja?"
                  rows={2}
                />
              </label>
            </div>
          )}
        </div>

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
            Uporabi
          </button>
        </div>
      </div>
    </div>
  )
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium ${
        active ? 'bg-raised text-bone' : 'text-bone-dim'
      }`}
    >
      {label}
    </button>
  )
}

function PreviewRow({ name, deltaCents }: { name: string; deltaCents: Cents }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-bone text-sm">{name}</span>
      <span className={`num text-sm ${deltaCents === 0 ? 'text-bone-dim' : deltaCents > 0 ? 'text-jade' : 'text-oxblood'}`}>
        {formatEurSigned(deltaCents)}
      </span>
    </div>
  )
}

function centsToPlainInput(cents: Cents): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`
}
