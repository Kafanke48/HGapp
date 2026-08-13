import { describe, expect, it } from 'vitest'
import { isIOS, isStandalone, storageRiskLevel } from './standalone.ts'

describe('isStandalone', () => {
  it('prepozna nameščeno aplikacijo prek matchMedia (display-mode: standalone)', () => {
    const win = { matchMedia: (q: string) => ({ matches: q === '(display-mode: standalone)' }) }
    expect(isStandalone(win, {})).toBe(true)
  })

  it('prepozna navaden zavihek brskalnika kot NEnameščeno', () => {
    const win = { matchMedia: () => ({ matches: false }) }
    expect(isStandalone(win, {})).toBe(false)
  })

  it('prepozna iOS standalone prek navigator.standalone, tudi če matchMedia pravi false', () => {
    const win = { matchMedia: () => ({ matches: false }) }
    const nav = { standalone: true }
    expect(isStandalone(win, nav)).toBe(true)
  })

  it('deluje, tudi če matchMedia sploh ni na voljo (starejši/lažni Window)', () => {
    const nav = { standalone: true }
    expect(isStandalone({}, nav)).toBe(true)
    expect(isStandalone({}, {})).toBe(false)
  })
})

describe('storageRiskLevel', () => {
  it('vrne "varno", kadar je aplikacija nameščena', () => {
    const win = { matchMedia: () => ({ matches: true }) }
    expect(storageRiskLevel(win, {})).toBe('varno')
  })

  it('vrne "ogrozeno" v navadnem zavihku brskalnika', () => {
    const win = { matchMedia: () => ({ matches: false }) }
    expect(storageRiskLevel(win, {})).toBe('ogrozeno')
  })

  it('vrne "varno" na iOS standalone tudi brez matchMedia', () => {
    expect(storageRiskLevel({}, { standalone: true })).toBe('varno')
  })
})

describe('isIOS', () => {
  it('prepozna iPhone po userAgent', () => {
    expect(isIOS({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)' })).toBe(true)
  })

  it('prepozna iPad po userAgent', () => {
    expect(isIOS({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)' })).toBe(true)
  })

  it('prepozna iPadOS 13+ (predstavlja se kot Macintosh, a ima dotik)', () => {
    const nav = {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    }
    expect(isIOS(nav)).toBe(true)
  })

  it('ne prepozna pravega namiznega macOS (brez dotika)', () => {
    const nav = {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 0,
    }
    expect(isIOS(nav)).toBe(false)
  })

  it('ne prepozna Androida', () => {
    expect(isIOS({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)' })).toBe(false)
  })
})
