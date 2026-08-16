import type { Cents } from '../../domain/money.ts'
import { formatEur } from '../../domain/money.ts'
import type { PaymentMethod } from '../../db/types.ts'
import { Money } from './Money.tsx'

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
  /** Privzeti znesek buy-ina za to sejo — izpisan na gumbu, da si ga ni treba zapomniti. */
  defaultBuyInCents: Cents
  /** Gumb "+ znesek": buy-in privzetega zneska, gotovina, brez potrditve. */
  onQuickBuyIn: () => void
  /** Gumb "Drugo": odpre BuyInSheet za poljuben znesek in način vplačila. */
  onOpenDetail: () => void
}

const MAX_PIPS = 8

/**
 * Ploščica igralca med sejo.
 *
 * To je gotovinska igra, ne turnir: vsak igralec kupi za poljuben znesek,
 * zato je "Drugo" enakovreden gumb, ne skrita funkcija za dolg pritisk.
 * Dolg pritisk je bil neodkrit in je blokiral hitro ponavljajoče vnašanje —
 * zato sta zdaj dva ločena, vidna gumba.
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
  defaultBuyInCents,
  onQuickBuyIn,
  onOpenDetail,
}: PlayerTileProps) {
  const owedCents = takenCents - paidCents
  const shown = pips.slice(0, MAX_PIPS)
  const overflow = pips.length - shown.length

  return (
    <div className="tile flex w-full flex-col justify-between p-3">
      <div>
        <span className="text-bone block truncate text-[0.9375rem] font-semibold">{name}</span>

        <Money cents={takenCents} className="mt-1 block text-2xl leading-none" />

        {owedCents > 0 && (
          <span className="text-oxblood mt-0.5 block text-[0.6875rem] font-medium">
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
      </div>

      {/* Dva enakovredna gumba namesto tap/dolg-pritisk: privzeti znesek je oznacen
          s stevilko, da ga ni treba vedeti na pamet; "Drugo" odpre list za poljuben
          znesek, kar je pri gotovinski igri normalen primer, ne izjema. */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onQuickBuyIn}
          aria-label={`${name}: buy-in ${formatEur(defaultBuyInCents)}`}
          className="bg-raised text-bone num min-h-11 rounded-lg text-[0.8125rem] font-semibold"
        >
          + {formatEur(defaultBuyInCents)}
        </button>
        <button
          type="button"
          onClick={onOpenDetail}
          aria-label={`${name}: buy-in z drugim zneskom`}
          className="border-line text-bone-dim min-h-11 rounded-lg border text-[0.8125rem] font-semibold"
        >
          Drugo
        </button>
      </div>
    </div>
  )
}
