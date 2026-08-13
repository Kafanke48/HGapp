/**
 * Zbirna (barrel) datoteka za platformsko plast (spec, razdelek 10:
 * `platform/` - PWA, zaznava namestitve, varnostne kopije).
 *
 * Brez Reacta - UI plast uvaža od tod in stvari ovije v komponente/hooke sama.
 */

export * from './standalone.ts'
export * from './storage.ts'
export * from './updates.ts'
export * from './backup.ts'
export * from './wakeLock.ts'
