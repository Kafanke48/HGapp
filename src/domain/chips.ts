/**
 * Pretvorba prešteth žetonov po barvah v cente (glej specifikacijo, razdelek 6.3).
 *
 * Ta datoteka je ČISTA domena: edina izjema od pravila "domena ne uvaža ničesar"
 * je TIP `ChipDenomination` iz `db/` — uvožen samo kot tip (`import type`), nikoli
 * kot vrednost, da plast `db` ostane spodaj v hierarhiji odvisnosti.
 */
import type { Cents } from './money.ts'
import type { ChipDenomination } from '../db/types.ts'
import { DenarnaNapaka } from './money.ts'

/**
 * Sešteje `count × denomination.cents` za vsako barvo.
 *
 * Neznana barva ali negativno število žetonov pomeni napačen vnos uporabnika
 * (npr. tipkarska napaka pri štetju) — tega ne smemo tiho ignorirati, ker bi
 * napačno preštet cashout podrl invarianto ničelne vsote pri poravnavi.
 */
export function chipCountsToCents(
  counts: Record<string, number>,
  denominations: readonly ChipDenomination[],
): Cents {
  const centsByLabel = new Map(denominations.map((d) => [d.label, d.cents]))
  let total = 0
  for (const [label, count] of Object.entries(counts)) {
    if (!Number.isInteger(count) || count < 0) {
      throw new DenarnaNapaka(
        `chipCountsToCents: število žetonov barve '${label}' mora biti nenegativno celo število, dobil ${count}`,
      )
    }
    const cents = centsByLabel.get(label)
    if (cents === undefined) {
      throw new DenarnaNapaka(`chipCountsToCents: neznana barva žetona '${label}'`)
    }
    total += cents * count
  }
  return total
}
