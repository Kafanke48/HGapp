import { describe, it, expect } from 'vitest'
import {
  splitEvenly,
  splitProportional,
  parseEurToCents,
  formatEur,
  DenarnaNapaka,
} from './money.ts'

describe('splitEvenly', () => {
  it('100 / 4 se izide brez ostanka', () => {
    expect(splitEvenly(100, 4)).toEqual([25, 25, 25, 25])
  })

  it('100 / 3 da ostanek prvim indeksom', () => {
    expect(splitEvenly(100, 3)).toEqual([34, 33, 33])
  })

  it('1 / 3 da en cent prvemu, ostali 0', () => {
    expect(splitEvenly(1, 3)).toEqual([1, 0, 0])
  })

  it('0 / 5 je vseh 0', () => {
    expect(splitEvenly(0, 5)).toEqual([0, 0, 0, 0, 0])
  })

  it('negativen znesek: -50 / 3', () => {
    expect(splitEvenly(-50, 3)).toEqual([-16, -17, -17])
  })
})

describe('splitProportional', () => {
  it('ena utež je 0 med neničelnimi', () => {
    // 100 razdeljeno po utežeh [1, 0, 1] -> prvi in tretji po 50, drugi nič.
    expect(splitProportional(100, [1, 0, 1])).toEqual([50, 0, 50])
  })

  it('vsota uteži 0 vrže napako', () => {
    expect(() => splitProportional(100, [0, 0, 0])).toThrow(DenarnaNapaka)
  })

  it('metoda največjega ostanka razdeli ostanek po padajočem decimalnem delu', () => {
    // uteži 1,1,1 na 100 centov: vsak 33,33... -> 34,33,33 (ostanek gre nižjim indeksom pri izenačenju)
    expect(splitProportional(100, [1, 1, 1])).toEqual([34, 33, 33])
  })
})

describe('parseEurToCents', () => {
  it('celo število "12"', () => {
    expect(parseEurToCents('12')).toBe(1200)
  })

  it('vejica kot decimalno ločilo "12,50"', () => {
    expect(parseEurToCents('12,50')).toBe(1250)
  })

  it('pika kot decimalno ločilo "12.5"', () => {
    expect(parseEurToCents('12.5')).toBe(1250)
  })

  it('vejica z znakom evra in presledkom "12,5 €"', () => {
    expect(parseEurToCents('12,5 €')).toBe(1250)
  })

  it('prazen niz vrne null', () => {
    expect(parseEurToCents('')).toBeNull()
  })

  it('nesmiseln vnos vrne null', () => {
    expect(parseEurToCents('abc')).toBeNull()
  })
})

describe('formatEur', () => {
  it('4750 -> "47,50 €"', () => {
    expect(formatEur(4750)).toBe('47,50 €')
  })

  it('0 -> "0,00 €"', () => {
    expect(formatEur(0)).toBe('0,00 €')
  })

  it('-1550 -> "−15,50 €"', () => {
    expect(formatEur(-1550)).toBe('−15,50 €')
  })
})
