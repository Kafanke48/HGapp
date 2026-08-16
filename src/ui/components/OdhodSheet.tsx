import { useEffect, useState } from 'react'
import type { Cents } from '../../domain/money.ts'
import { formatEur, parseEurToCents } from '../../domain/money.ts'
import { chipCountsToCents } from '../../domain/chips.ts'
import type { CashoutMode, ChipDenomination } from '../../db/types.ts'
import { db } from '../../db/schema.ts'
import { recordEarlyCashout } from '../../db/repositories/index.ts'
import { Sheet } from './Sheet.tsx'
import { Button } from './Button.tsx'
import { Money } from './Money.tsx'
import { ChipCounter } from './ChipCounter.tsx'

export interface OdhodSheetProps {
  open: boolean
  sessionPlayerId: string | null
  playerName: string
  /** B — vsota buy-inov tega igralca do zdaj. */
  takenCents: Cents
  /** P — dejansko plačano tega igralca do zdaj. */
  paidCents: Cents
  cashoutMode: CashoutMode
  chipDenominations: readonly ChipDenomination[]
  /** Trenutna vsebina blagajne PRED tem odhodom (Σ P − Σ že izplačano). */
  boxCentsNow: Cents
  onClose: () => void
}

/** Cente v besedilo za vnosno polje, BREZ znaka € (npr. 4750 -> "47,50"). */
function centsToPlainInput(cents: Cents): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`
}

/**
 * Predčasni odhod igralca sredi seje (spec, razdelek 2).
 *
 * Zbere C (vrednost žetonov ob odhodu) in koliko gotovine je igralec dejansko
 * vzel iz blagajne ZDAJ — dve ločeni številki, ker igralec lahko denar tudi
 * pusti do konca večera. Privzeti predlog je celoten znesek, ki mu pripada
 * `(C − B) + P`, ker je to normalen primer (spec, razdelek "Player leaves
 * mid-session"), a je vedno urejljiv, tudi na 0.
 *
 * Posledica (blagajna po odhodu) je vidna PRED potrditvijo, ne šele po njej —
 * to je številka, ki jo gostitelj fizično preveri proti kuverti.
 */
export function OdhodSheet({
  open,
  sessionPlayerId,
  playerName,
  takenCents,
  paidCents,
  cashoutMode,
  chipDenominations,
  boxCentsNow,
  onClose,
}: OdhodSheetProps) {
  const [eurInput, setEurInput] = useState('')
  const [chipCounts, setChipCounts] = useState<Record<string, number>>({})
  const [chipsTouched, setChipsTouched] = useState(false)
  const [paidOutInput, setPaidOutInput] = useState('')
  const [paidOutTouched, setPaidOutTouched] = useState(false)

  // Vsako novo odprtje lista (nov igralec) ponastavi ves vnos — prejšnji
  // igralec ne sme pustiti sledi v poljih naslednjega.
  useEffect(() => {
    if (!open) return
    setEurInput('')
    setChipCounts({})
    setChipsTouched(false)
    setPaidOutInput('')
    setPaidOutTouched(false)
  }, [open, sessionPlayerId])

  const cashoutCents: Cents | null =
    cashoutMode === 'eur'
      ? parseEurToCents(eurInput)
      : chipsTouched
        ? chipCountsToCents(chipCounts, chipDenominations)
        : null

  // Predlog: (C − B) + P — kar igralcu pripada, če vzame vse takoj (spec 3.2).
  // Negativno pomeni, da igralec dolguje blagajni (vzel je več, kot mu
  // pripada) — tega ne more "vzeti", zato predlog v tem primeru pade na 0.
  const netOwedCents = cashoutCents === null ? null : cashoutCents - takenCents + paidCents
  const suggestedCents = netOwedCents === null ? null : Math.max(0, netOwedCents)

  // Dokler uporabnik izplačila ni ročno spremenil, sledi predlogu — tudi ko
  // ta zaradi spremembe C naknadno poskoči.
  useEffect(() => {
    if (paidOutTouched) return
    if (suggestedCents === null) return
    setPaidOutInput(centsToPlainInput(suggestedCents))
  }, [suggestedCents, paidOutTouched])

  const paidOutCents = parseEurToCents(paidOutInput)
  const canConfirm =
    sessionPlayerId !== null && cashoutCents !== null && paidOutCents !== null && paidOutCents >= 0

  const boxAfter = paidOutCents === null ? boxCentsNow : boxCentsNow - paidOutCents

  async function handleConfirm() {
    if (!canConfirm || sessionPlayerId === null || cashoutCents === null || paidOutCents === null) return
    await recordEarlyCashout(
      db,
      sessionPlayerId,
      cashoutCents,
      paidOutCents,
      cashoutMode === 'zetoni' ? chipCounts : null,
    )
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title={`${playerName} — odhod`}>
      <div className="space-y-5">
        <div>
          <p className="eyebrow">Vrednost žetonov ob odhodu</p>
          {cashoutMode === 'eur' ? (
            <input
              type="text"
              inputMode="decimal"
              value={eurInput}
              onChange={(e) => setEurInput(e.target.value)}
              placeholder="0,00"
              aria-label={`Vrednost žetonov ob odhodu za ${playerName}`}
              className="border-line bg-raised text-bone num mt-2 min-h-11 w-full rounded-lg border px-3 text-lg"
            />
          ) : (
            <div className="mt-2">
              <ChipCounter
                denominations={chipDenominations}
                counts={chipCounts}
                onChange={(counts) => {
                  setChipCounts(counts)
                  setChipsTouched(true)
                }}
              />
            </div>
          )}
        </div>

        {cashoutCents !== null && suggestedCents !== null && (
          <div className="border-line rounded-lg border p-3">
            <p className="eyebrow">Predlagano izplačilo zdaj</p>
            <Money cents={suggestedCents} className="mt-1 block text-2xl" />
            {netOwedCents !== null && netOwedCents < 0 && (
              <p className="text-oxblood mt-1 text-xs">
                Igralec pravzaprav dolguje {formatEur(Math.abs(netOwedCents))} — to je treba pobrati, ne izplačati.
              </p>
            )}
            <div className="mt-2 flex gap-2">
              <Button
                className="flex-1"
                onClick={() => {
                  setPaidOutInput(centsToPlainInput(suggestedCents))
                  setPaidOutTouched(true)
                }}
              >
                Vzemi vse zdaj
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  setPaidOutInput('0,00')
                  setPaidOutTouched(true)
                }}
              >
                Pusti v blagajni
              </Button>
            </div>
          </div>
        )}

        <div>
          <label htmlFor="odhod-paidout" className="eyebrow">
            Koliko gotovine dejansko vzame zdaj
          </label>
          <input
            id="odhod-paidout"
            type="text"
            inputMode="decimal"
            value={paidOutInput}
            onChange={(e) => {
              setPaidOutInput(e.target.value)
              setPaidOutTouched(true)
            }}
            aria-label={`Znesek, ki ga ${playerName} vzame iz blagajne zdaj`}
            className="border-line bg-raised text-bone num mt-2 min-h-11 w-full rounded-lg border px-3 text-lg"
          />
        </div>

        <div className="border-line rounded-lg border p-3">
          <p className="eyebrow">Blagajna po tem odhodu</p>
          {/* Namerno BREZ medenine — ta je rezervirana izključno za BlagajnaStrip
              in PoravnavaScreen (glej nalogo). Tu gre za predogled posledice,
              ne za glavno kontrolno številko zaslona. */}
          <Money cents={boxAfter} className="mt-1 block text-2xl font-semibold" />
          {boxAfter < 0 && (
            <p className="text-oxblood mt-1 text-xs">
              Opozorilo: to bi blagajno spravilo v minus — preveri znesek.
            </p>
          )}
        </div>

        <Button fullWidth size="large" onClick={() => void handleConfirm()} disabled={!canConfirm}>
          Potrdi odhod
        </Button>
      </div>
    </Sheet>
  )
}
