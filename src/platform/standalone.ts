/**
 * Zaznavanje, ali aplikacija teče kot samostojna (nameščena na domači zaslon).
 *
 * ZAKAJ je to pomembno (glej specifikacijo, razdelek 8.1): WebKit v navadnem
 * Safari zavihku po 7 dneh neuporabe izbriše IndexedDB in ostalo shrambo strani.
 * Aplikacija, dodana na domači zaslon ("Add to Home Screen"), je iz tega
 * brisanja izvzeta. Zato mora aplikacija ob zagonu zanesljivo ločiti "teče
 * nameščena" od "teče v zavihku brskalnika" in v slednjem primeru uporabnika
 * opozoriti (UI plast to naredi z oviro čez cel zaslon, glej spec 8.1).
 *
 * Funkcije spodaj `window`/`navigator` sprejemajo kot PARAMETRA namesto branja
 * globalnih spremenljivk znotraj telesa funkcije. Razlog: testi (`*.test.ts`)
 * tečejo v Node okolju (glej `vite.config.ts`: `test.environment = 'node'`),
 * kjer `window`/`navigator` sploh ne obstajata. Privzete vrednosti parametrov
 * se v JavaScriptu ovrednotijo LENO (šele če klicatelj argumenta ne poda), zato
 * spodnje funkcije v testih (ki vedno podajo lažne objekte) nikoli ne poskusijo
 * dostopiti do resničnega `window`/`navigator`.
 */

/** Podmnožica `Window`, ki jo ta modul potrebuje - lažno implementirati je trivialno. */
export interface StandaloneWindowLike {
  matchMedia?: (query: string) => { matches: boolean } | undefined
}

/** Podmnožica `Navigator`, ki jo ta modul potrebuje. */
export interface StandaloneNavigatorLike {
  /**
   * `navigator.standalone` je netipizirana, SAMO-iOS-Safari lastnost (ni v
   * standardu, ni je v DOM lib). Na drugih platformah je `undefined`.
   */
  standalone?: boolean
  userAgent?: string
  /** Uporabljeno za ločevanje iPadOS 13+ (predstavlja se kot "Macintosh") od pravega macOS. */
  platform?: string
  maxTouchPoints?: number
}

function realWindow(): StandaloneWindowLike {
  return typeof window !== 'undefined' ? window : {}
}

function realNavigator(): StandaloneNavigatorLike {
  return typeof navigator !== 'undefined' ? (navigator as StandaloneNavigatorLike) : {}
}

/**
 * True, kadar aplikacija teče samostojno (nameščena na domači zaslon).
 *
 * Dva neodvisna signala, ker noben sam po sebi ni zanesljiv na vseh platformah:
 *  - `matchMedia('(display-mode: standalone)')` - standardno, deluje na Androidu/desktopu
 *    in tudi na iOS 16.4+.
 *  - `navigator.standalone === true` - starejši, a na iOS Safariju zanesljiv način.
 */
export function isStandalone(
  win: StandaloneWindowLike = realWindow(),
  nav: StandaloneNavigatorLike = realNavigator(),
): boolean {
  const mediaStandalone = win.matchMedia?.('(display-mode: standalone)')?.matches ?? false
  const iosStandalone = nav.standalone === true
  return mediaStandalone || iosStandalone
}

/** True na iPhone/iPad/iPod, vključno z iPadOS 13+, ki se predstavlja kot "Macintosh". */
export function isIOS(nav: StandaloneNavigatorLike = realNavigator()): boolean {
  const ua = nav.userAgent ?? ''
  const isClassicAppleTouch = /iPad|iPhone|iPod/.test(ua)
  // Od iPadOS 13 dalje se User-Agent predstavi kot "Macintosh"; edino zanesljivo
  // ločilo od pravega macOS je prisotnost dotika (namizni Mac nima maxTouchPoints > 1).
  const isIpadOS13Plus = nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1
  return isClassicAppleTouch || isIpadOS13Plus
}

export type StorageRiskLevel = 'varno' | 'ogrozeno'

/**
 * Raven tveganja za izgubo podatkov zaradi 7-dnevnega WebKit brisanja.
 * UI se na to vrednost neposredno veže, da pokaže (ali ne pokaže) oviro
 * čez cel zaslon iz specifikacije 8.1.
 */
export function storageRiskLevel(
  win: StandaloneWindowLike = realWindow(),
  nav: StandaloneNavigatorLike = realNavigator(),
): StorageRiskLevel {
  return isStandalone(win, nav) ? 'varno' : 'ogrozeno'
}
