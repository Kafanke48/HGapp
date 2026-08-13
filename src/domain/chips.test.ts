import { describe, it, expect } from 'vitest'
import { chipCountsToCents } from './chips.ts'
import { DenarnaNapaka } from './money.ts'
import type { ChipDenomination } from '../db/types.ts'

const denominations: ChipDenomination[] = [
  { label: 'bela', colorHex: '#ffffff', cents: 10 },
  { label: 'rdeca', colorHex: '#ff0000', cents: 25 },
  { label: 'modra', colorHex: '#0000ff', cents: 100 },
]

describe('chipCountsToCents', () => {
  it('sešteje več barv', () => {
    // 10 bela (10c) + 4 rdeča (25c) + 2 modra (100c) = 100 + 100 + 200 = 400
    expect(
      chipCountsToCents({ bela: 10, rdeca: 4, modra: 2 }, denominations),
    ).toBe(400)
  })

  it('neznana barva vrže napako', () => {
    expect(() => chipCountsToCents({ zelena: 5 }, denominations)).toThrow(DenarnaNapaka)
  })

  it('negativno število vrže napako', () => {
    expect(() => chipCountsToCents({ bela: -1 }, denominations)).toThrow(DenarnaNapaka)
  })

  it('prazen seznam šteje kot 0', () => {
    expect(chipCountsToCents({}, denominations)).toBe(0)
  })
})
