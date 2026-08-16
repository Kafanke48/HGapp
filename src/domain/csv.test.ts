import { describe, it, expect } from 'vitest'
import { toCsv, centsForCsv } from './csv.ts'

describe('toCsv', () => {
  it('prepne UTF-8 BOM na zacetek', () => {
    const result = toCsv([['a', 'b']])
    expect(result.charCodeAt(0)).toBe(0xfeff)
  })

  it('vrstice loci s CRLF', () => {
    const result = toCsv([
      ['a', 'b'],
      ['c', 'd'],
    ])
    // Odrezemo BOM, nato preverimo natancno obliko.
    expect(result.slice(1)).toBe('a;b\r\nc;d')
  })

  it('polja v isti vrstici loci s podpicjem', () => {
    const result = toCsv([['prvi', 'drugi', 'tretji']])
    expect(result.slice(1)).toBe('prvi;drugi;tretji')
  })

  it('polje s podpicjem se ovije v navednice', () => {
    const result = toCsv([['Ljubljana; center', 'ok']])
    expect(result.slice(1)).toBe('"Ljubljana; center";ok')
  })

  it('vgrajena navednica se podvoji', () => {
    const result = toCsv([['Reklo "adut"', 'ok']])
    expect(result.slice(1)).toBe('"Reklo ""adut""";ok')
  })

  it('polje s prelomom vrstice se ovije v navednice', () => {
    const result = toCsv([['prva\ndruga', 'ok']])
    expect(result.slice(1)).toBe('"prva\ndruga";ok')
  })

  it('prazen vhod da samo BOM', () => {
    const result = toCsv([])
    expect(result).toBe('﻿')
  })
})

describe('centsForCsv', () => {
  it('0 -> "0,00"', () => {
    expect(centsForCsv(0)).toBe('0,00')
  })

  it('pozitiven znesek: 4750 -> "47,50"', () => {
    expect(centsForCsv(4750)).toBe('47,50')
  })

  it('negativen znesek: -4750 -> "-47,50"', () => {
    expect(centsForCsv(-4750)).toBe('-47,50')
  })

  it('znesek pod en evro: 5 -> "0,05"', () => {
    expect(centsForCsv(5)).toBe('0,05')
  })

  it('negativen znesek pod en evro: -5 -> "-0,05"', () => {
    expect(centsForCsv(-5)).toBe('-0,05')
  })
})
