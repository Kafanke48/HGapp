import type { Table } from 'dexie'
import type { HGappDB } from '../db/schema.ts'
import { SCHEMA_VERSION } from '../db/schema.ts'
import type {
  AppSettings,
  AuditEntry,
  BuyIn,
  DebtPayment,
  DiscrepancyRecord,
  OpenDebt,
  OutboxItem,
  Player,
  Session,
  SessionPlayer,
  SettlementLine,
} from '../db/types.ts'

/**
 * Poln izvoz/uvoz baze v eno JSON datoteko (spec 8.2).
 *
 * Datoteka je namenjena deljenju prek iOS "Share Sheet" v Files/iCloud Drive/
 * sporočila - zato NIKOLI ne sme vsebovati `telegramBotToken` (glej spodaj).
 */

/** Nastavitve, kot se pojavijo v datoteki varnostne kopije - BREZ bot tokena. */
export type ExportedSettings = Omit<AppSettings, 'telegramBotToken'>

export interface BackupTables {
  players: Player[]
  sessions: Session[]
  sessionPlayers: SessionPlayer[]
  buyIns: BuyIn[]
  discrepancies: DiscrepancyRecord[]
  settlementLines: SettlementLine[]
  openDebts: OpenDebt[]
  debtPayments: DebtPayment[]
  audit: AuditEntry[]
  outbox: OutboxItem[]
  settings: ExportedSettings[]
}

export interface BackupFile {
  format: 'hgapp-backup'
  schemaVersion: number
  exportedAt: number
  tables: BackupTables
}

/** Vrstni red ni pomemben za pravilnost, je pa fiksen zaradi determinizma poročila. */
const TABLE_NAMES = [
  'players',
  'sessions',
  'sessionPlayers',
  'buyIns',
  'discrepancies',
  'settlementLines',
  'openDebts',
  'debtPayments',
  'audit',
  'outbox',
  'settings',
] as const satisfies readonly (keyof BackupTables)[]

export class BackupError extends Error {}

// ---------------------------------------------------------------------------
// Izvoz
// ---------------------------------------------------------------------------

export async function exportBackup(db: HGappDB): Promise<BackupFile> {
  const [
    players,
    sessions,
    sessionPlayers,
    buyIns,
    discrepancies,
    settlementLines,
    openDebts,
    debtPayments,
    audit,
    outbox,
    settingsRows,
  ] = await Promise.all([
    db.players.toArray(),
    db.sessions.toArray(),
    db.sessionPlayers.toArray(),
    db.buyIns.toArray(),
    db.discrepancies.toArray(),
    db.settlementLines.toArray(),
    db.openDebts.toArray(),
    db.debtPayments.toArray(),
    db.audit.toArray(),
    db.outbox.toArray(),
    db.settings.toArray(),
  ])

  // VARNOST: `telegramBotToken` se NIKOLI ne sme znajti v izvoženi datoteki.
  // Datoteka gre prek iOS deljenja v iCloud/Files/sporočila - token bi lahko
  // pristal v napačnih rokah. Polje eksplicitno izpustimo (ne le nastavimo na
  // null), da je odsotnost vidna tudi v obliki (tipu) podatkov, ne samo v vrednosti.
  const settings: ExportedSettings[] = settingsRows.map(({ telegramBotToken: _telegramBotToken, ...rest }) => rest)

  return {
    format: 'hgapp-backup',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    tables: {
      players,
      sessions,
      sessionPlayers,
      buyIns,
      discrepancies,
      settlementLines,
      openDebts,
      debtPayments,
      audit,
      outbox,
      settings,
    },
  }
}

// ---------------------------------------------------------------------------
// Deljenje / prenos datoteke
// ---------------------------------------------------------------------------

export interface ShareResult {
  method: 'share' | 'download'
  /** True, kadar je uporabnik zaprl/preklical iOS "Share Sheet" - to je normalen izid. */
  cancelled: boolean
}

interface ShareableFile {
  name: string
  type: string
}

interface NavigatorWithShare {
  canShare?: (data?: { files?: ShareableFile[] }) => boolean
  share?: (data: { files?: File[] }) => Promise<void>
}

function backupFilename(exportedAt: number): string {
  const iso = new Date(exportedAt).toISOString().replace(/[:.]/g, '-')
  return `hgapp-backup-${iso}.json`
}

/**
 * Ponudi datoteko za shranjevanje. Na iOS uporabi `navigator.share` s
 * `files`, kar odpre "Save to Files" v Share Sheetu. Kjer `share`/`canShare`
 * z datotekami ni podprt (namizni brskalniki, stari iOS Safari), pade nazaj
 * na klasičen `<a download>` z blob URL-jem.
 *
 * Preklic deljenja (uporabnik zapre Share Sheet) sproži `AbortError` - to je
 * NORMALEN izid, ne napaka, zato ga NE vržemo naprej.
 */
export async function downloadOrShareBackup(
  file: BackupFile,
  deps: { nav?: NavigatorWithShare; doc?: Document } = {},
): Promise<ShareResult> {
  const nav = deps.nav ?? (typeof navigator !== 'undefined' ? (navigator as unknown as NavigatorWithShare) : undefined)
  const filename = backupFilename(file.exportedAt)
  const json = JSON.stringify(file, null, 2)
  const blob = new Blob([json], { type: 'application/json' })

  if (nav?.share && nav.canShare) {
    const shareFile = new File([blob], filename, { type: 'application/json' })
    if (nav.canShare({ files: [shareFile] })) {
      try {
        await nav.share({ files: [shareFile] })
        return { method: 'share', cancelled: false }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return { method: 'share', cancelled: true }
        }
        throw err
      }
    }
  }

  const doc = deps.doc ?? (typeof document !== 'undefined' ? document : undefined)
  if (doc) {
    const url = URL.createObjectURL(blob)
    const anchor = doc.createElement('a')
    anchor.href = url
    anchor.download = filename
    doc.body.appendChild(anchor)
    anchor.click()
    doc.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  }
  return { method: 'download', cancelled: false }
}

// ---------------------------------------------------------------------------
// Uvoz
// ---------------------------------------------------------------------------

export interface ImportSummary {
  added: number
  updated: number
  skipped: number
}

export type ImportReport = Record<keyof BackupTables, ImportSummary>

export type ImportMode = 'zamenjaj' | 'zdruzi'

/** Preveri obliko datoteke IN da schemaVersion ni novejši od aplikacije - PREDEN se dotaknemo baze. */
function validateBackupFile(json: unknown): BackupFile {
  if (typeof json !== 'object' || json === null) {
    throw new BackupError('Neveljavna datoteka varnostne kopije: vsebina ni objekt.')
  }
  const obj = json as Record<string, unknown>

  if (obj.format !== 'hgapp-backup') {
    throw new BackupError(
      `Neveljavna datoteka varnostne kopije: nepričakovan format "${String(obj.format)}".`,
    )
  }
  if (typeof obj.schemaVersion !== 'number' || !Number.isInteger(obj.schemaVersion)) {
    throw new BackupError('Neveljavna datoteka varnostne kopije: manjka schemaVersion.')
  }
  if (obj.schemaVersion > SCHEMA_VERSION) {
    throw new BackupError(
      `Datoteka je iz novejše različice aplikacije (schemaVersion ${obj.schemaVersion} > ${SCHEMA_VERSION} te aplikacije). Najprej posodobi aplikacijo.`,
    )
  }
  if (typeof obj.exportedAt !== 'number') {
    throw new BackupError('Neveljavna datoteka varnostne kopije: manjka exportedAt.')
  }
  if (typeof obj.tables !== 'object' || obj.tables === null) {
    throw new BackupError('Neveljavna datoteka varnostne kopije: manjka tables.')
  }
  const tables = obj.tables as Record<string, unknown>
  for (const name of TABLE_NAMES) {
    if (!Array.isArray(tables[name])) {
      throw new BackupError(`Neveljavna datoteka varnostne kopije: tabela "${name}" manjka ali ni seznam.`)
    }
  }

  return obj as unknown as BackupFile
}

/** "zamenjaj": tabelo v celoti počisti in zapiše vsebino datoteke. */
async function replaceTable<T>(table: Table<T, string>, rows: readonly T[]): Promise<ImportSummary> {
  await table.clear()
  if (rows.length > 0) {
    await table.bulkAdd(rows as T[])
  }
  return { added: rows.length, updated: 0, skipped: 0 }
}

interface HasId {
  id: string
}

interface HasUpdatedAt extends HasId {
  updatedAt: number
}

/** "zdruzi" za tabele z `updatedAt`: obdrži vrstico z novejšim `updatedAt`. */
async function mergeByUpdatedAt<T extends HasUpdatedAt>(
  table: Table<T, string>,
  rows: readonly T[],
): Promise<ImportSummary> {
  let added = 0
  let updated = 0
  let skipped = 0
  for (const row of rows) {
    const existing = await table.get(row.id)
    if (!existing) {
      await table.add(row)
      added += 1
    } else if (row.updatedAt > existing.updatedAt) {
      await table.put(row)
      updated += 1
    } else {
      skipped += 1
    }
  }
  return { added, updated, skipped }
}

/**
 * "zdruzi" za tabele BREZ `updatedAt` (audit, debtPayments, discrepancies,
 * settlementLines): dodaj, samo če id še ne obstaja. Brez časovnega žiga ni
 * osnove za odločitev "kaj je novejše", zato obstoječega zapisa NIKOLI ne
 * prepišemo - to je "nikoli tiho ne prepiši" iz specifikacije.
 */
async function mergeByIdOnly<T extends HasId>(table: Table<T, string>, rows: readonly T[]): Promise<ImportSummary> {
  let added = 0
  let skipped = 0
  for (const row of rows) {
    const existing = await table.get(row.id)
    if (!existing) {
      await table.add(row)
      added += 1
    } else {
      skipped += 1
    }
  }
  return { added, updated: 0, skipped }
}

async function importReplace(db: HGappDB, file: BackupFile, report: ImportReport): Promise<void> {
  // Trenutni token preberemo PREDEN počistimo tabelo nastavitev - v datoteki
  // ga ni, zato ga moramo ohraniti iz tega, kar je trenutno na napravi.
  const currentToken = (await db.settings.toArray())[0]?.telegramBotToken ?? null

  report.players = await replaceTable(db.players, file.tables.players)
  report.sessions = await replaceTable(db.sessions, file.tables.sessions)
  report.sessionPlayers = await replaceTable(db.sessionPlayers, file.tables.sessionPlayers)
  report.buyIns = await replaceTable(db.buyIns, file.tables.buyIns)
  report.discrepancies = await replaceTable(db.discrepancies, file.tables.discrepancies)
  report.settlementLines = await replaceTable(db.settlementLines, file.tables.settlementLines)
  report.openDebts = await replaceTable(db.openDebts, file.tables.openDebts)
  report.debtPayments = await replaceTable(db.debtPayments, file.tables.debtPayments)
  report.audit = await replaceTable(db.audit, file.tables.audit)
  report.outbox = await replaceTable(db.outbox, file.tables.outbox)

  await db.settings.clear()
  const settingsToWrite: AppSettings[] = file.tables.settings.map((s) => ({ ...s, telegramBotToken: currentToken }))
  if (settingsToWrite.length > 0) {
    await db.settings.bulkAdd(settingsToWrite)
  }
  report.settings = { added: settingsToWrite.length, updated: 0, skipped: 0 }
}

async function importMerge(db: HGappDB, file: BackupFile, report: ImportReport): Promise<void> {
  report.players = await mergeByUpdatedAt(db.players, file.tables.players)
  report.sessions = await mergeByUpdatedAt(db.sessions, file.tables.sessions)
  report.sessionPlayers = await mergeByUpdatedAt(db.sessionPlayers, file.tables.sessionPlayers)
  report.buyIns = await mergeByUpdatedAt(db.buyIns, file.tables.buyIns)
  report.discrepancies = await mergeByIdOnly(db.discrepancies, file.tables.discrepancies)
  report.settlementLines = await mergeByIdOnly(db.settlementLines, file.tables.settlementLines)
  report.openDebts = await mergeByUpdatedAt(db.openDebts, file.tables.openDebts)
  report.debtPayments = await mergeByIdOnly(db.debtPayments, file.tables.debtPayments)
  report.audit = await mergeByIdOnly(db.audit, file.tables.audit)
  report.outbox = await mergeByUpdatedAt(db.outbox, file.tables.outbox)

  // Nastavitve so singleton brez `updatedAt`, torej ni osnove za "kaj je
  // novejše". Da se držimo pravila "nikoli tiho ne prepiši", uvoz nastavitve
  // doda samo, če na napravi še ni nobenih; sicer trenutne nastavitve naprave
  // (vključno z bot tokenom, ki ga v datoteki itak ni) ostanejo nedotaknjene.
  const currentRows = await db.settings.toArray()
  const incoming = file.tables.settings[0]
  if (!incoming) {
    report.settings = { added: 0, updated: 0, skipped: 0 }
  } else if (currentRows.length === 0) {
    await db.settings.add({ ...incoming, telegramBotToken: null })
    report.settings = { added: 1, updated: 0, skipped: 0 }
  } else {
    report.settings = { added: 0, updated: 0, skipped: 1 }
  }
}

/**
 * Uvozi varnostno kopijo. Celoten uvoz teče v ENI Dexie transakciji, zato
 * napaka sredi uvoza pusti bazo nedotaknjeno (Dexie samodejno prekliče
 * transakcijo ob zavrnjeni obljubi znotraj nje).
 *
 * `telegramBotToken` se NIKOLI ne obnovi iz datoteke (v njej ga sploh ni) -
 * ohrani se, kar je trenutno nastavljeno na tej napravi.
 */
export async function importBackup(db: HGappDB, json: unknown, mode: ImportMode): Promise<ImportReport> {
  const file = validateBackupFile(json)

  const report = {} as ImportReport
  for (const name of TABLE_NAMES) {
    report[name] = { added: 0, updated: 0, skipped: 0 }
  }

  await db.transaction(
    'rw',
    [
      db.players,
      db.sessions,
      db.sessionPlayers,
      db.buyIns,
      db.discrepancies,
      db.settlementLines,
      db.openDebts,
      db.debtPayments,
      db.audit,
      db.outbox,
      db.settings,
    ],
    async () => {
      if (mode === 'zamenjaj') {
        await importReplace(db, file, report)
      } else {
        await importMerge(db, file, report)
      }
    },
  )

  return report
}
