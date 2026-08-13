/**
 * Ovija `virtual:pwa-register` (vite-plugin-pwa) v majhno naročljivo
 * (subscribable) shrambo brez Reacta - UI plast se nanjo naroči s callbackom in
 * prikaže nevsiljivo obvestilo "Na voljo je nova različica" (glej spec 8.3).
 *
 * Modul MORA biti no-op, kadar virtualni modul ni na voljo:
 *  - v testih (Vitest teče v Node okolju, Vite virtualnih modulov tam ni)
 *  - v `vite dev`, ker je v `vite.config.ts` nastavljeno `devOptions.enabled: false`
 * Zato uvoz `virtual:pwa-register` naredimo DINAMIČNO in znotraj try/catch -
 * statični `import` bi v teh okoljih padel že pri nalaganju modula.
 */

export interface UpdateState {
  /** Nova različica čaka - service worker je v stanju "waiting". */
  needRefresh: boolean
  /** Aplikacija je prvič uspešno predpomnjena in deluje brez interneta. */
  offlineReady: boolean
}

type Listener = (state: UpdateState) => void

let state: UpdateState = { needRefresh: false, offlineReady: false }
const listeners = new Set<Listener>()

function setState(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener(state)
}

/** Trenutno stanje - uporabno za sinhroni odčitek ob prvem izrisu UI. */
export function getUpdateState(): UpdateState {
  return state
}

/** Naroči se na spremembe stanja. Vrne funkcijo za odjavo. */
export function subscribeToUpdates(listener: Listener): () => void {
  listeners.add(listener)
  listener(state)
  return () => {
    listeners.delete(listener)
  }
}

let updateSWFn: ((reloadPage?: boolean) => Promise<void>) | null = null
let registration: ServiceWorkerRegistration | undefined
let initialized = false

/**
 * Registrira service worker in začne poslušati posodobitve. Klic je varen za
 * ponovitev (no-op po prvem uspešnem klicu) in nikoli ne vrže napake naprej.
 */
export async function initUpdates(): Promise<void> {
  if (initialized) return
  initialized = true
  try {
    // Dinamičen uvoz: v Node/testih in `vite dev` ta modul ne obstaja in
    // `import()` zavrne obljubo, kar ujamemo spodaj in pustimo modul kot no-op.
    const mod = await import('virtual:pwa-register')
    updateSWFn = mod.registerSW({
      immediate: true,
      onNeedRefresh() {
        setState({ needRefresh: true })
      },
      onOfflineReady() {
        setState({ offlineReady: true })
      },
      onRegisteredSW(_swScriptUrl, reg) {
        registration = reg
      },
    })

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          // Vrnitev v ospredje je edini zanesljiv trenutek za preverjanje nove
          // različice na iOS - ozadje itak ne izvaja kode (glej spec 7.7 za
          // sorodno omejitev pri Telegramu).
          void registration?.update()
        }
      })
    }
  } catch {
    // Virtualni modul ni na voljo - modul ostane popoln no-op.
  }
}

/** Uporabnik je potrdil "Osveži zdaj" - naloži čakajočo različico. */
export async function applyUpdate(): Promise<void> {
  if (updateSWFn) {
    await updateSWFn(true)
  }
}
