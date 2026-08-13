/**
 * `navigator.storage.persist()` in diagnostika porabe/kvote shrambe.
 *
 * POMEMBNO - prosim preberi, preden to kodo uporabiš kot "rešitev": klic
 * `persist()` je zgolj SEKUNDARNA varovalka. Brskalniki (vključno z iOS
 * Safarijem) lahko zahtevo kadarkoli tiho zavrnejo, jo kasneje prekličejo, ali
 * je sploh ne implementirajo. DEJANSKA zaščita pred WebKitovim 7-dnevnim
 * brisanjem neaktivne shrambe (glej specifikacijo 8.1) je namestitev aplikacije
 * na domači zaslon - glej `standalone.ts` / `storageRiskLevel()`. Uspešen
 * `persist()` ne pomeni, da namestitev na domači zaslon ni več potrebna.
 */

export interface PersistResult {
  /** Ali je brskalnik obljubil "persistent" shrambo (brez uporabnikovega dovoljenja jo lahko zavrne). */
  persisted: boolean
  /** Ali `navigator.storage.persist` sploh obstaja na tej platformi. */
  supported: boolean
}

export interface StorageEstimateLike {
  usageBytes: number | null
  quotaBytes: number | null
}

interface StorageManagerLike {
  persist?: () => Promise<boolean>
  persisted?: () => Promise<boolean>
  estimate?: () => Promise<{ usage?: number; quota?: number }>
}

/** Podmnožica `Navigator`, ki jo ta modul potrebuje. */
export interface StorageNavigatorLike {
  storage?: StorageManagerLike
}

function realNavigator(): StorageNavigatorLike {
  return typeof navigator !== 'undefined' ? (navigator as StorageNavigatorLike) : {}
}

/**
 * Zaprosi za trajno (persistent) shrambo. Nikoli ne vrže napake naprej -
 * klicna koda (UI) razliko med "ni podprto" in "zavrnjeno" obravnava enako:
 * uporabniku pokaže, naj namesti aplikacijo na domači zaslon.
 */
export async function requestPersistentStorage(
  nav: StorageNavigatorLike = realNavigator(),
): Promise<PersistResult> {
  const storage = nav.storage
  if (!storage?.persist) {
    return { persisted: false, supported: false }
  }
  try {
    const persisted = await storage.persist()
    return { persisted, supported: true }
  } catch {
    // Nekateri brskalniki lahko vržejo (npr. v privatnem načinu) - to ni usodno.
    return { persisted: false, supported: true }
  }
}

/** Diagnostični izpis porabe/kvote shrambe, za zaslon "Podatki in shramba" v UI. */
export async function getStorageEstimate(
  nav: StorageNavigatorLike = realNavigator(),
): Promise<StorageEstimateLike> {
  const storage = nav.storage
  if (!storage?.estimate) {
    return { usageBytes: null, quotaBytes: null }
  }
  try {
    const estimate = await storage.estimate()
    return {
      usageBytes: estimate.usage ?? null,
      quotaBytes: estimate.quota ?? null,
    }
  } catch {
    return { usageBytes: null, quotaBytes: null }
  }
}
