/**
 * Tanek ovoj okrog globalnih generatorjev id-jev in časa.
 *
 * Zakaj: če bi repozitoriji klicali `crypto.randomUUID()` in `Date.now()`
 * neposredno, jih testi ne bi mogli zamenjati s predvidljivimi vrednostmi
 * (npr. za preverjanje vrstnega reda revizijskih zapisov). Vsa koda pod
 * `src/db/` MORA klicati ti dve funkciji, nikoli globala neposredno.
 */

export function newId(): string {
  return crypto.randomUUID()
}

export function now(): number {
  return Date.now()
}
