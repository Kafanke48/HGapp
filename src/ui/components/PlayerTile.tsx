import { useRef } from 'react'
import type { Cents } from '../../domain/money.ts'
import { formatEur } from '../../domain/money.ts'
import type { PaymentMethod } from '../../db/types.ts'

export interface TilePip {
  method: PaymentMethod
  confirmation: 'nepotrjen' | 'potrjen' | 'zavrnjen'
}

interface PlayerTileProps {
  name: string
  /** B — koliko žetonov je vzel. */
  takenCents: Cents
  /** P — koliko je dejansko plačal. */
  paidCents: Cents
  pips: readonly TilePip[]
  /** Kratek tap: buy-in privzetega zneska. */
  onQuickBuyIn: () => void
  /** Dolg pritisk: izbira zneska in načina vplačila. */
  onOpenDetail: () => void
}

const MAX_PIPS = 8
const LONG_PRESS_MS = 400

/**
 * Ploščica igralca med sejo.
 *
 * Vrstica pik je nosilec informacije, ne okras: ena pika je en buy-in,
 * votla pika je kredo. Kdor ima votle pike, je razlog, da bo blagajna
 * ob koncu prekratka — in to se vidi, ne da bi karkoli odprl.
 */
export function PlayerTile({
  name,
  takenCents,
  paidCents,
  pips,
  onQuickBuyIn,
  onOpenDetail,
}: PlayerTileProps) {
  const timer = useRef<number | null>(null)
  const fired = useRef(false)

  const start = () => {
    fired.current = false
    timer.current = window.setTimeout(() => {
      fired.current = true
      // Kratek haptični odziv potrdi, da je dolg pritisk zaznan. Brez tega
      // uporabnik ne ve, ali drži dovolj dolgo, in prekine na pol poti.
      navigator.vibrate?.(12)
      onOpenDetail()
    }, LONG_PRESS_MS)
  }

  const cancel = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }

  const end = () => {
    cancel()
    if (!fired.current) onQuickBuyIn()
  }

  const owedCents = takenCents - paidCents
  const shown = pips.slice(0, MAX_PIPS)
  const overflow = pips.length - shown.length

  return (
    <button
      type="button"
      className="tile flex w-full flex-col justify-between p-3 text-left"
      onPointerDown={start}
      onPointerUp={end}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={`${name}, vzel ${formatEur(takenCents)}, plačal ${formatEur(paidCents)}`}
    >
      <span className="text-bone truncate text-[0.9375rem] font-semibold">{name}</span>

      <span className="num text-bone mt-1 text-2xl leading-none">{formatEur(takenCents)}</span>

      {owedCents > 0 && (
        <span className="text-oxblood mt-0.5 text-[0.6875rem] font-medium">
          dolguje {formatEur(owedCents)}
        </span>
      )}

      <span className="mt-2 flex items-center gap-1" aria-hidden="true">
        {shown.map((pip, i) => (
          <span
            key={i}
            className={`pip ${
              pip.method === 'kredo'
                ? 'pip-credit'
                : pip.method === 'nakazilo'
                  ? 'pip-transfer'
                  : 'pip-paid'
            }`}
          />
        ))}
        {overflow > 0 && <span className="text-bone-faint text-[0.625rem]">+{overflow}</span>}
        {pips.length === 0 && <span className="text-bone-faint text-[0.6875rem]">brez buy-ina</span>}
      </span>
    </button>
  )
}
