import type { Table } from 'dexie'
import type { HGappDB } from './schema.ts'
import type { AuditAction, AuditEntry } from './types.ts'
import { newId, now } from './ids.ts'

/**
 * Imena tabel, kot so shranjena v `AuditEntry.entityTable`. Namerno se ujemajo
 * s poimenovanjem lastnosti na `HGappDB`, da `resolveTable` lahko dela brez
 * ročnega seznama izjem.
 */
export type EntityTableName =
  | 'players'
  | 'sessions'
  | 'sessionPlayers'
  | 'buyIns'
  | 'discrepancies'
  | 'settlementLines'
  | 'openDebts'
  | 'debtPayments'
  | 'outbox'
  | 'settings'

export class UndoConflictError extends Error {}

/**
 * NAJPOMEMBNEJŠA INVARIANTA V TEJ DATOTEKI:
 *
 * Posnetek stanja PRED spremembo (`before`) mora biti globok klon
 * (`structuredClone`), narejen TAKOJ po branju iz baze in PRED kakršnokoli
 * mutacijo objekta. Če bi shranili živo referenco na obstoječi objekt, bi jo
 * naslednja sprememba (npr. `existing.version += 1` ali spread v nov objekt,
 * ki si še vedno deli gnezdene reference) tiho spremenila tudi v "before"
 * posnetku, ki je bil menda zaklenjen v preteklost. Revizijski zapis bi
 * potem lagal, `revertAuditEntry` pa bi obnovil napačno (že spremenjeno)
 * stanje, ne da bi kdorkoli to opazil.
 *
 * Zato vsak repozitorij takoj po `db.<tabela>.get(id)` pokliče `snapshot()`,
 * še preden karkoli izračuna ali sestavi nov objekt za zapis.
 */
export function snapshot<T>(value: T): T {
  return structuredClone(value)
}

export interface AuditRecordInput {
  sessionId: string | null
  entityTable: EntityTableName
  entityId: string
  action: AuditAction
  /** Globok posnetek stanja pred spremembo. null ob ustvarjanju. Klic mora iti skozi `snapshot()`. */
  before: unknown | null
  /** Globok posnetek stanja po spremembi. null ob (trajnem) brisanju. */
  after: unknown | null
  /** entity.version po spremembi, ali null za entitete brez polja `version`. */
  versionAfter: number | null
  note?: string | null
}

export interface AuditRecorder {
  /** Doda vrstico v revizijski dnevnik. Dejansko se zapiše šele ob zaključku transakcije. */
  record(entry: AuditRecordInput): void
}

/**
 * Izvede `fn` znotraj ENE Dexie transakcije, ki poleg podanih tabel vedno
 * vključuje tudi `db.audit`. Vsaka sprememba entitete MORA biti spremljana
 * z vsaj enim klicem `audit.record(...)` znotraj iste transakcije — tako
 * sprememba podatkov in njen revizijski zapis ali oba uspeta, ali oba
 * propadeta (atomarnost).
 */
export async function withAudit<T>(
  db: HGappDB,
  tables: ReadonlyArray<Table<any, string>>,
  fn: (audit: AuditRecorder) => Promise<T> | T,
): Promise<T> {
  const allTables = tables.includes(db.audit) ? [...tables] : [...tables, db.audit]
  return db.transaction('rw', allTables, async () => {
    const pending: AuditEntry[] = []
    const recorder: AuditRecorder = {
      record(entry) {
        pending.push({
          id: newId(),
          sessionId: entry.sessionId,
          entityTable: entry.entityTable,
          entityId: entry.entityId,
          action: entry.action,
          before: entry.before,
          after: entry.after,
          versionAfter: entry.versionAfter,
          note: entry.note ?? null,
          createdAt: now(),
        })
      },
    }
    const result = await fn(recorder)
    // Vsi audit vpisi se zapišejo šele tu, na koncu iste transakcije — če `fn`
    // vrže napako prej, se transakcija razveljavi in noben vpis ne obstane.
    if (pending.length > 0) {
      await db.audit.bulkAdd(pending)
    }
    return result
  })
}

function resolveTable(db: HGappDB, entityTable: string): Table<any, string> {
  switch (entityTable as EntityTableName) {
    case 'players':
      return db.players
    case 'sessions':
      return db.sessions
    case 'sessionPlayers':
      return db.sessionPlayers
    case 'buyIns':
      return db.buyIns
    case 'discrepancies':
      return db.discrepancies
    case 'settlementLines':
      return db.settlementLines
    case 'openDebts':
      return db.openDebts
    case 'debtPayments':
      return db.debtPayments
    case 'outbox':
      return db.outbox
    case 'settings':
      return db.settings
    default:
      throw new Error(`Neznana tabela v revizijskem zapisu: ${entityTable}`)
  }
}

/**
 * Razveljavi eno vrstico revizijskega dnevnika.
 *
 * Undo NIKOLI ne briše ali spreminja izvirnega zapisa — zgodovina je
 * append-only. Namesto tega zapiše NOV vpis z `action: 'undo'`, ki je
 * sam po sebi nasproten vpis izvirni spremembi.
 *
 * Zaščita: če se je živa vrstica od takrat spremenila (njena `version` ni
 * več enaka `entry.versionAfter`), bi slepo obnavljanje `before` stanja
 * tiho povozilo novejše podatke. V tem primeru vržemo `UndoConflictError`
 * namesto da bi tvegali izgubo podatkov.
 */
export async function revertAuditEntry(db: HGappDB, auditEntryId: string): Promise<void> {
  return withAudit(
    db,
    [db.players, db.sessions, db.sessionPlayers, db.buyIns, db.discrepancies, db.settlementLines, db.openDebts, db.debtPayments, db.outbox, db.settings],
    async (audit) => {
      const entry = await db.audit.get(auditEntryId)
      if (!entry) {
        throw new Error(`Revizijski zapis ${auditEntryId} ne obstaja.`)
      }

      const table = resolveTable(db, entry.entityTable)
      const live = await table.get(entry.entityId)
      const liveVersion = (live as { version?: number } | undefined)?.version

      // Entitete brez polja `version` (npr. DiscrepancyRecord, DebtPayment) nimajo
      // zaščite pred konfliktom — zanje je `versionAfter` shranjen kot null.
      if (entry.versionAfter !== null) {
        if (live === undefined || liveVersion !== entry.versionAfter) {
          throw new UndoConflictError(
            `Zapisa ni mogoče razveljaviti: vrstica '${entry.entityTable}/${entry.entityId}' se je od takrat spremenila ` +
              `(pričakovana verzija ${entry.versionAfter}, trenutna ${live === undefined ? 'vrstica ne obstaja' : liveVersion}). ` +
              `Razveljavitev bi povozila novejše podatke.`,
          )
        }
      }

      let after: unknown
      if (entry.action === 'create') {
        // Nasprotje ustvarjanja je brisanje te (in samo te) vrstice. Zgodovina
        // ostane nedotaknjena v `audit` tabeli — to ni splošno "trdo brisanje",
        // ampak namerna izjema za razveljavitev napake, ki je bila pravkar narejena.
        if (live !== undefined) {
          await table.delete(entry.entityId)
        }
        after = null
      } else {
        if (live === undefined) {
          throw new UndoConflictError(
            `Zapisa ni mogoče razveljaviti: vrstica '${entry.entityTable}/${entry.entityId}' ne obstaja več.`,
          )
        }
        // `update` in `void` obnovita celotno stanje "before". Ker je bila
        // zaščita zgoraj uspešna, se od takrat ni nič spremenilo, zato je
        // obnovitev varna. Verzija in updatedAt se kljub temu premakneta
        // naprej — undo je sam nova mutacija, ne vrnitev časa.
        const restored = snapshot(entry.before) as Record<string, unknown>
        const bumped: Record<string, unknown> = { ...restored }
        if (typeof liveVersion === 'number') {
          bumped['version'] = liveVersion + 1
        }
        if (typeof (live as { updatedAt?: number }).updatedAt === 'number') {
          bumped['updatedAt'] = now()
        }
        await table.put(bumped)
        after = bumped
      }

      audit.record({
        sessionId: entry.sessionId,
        entityTable: entry.entityTable as EntityTableName,
        entityId: entry.entityId,
        action: 'undo',
        before: entry.after,
        after,
        versionAfter:
          after !== null && typeof (after as { version?: unknown }).version === 'number'
            ? ((after as { version: number }).version)
            : null,
        note: `Razveljavitev zapisa ${entry.id}`,
      })
    },
  )
}
