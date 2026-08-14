import { useEffect, useState } from 'react'
import type { Cents } from '../../domain/money.ts'
import { formatEur, parseEurToCents } from '../../domain/money.ts'
import type { BuyInKind, PaymentMethod } from '../../db/types.ts'
import { Sheet } from './Sheet.tsx'
import { Button } from './Button.tsx'

export interface BuyInSubmission {
  amountCents: Cents
  kind: BuyInKind
  paymentMethod: PaymentMethod
  note: string | null
}

interface BuyInSheetProps {
  open: boolean
  playerName: string
  presetsCents: readonly Cents[]
  defaultAmountCents: Cents
  onClose: () => void
  onSubmit: (input: BuyInSubmission) => void
}

/** Poker izrazi ostanejo v angleščini (glej pravila copyja). */
const KIND_LABELS: Record<BuyInKind, string> = {
  buyin: 'buy-in',
  rebuy: 'rebuy',
  addon: 'add-on',
}

const KIND_ORDER: readonly BuyInKind[] = ['buyin', 'rebuy', 'addon']
const METHOD_ORDER: readonly PaymentMethod[] = ['gotovina', 'nakazilo', 'kredo']

function chipClass(selected: boolean): string {
  // Namenoma brez novih barv: izbrano/neizbrano ločimo le z ozadjem in besedilom,
  // rob ostane vedno border-line.
  return `border-line min-h-11 flex-1 rounded-lg border px-3 text-sm font-medium ${
    selected ? 'bg-raised text-bone' : 'bg-surface text-bone-dim'
  }`
}

/**
 * Dolg pritisk na ploščico igralca. Namenoma več korakov kot kratek tap —
 * to je cena za izbiro zneska in načina, ki nista privzeta.
 */
export function BuyInSheet({
  open,
  playerName,
  presetsCents,
  defaultAmountCents,
  onClose,
  onSubmit,
}: BuyInSheetProps) {
  const [amountCents, setAmountCents] = useState<Cents>(defaultAmountCents)
  const [customInput, setCustomInput] = useState('')
  const [kind, setKind] = useState<BuyInKind>('buyin')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('gotovina')
  const [note, setNote] = useState('')

  // Vsako novo odprtje (nov igralec ali nov privzeti znesek) ponastavi list.
  useEffect(() => {
    if (!open) return
    setAmountCents(defaultAmountCents)
    setCustomInput('')
    setKind('buyin')
    setPaymentMethod('gotovina')
    setNote('')
  }, [open, defaultAmountCents])

  const handleCustomInput = (value: string) => {
    setCustomInput(value)
    const parsed = parseEurToCents(value)
    if (parsed !== null && parsed > 0) setAmountCents(parsed)
  }

  const handleSubmit = () => {
    if (amountCents <= 0) return
    const trimmedNote = note.trim()
    onSubmit({ amountCents, kind, paymentMethod, note: trimmedNote === '' ? null : trimmedNote })
  }

  return (
    <Sheet open={open} onClose={onClose} title={playerName}>
      <div className="space-y-5">
        <div>
          <p className="eyebrow">Znesek</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {presetsCents.map((preset) => {
              const selected = customInput === '' && amountCents === preset
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setAmountCents(preset)
                    setCustomInput('')
                  }}
                  aria-pressed={selected}
                  className={`num min-h-11 rounded-lg border px-4 text-sm font-semibold ${
                    selected ? 'border-line bg-raised text-bone' : 'border-line bg-surface text-bone-dim'
                  }`}
                >
                  {formatEur(preset)}
                </button>
              )
            })}
          </div>
          <input
            type="text"
            inputMode="decimal"
            placeholder="Drug znesek, npr. 15,50"
            value={customInput}
            onChange={(e) => handleCustomInput(e.target.value)}
            aria-label="Drug znesek v evrih"
            className="border-line bg-surface text-bone num mt-2 min-h-11 w-full rounded-lg border px-3 text-sm"
          />
        </div>

        <div>
          <p className="eyebrow">Vrsta</p>
          <div className="mt-2 flex gap-2">
            {KIND_ORDER.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className={chipClass(kind === k)}
              >
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="eyebrow">Način vplačila</p>
          <div className="mt-2 flex gap-2">
            {METHOD_ORDER.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPaymentMethod(m)}
                aria-pressed={paymentMethod === m}
                className={chipClass(paymentMethod === m)}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="buyin-note" className="eyebrow">
            Opomba (neobvezno)
          </label>
          <input
            id="buyin-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="border-line bg-surface text-bone mt-2 min-h-11 w-full rounded-lg border px-3 text-sm"
          />
        </div>

        <Button fullWidth size="large" onClick={handleSubmit} disabled={amountCents <= 0}>
          Zabeleži {KIND_LABELS[kind]} — {formatEur(amountCents)}
        </Button>
      </div>
    </Sheet>
  )
}
