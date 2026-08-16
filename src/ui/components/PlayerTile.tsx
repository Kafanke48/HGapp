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
  /** Kdaj je igralec zapustil mizo. null pomeni, da še igra (glej SessionPlayer.leftAt). */
  leftAt: number | null
  /** C ob odhodu. Smiselno samo, ko leftAt !== null. */
  cashoutCents: Cents | null
  /** Koliko je od tega že izplačano iz blagajne (glej SessionPlayer.paidOutCents). */
  paidOutCents: Cents
  /** Gumb "Odhod": odpre OdhodSheet za tega (še aktivnega) igralca. */
  onOpenOdhod: () => void
  /** "Vrnil se je za mizo" (undoEarlyCashout) — samo za odšle igralce. */
  onReturn: () => void
}

const MAX_PIPS = 8

/**
 * Ploščica igralca med sejo.
 *
 * To je gotovinska igra, ne turnir: vsak igralec kupi za poljuben znesek,
 * zato je "Drugo" enakovreden gumb, ne skrita funkcija za dolg pritisk.
 * Dolg pritisk je bil neodkrit in je blokiral hitro ponavljajoče vnašanje —
 * zato sta zdaj dva ločena, vidna gumba (plus "Odhod" za odhod sredi seje).
 *
 * Vrstica pik je nosilec informacije, ne okras: ena pika je en buy-in,
 * votla pika je kredo. Kdor ima votle pike, je razlog, da bo blagajna
 * ob koncu prekratka — in to se vidi, ne da bi karkoli odprl.
 *
 * Igralec, ki je zapustil mizo (leftAt !== null), ne sme videti buy-in
 * gumbov — buy-in po odhodu je napaka, ki čaka, da se zgodi (glej nalogo).
 * Namesto tega ploščica pokaže, s čim je odšel, in kaj mu (če karkoli) še
 * pripada.
 */
export function PlayerTile({
  name,
  takenCents,
  paidCents,
  pips,
  defaultBuyInCents,
  onQuickBuyIn,
  onOpenDetail,
  leftAt,
  cashoutCents,
  paidOutCents,
  onOpenOdhod,
  onReturn,
}: PlayerTileProps) {
  const owedCents = takenCents - paidCents
  const hasLeft = leftAt !== null
  const shown = pips.slice(0, MAX_PIPS)
  const overflow = pips.length - shown.length

  // Kolikšna terjatev igralcu še ostane po odhodu: (C − B) + P − že izplačano
  // (glej specifikacijo, razdelek 3.2, in PlayerInput.paidOutCents). 0, kadar
  // C še ni vpisan — to se v praksi ne zgodi, ker OdhodSheet C vedno zahteva.
  const remainingClaimCents =
    hasLeft && cashoutCents !== null ? cashoutCents - takenCents + paidCents - paidOutCents : 0

  return (
    <div className={`tile flex w-full flex-col justify-between p-3 ${hasLeft ? 'opacity-60' : ''}`}>
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-bone block truncate text-[0.9375rem] font-semibold">{name}</span>
          {hasLeft && (
            <span className="text-bone-faint shrink-0 text-[0.625rem] font-semibold tracking-wide uppercase">
              odšel
            </span>
          )}
        </div>

        <Money cents={takenCents} className="mt-1 block text-2xl leading-none" />

        {!hasLeft && owedCents > 0 && (
          <span className="text-oxblood mt-0.5 block text-[0.6875rem] font-medium">
            dolguje {formatEur(owedCents)}
          </span>
        )}

        {hasLeft && cashoutCents !== null && (
          <span className="text-bone-dim mt-0.5 block text-[0.6875rem]">
            odšel z {formatEur(cashoutCents)}
            {remainingClaimCents !== 0 && (
              <>
                {' · '}
                <span className={remainingClaimCents > 0 ? 'text-jade' : 'text-oxblood'}>
                  {remainingClaimCents > 0 ? 'še mu pripada' : 'še dolguje'}{' '}
                  {formatEur(Math.abs(remainingClaimCents))}
                </span>
              </>
            )}
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

      {hasLeft ? (
        // En sam gumb za vrnitev — buy-in gumbov namerno ni (glej nalogo).
        <button
          type="button"
          onClick={onReturn}
          aria-label={`${name}: vrnil se je za mizo`}
          className="border-line text-bone mt-3 min-h-11 rounded-lg border text-[0.8125rem] font-semibold"
        >
          Vrnil se je za mizo
        </button>
      ) : (
        // Dva enakovredna gumba za buy-in (namesto tap/dolg-pritisk) plus tretji,
        // celoširoki gumb za odhod — v svoji vrstici, da prva dva ostaneta
        // enako velika in nespremenjena kot pred to nalogo.
        <div className="mt-3 flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
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
          <button
            type="button"
            onClick={onOpenOdhod}
            aria-label={`${name}: odhod od mize`}
            className="border-line text-bone-dim min-h-11 rounded-lg border text-[0.8125rem] font-semibold"
          >
            Odhod
          </button>
        </div>
      )}
    </div>
  )
}
