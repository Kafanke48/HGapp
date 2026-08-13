/**
 * Denarna aritmetika. Vse v CELIH CENTIH.
 *
 * Zakaj: decimalna števila (float) pri deljenju in seštevanju proizvedejo napake
 * velikosti delcev centa, ki se seštevajo. Ker celotna aplikacija sloni na
 * invarianti "vsota netov je natanko 0", bi ena taka napaka podrla obračun.
 *
 * Ta datoteka je ČISTA: brez baze, brez Reacta, brez datumov.
 */

/** Cel znesek v centih. Nikoli ne sme vsebovati decimalk. */
export type Cents = number

export class DenarnaNapaka extends Error {}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0
  for (const v of values) total += v
  return total
}

/** Preveri, da je vrednost cel znesek v centih. */
export function assertCents(value: number, context: string): asserts value is Cents {
  if (!Number.isInteger(value)) {
    throw new DenarnaNapaka(`${context}: ${value} ni celo število centov`)
  }
}

/**
 * Razdeli znesek na `n` enakih delov po metodi največjega ostanka.
 *
 * Ostanek centov gre prvim indeksom po vrsti. Klicatelj MORA podati igralce v
 * stabilnem, determinističnem vrstnem redu (npr. urejene po id), sicer bi isti
 * vhod lahko dal različne rezultate.
 *
 * Deluje tudi za negativne zneske: splitEvenly(-50, 3) === [-16, -17, -17].
 */
export function splitEvenly(totalCents: Cents, n: number): Cents[] {
  assertCents(totalCents, 'splitEvenly')
  if (!Number.isInteger(n) || n <= 0) {
    throw new DenarnaNapaka(`splitEvenly: n mora biti pozitivno celo število, dobil ${n}`)
  }
  const base = Math.floor(totalCents / n)
  const remainder = totalCents - base * n // vedno 0 <= remainder < n
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0))
}

/**
 * Razdeli znesek sorazmerno z utežmi, po metodi največjega ostanka.
 *
 * Uteži morajo biti nenegativne. Če je vsota uteži 0, delitev ni definirana —
 * vrže napako, ker mora klicatelj to eksplicitno obravnavati (npr. delitev
 * stroškov "po dobičku", kadar nihče ni v plusu).
 *
 * Ostanek gre najprej tistim z največjim decimalnim ostankom; pri izenačenju
 * odloči nižji indeks.
 */
export function splitProportional(totalCents: Cents, weights: readonly number[]): Cents[] {
  assertCents(totalCents, 'splitProportional')
  if (weights.length === 0) {
    throw new DenarnaNapaka('splitProportional: prazen seznam uteži')
  }
  if (weights.some((w) => w < 0)) {
    throw new DenarnaNapaka('splitProportional: uteži ne smejo biti negativne')
  }
  const sumWeights = weights.reduce((a, b) => a + b, 0)
  if (sumWeights === 0) {
    throw new DenarnaNapaka('splitProportional: vsota uteži je 0, delitev ni definirana')
  }

  const exact = weights.map((w) => (totalCents * w) / sumWeights)
  const floors = exact.map((r) => Math.floor(r))
  const distributed = sumCents(floors)
  let remainder = totalCents - distributed

  const order = exact
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)

  const result = [...floors]
  let k = 0
  while (remainder > 0 && k < order.length) {
    result[order[k]!.i]! += 1
    remainder -= 1
    k += 1
  }
  return result
}

/** Invarianta: vsota saldov mora biti natanko 0. */
export function assertZeroSum(values: readonly Cents[], context: string): void {
  const total = sumCents(values)
  if (total !== 0) {
    throw new DenarnaNapaka(`${context}: vsota je ${total} centov, pričakovano 0`)
  }
}

/** Oblikuje cente v slovenski zapis, npr. 4750 -> "47,50 €". */
export function formatEur(cents: Cents): string {
  const sign = cents < 0 ? '−' : ''
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  return `${sign}${whole},${frac} €`
}

/** Isto kot formatEur, a s predznakom + za pozitivne (za prikaz saldov). */
export function formatEurSigned(cents: Cents): string {
  if (cents > 0) return `+${formatEur(cents)}`
  return formatEur(cents)
}

/**
 * Razčleni uporabnikov vnos ("12", "12,50", "12.5", "12,5 €") v cente.
 * Vrne null, če vnos ni veljaven.
 */
export function parseEurToCents(input: string): Cents | null {
  const cleaned = input.trim().replace(/\s|€/g, '').replace(',', '.')
  if (cleaned === '' || !/^-?\d*\.?\d*$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  return Math.round(value * 100)
}
