import type { Cents } from '../../domain/money.ts'
import { chipCountsToCents } from '../../domain/chips.ts'
import type { ChipDenomination } from '../../db/types.ts'
import { Money } from './Money.tsx'

interface ChipCounterProps {
  denominations: readonly ChipDenomination[]
  /** Število žetonov po barvi (ključ = `label`). Manjkajoč ključ pomeni 0. */
  counts: Record<string, number>
  onChange: (counts: Record<string, number>) => void
}

/**
 * Vnos cashouta po barvah žetonov (spec, razdelek 6.3).
 *
 * En vrstica na barvo z veliko +/− tarčo za palec (štetje po dolgi seji) IN
 * neposrednim vnosom števila — nekateri raje natipkajo "37" kot tapnejo 37-krat.
 * Skupna pretvorjena vrednost je vedno vidna zraven, da uporabnik takoj vidi,
 * ali se ujema s tem, kar misli, da ima na mizi.
 */
export function ChipCounter({ denominations, counts, onChange }: ChipCounterProps) {
  const totalCents: Cents = safeTotal(counts, denominations)

  function setCount(label: string, next: number): void {
    const clamped = Number.isFinite(next) && next > 0 ? Math.floor(next) : 0
    onChange({ ...counts, [label]: clamped })
  }

  return (
    <div>
      <div className="flex flex-col gap-2">
        {denominations.map((d) => {
          const count = counts[d.label] ?? 0
          return (
            <div key={d.label} className="flex items-center gap-2">
              <span
                className="border-line inline-block size-4 shrink-0 rounded-full border"
                style={{ backgroundColor: d.colorHex }}
                aria-hidden="true"
              />
              <span className="text-bone-dim min-w-0 flex-1 truncate text-[0.8125rem]">
                {d.label}{' '}
                <span className="text-bone-faint">({formatEurShort(d.cents)})</span>
              </span>
              <button
                type="button"
                className="border-line text-bone flex size-11 shrink-0 items-center justify-center rounded-lg border text-lg font-semibold active:bg-raised"
                onClick={() => setCount(d.label, count - 1)}
                aria-label={`Odstrani en žeton barve ${d.label}`}
              >
                −
              </button>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                className="num text-bone bg-raised border-line w-12 shrink-0 rounded-lg border py-2 text-center text-base"
                value={String(count)}
                onChange={(e) => {
                  const digits = e.target.value.replace(/[^0-9]/g, '')
                  setCount(d.label, digits === '' ? 0 : Number(digits))
                }}
                aria-label={`Število žetonov barve ${d.label}`}
              />
              <button
                type="button"
                className="border-line text-bone flex size-11 shrink-0 items-center justify-center rounded-lg border text-lg font-semibold active:bg-raised"
                onClick={() => setCount(d.label, count + 1)}
                aria-label={`Dodaj en žeton barve ${d.label}`}
              >
                +
              </button>
            </div>
          )
        })}
      </div>
      <div className="border-line mt-3 flex items-center justify-between border-t pt-2">
        <span className="eyebrow">Skupaj</span>
        <Money cents={totalCents} className="text-lg" />
      </div>
    </div>
  )
}

/**
 * Preračuna skupno vrednost, a filtrira ključe na znane barve — med prehodom
 * (npr. sprememba denominacij v nastavitvah) `counts` lahko za trenutek
 * vsebuje barvo, ki je ni več na seznamu. Uporabnik med štetjem ne sme
 * dobiti neujemajoče se napake.
 */
function safeTotal(counts: Record<string, number>, denominations: readonly ChipDenomination[]): Cents {
  const known = Object.fromEntries(
    Object.entries(counts).filter(([label]) => denominations.some((d) => d.label === label)),
  )
  return chipCountsToCents(known, denominations)
}

function formatEurShort(cents: Cents): string {
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`
}
