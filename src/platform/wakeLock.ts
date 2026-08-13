/**
 * `navigator.wakeLock` - drži zaslon prižgan med aktivno sejo (spec 6.1: med
 * igro nihče noče tipkati oz. odklepati telefona vsakih nekaj minut).
 *
 * POŠTENO OPOZORILO, da tega kdo kasneje ne razume narobe: Wake Lock NE
 * omogoča nobenega izvajanja kode v ozadju na iOS. Drži samo zaslon prižgan,
 * dokler je aplikacija v ospredju. Takoj ko uporabnik zaklene telefon, zamenja
 * aplikacijo ali zatemni zaslon, WebKit wake lock samodejno sprosti (`release`
 * dogodek) - to NI napaka, ampak pričakovano obnašanje, zato ob vrnitvi v
 * ospredje wake lock eksplicitno zahtevamo znova.
 */

interface WakeLockSentinelLike {
  release: () => Promise<void>
  addEventListener?: (type: 'release', listener: () => void) => void
}

interface WakeLockLike {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>
}

/** Podmnožica `Navigator`, ki jo ta modul potrebuje. */
export interface WakeLockNavigatorLike {
  wakeLock?: WakeLockLike
}

function realNavigator(): WakeLockNavigatorLike {
  return typeof navigator !== 'undefined' ? (navigator as WakeLockNavigatorLike) : {}
}

let sentinel: WakeLockSentinelLike | null = null
/** Ali uporabnik/seja ŽELI wake lock aktiven - uporabljeno za ponovno pridobitev po vrnitvi v ospredje. */
let wanted = false
let visibilityHandlerAttached = false

function attachVisibilityHandler(nav: WakeLockNavigatorLike): void {
  if (visibilityHandlerAttached) return
  if (typeof document === 'undefined') return
  visibilityHandlerAttached = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wanted && !sentinel) {
      void acquireWakeLock(nav)
    }
  })
}

/**
 * Poskusi pridobiti wake lock. Feature-detected, nikoli ne vrže napake -
 * vrne `false`, če ni podprto ali je bilo zavrnjeno (npr. varčevanje z baterijo).
 */
export async function acquireWakeLock(nav: WakeLockNavigatorLike = realNavigator()): Promise<boolean> {
  wanted = true
  attachVisibilityHandler(nav)
  if (!nav.wakeLock) return false
  try {
    const newSentinel = await nav.wakeLock.request('screen')
    sentinel = newSentinel
    newSentinel.addEventListener?.('release', () => {
      if (sentinel === newSentinel) sentinel = null
    })
    return true
  } catch {
    sentinel = null
    return false
  }
}

/** Sprosti wake lock in ustavi samodejno ponovno pridobivanje ob vrnitvi v ospredje. */
export async function releaseWakeLock(): Promise<void> {
  wanted = false
  const current = sentinel
  sentinel = null
  if (current) {
    try {
      await current.release()
    } catch {
      // Sprostitev, ki spodleti, ni usodna - sentinel je itak že odstranjen zgoraj.
    }
  }
}

/** Ali je wake lock trenutno dejansko pridobljen (za diagnostiko/UI). */
export function isWakeLockActive(): boolean {
  return sentinel !== null
}
