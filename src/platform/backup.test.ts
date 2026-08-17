import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { HGappDB, SCHEMA_VERSION } from '../db/schema.ts'
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
import { BackupError, exportBackup, importBackup, type BackupFile } from './backup.ts'

let dbCounter = 0
function freshDb(): HGappDB {
  dbCounter += 1
  return new HGappDB(`test-backup-${dbCounter}-${Date.now()}`)
}

function makePlayer(overrides: Partial<Player> = {}): Player {
  const now = Date.now()
  return {
    id: 'p1',
    name: 'Jaka',
    telegramUserId: null,
    telegramUsername: null,
    archived: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makeSession(overrides: Partial<Session> = {}): Session {
  const now = Date.now()
  return {
    id: 's1',
    name: null,
    location: 'Doma',
    status: 'aktivna',
    blindsLabel: null,
    scheduledAt: null,
    startedAt: now,
    endedAt: null,
    settledAt: null,
    hostPlayerId: 'p1',
    cashoutMode: 'eur',
    chipDenominations: [],
    defaultBuyInCents: 2000,
    settlementMode: 'blagajna',
    expenseEnabled: false,
    expenseTotalCents: 0,
    expenseSplitMethod: 'po_glavah',
    expensePaidByPlayerId: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makeSessionPlayer(overrides: Partial<SessionPlayer> = {}): SessionPlayer {
  const now = Date.now()
  return {
    id: 'sp1',
    sessionId: 's1',
    playerId: 'p1',
    seatOrder: 0,
    cashoutCents: null,
    cashoutChipCounts: null,
    paidOutCents: 0,
    leftAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makeBuyIn(overrides: Partial<BuyIn> = {}): BuyIn {
  const now = Date.now()
  return {
    id: 'b1',
    sessionId: 's1',
    playerId: 'p1',
    kind: 'buyin',
    amountCents: 2000,
    paymentMethod: 'gotovina',
    paidCents: 2000,
    confirmation: 'nepotrjen',
    rejectionReason: null,
    voided: false,
    note: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makeDiscrepancy(overrides: Partial<DiscrepancyRecord> = {}): DiscrepancyRecord {
  const now = Date.now()
  return {
    id: 'd1',
    sessionId: 's1',
    discrepancyCents: 0,
    method: 'enakomerno',
    assignedPlayerId: null,
    adjustmentsCents: {},
    note: null,
    createdAt: now,
    ...overrides,
  }
}

function makeSettlementLine(overrides: Partial<SettlementLine> = {}): SettlementLine {
  const now = Date.now()
  return {
    id: 'sl1',
    sessionId: 's1',
    fromPlayerId: null,
    toPlayerId: 'p1',
    amountCents: 2000,
    kind: 'iz_blagajne',
    manuallyReassigned: false,
    createdAt: now,
    ...overrides,
  }
}

function makeOpenDebt(overrides: Partial<OpenDebt> = {}): OpenDebt {
  const now = Date.now()
  return {
    id: 'od1',
    sessionId: 's1',
    settlementLineId: null,
    debtorPlayerId: 'p1',
    creditorPlayerId: null,
    originalCents: 1000,
    paidCents: 0,
    status: 'odprto',
    note: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makeDebtPayment(overrides: Partial<DebtPayment> = {}): DebtPayment {
  return {
    id: 'dp1',
    debtId: 'od1',
    amountCents: 500,
    paidAt: Date.now(),
    note: null,
    ...overrides,
  }
}

function makeAudit(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'a1',
    sessionId: 's1',
    entityTable: 'buyIns',
    entityId: 'b1',
    action: 'create',
    before: null,
    after: { amountCents: 2000 },
    versionAfter: 1,
    note: null,
    createdAt: Date.now(),
    ...overrides,
  }
}

function makeOutbox(overrides: Partial<OutboxItem> = {}): OutboxItem {
  const now = Date.now()
  return {
    id: 'o1',
    dedupKey: 'dedup-1',
    method: 'sendMessage',
    params: {},
    status: 'caka',
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
    relatedTable: null,
    relatedId: null,
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    id: 'singleton',
    telegramSeenGroups: [],
    telegramSeenUsers: [],
    hostPlayerId: 'p1',
    defaultBuyInCents: 2000,
    buyInPresetsCents: [1000, 2000, 5000],
    defaultChipDenominations: [],
    defaultSettlementMode: 'blagajna',
    telegramBotToken: 'SKRIVNI-TOKEN-NE-SME-VEN',
    telegramGroupChatId: '-100123',
    telegramOffset: 0,
    lastBackupAt: null,
    installGuardAcknowledgedAt: null,
    schemaVersion: SCHEMA_VERSION,
    ...overrides,
  }
}

/** Napolni bazo z eno vrstico v vsaki od 11 tabel. */
async function seedAllTables(db: HGappDB): Promise<void> {
  await db.players.add(makePlayer())
  await db.sessions.add(makeSession())
  await db.sessionPlayers.add(makeSessionPlayer())
  await db.buyIns.add(makeBuyIn())
  await db.discrepancies.add(makeDiscrepancy())
  await db.settlementLines.add(makeSettlementLine())
  await db.openDebts.add(makeOpenDebt())
  await db.debtPayments.add(makeDebtPayment())
  await db.audit.add(makeAudit())
  await db.outbox.add(makeOutbox())
  await db.settings.add(makeSettings())
}

describe('exportBackup', () => {
  it('izvozi vseh 11 tabel in NIKOLI ne vključi telegramBotToken', async () => {
    const db = freshDb()
    await seedAllTables(db)

    const file = await exportBackup(db)

    expect(file.format).toBe('hgapp-backup')
    expect(file.schemaVersion).toBe(SCHEMA_VERSION)
    expect(file.tables.players).toHaveLength(1)
    expect(file.tables.sessions).toHaveLength(1)
    expect(file.tables.sessionPlayers).toHaveLength(1)
    expect(file.tables.buyIns).toHaveLength(1)
    expect(file.tables.discrepancies).toHaveLength(1)
    expect(file.tables.settlementLines).toHaveLength(1)
    expect(file.tables.openDebts).toHaveLength(1)
    expect(file.tables.debtPayments).toHaveLength(1)
    expect(file.tables.audit).toHaveLength(1)
    expect(file.tables.outbox).toHaveLength(1)
    expect(file.tables.settings).toHaveLength(1)

    // Ne samo da je vrednost "prazna" - ključ sploh ne sme obstajati v serializirani obliki.
    const settingsRow = file.tables.settings[0] as unknown as Record<string, unknown>
    expect('telegramBotToken' in settingsRow).toBe(false)
    expect(JSON.stringify(file)).not.toContain('SKRIVNI-TOKEN-NE-SME-VEN')
  })
})

describe('importBackup - zamenjaj', () => {
  it('round-trip export -> import reproducira podatke v vseh tabelah', async () => {
    const sourceDb = freshDb()
    await seedAllTables(sourceDb)
    const file = await exportBackup(sourceDb)

    const targetDb = freshDb()
    const report = await importBackup(targetDb, file, 'zamenjaj')

    expect(await targetDb.players.toArray()).toHaveLength(1)
    expect(await targetDb.sessions.toArray()).toHaveLength(1)
    expect(await targetDb.sessionPlayers.toArray()).toHaveLength(1)
    expect(await targetDb.buyIns.toArray()).toHaveLength(1)
    expect(await targetDb.discrepancies.toArray()).toHaveLength(1)
    expect(await targetDb.settlementLines.toArray()).toHaveLength(1)
    expect(await targetDb.openDebts.toArray()).toHaveLength(1)
    expect(await targetDb.debtPayments.toArray()).toHaveLength(1)
    expect(await targetDb.audit.toArray()).toHaveLength(1)
    expect(await targetDb.outbox.toArray()).toHaveLength(1)
    expect(await targetDb.settings.toArray()).toHaveLength(1)

    const player = await targetDb.players.get('p1')
    expect(player).toEqual(await sourceDb.players.get('p1'))

    for (const summary of Object.values(report)) {
      expect(summary).toEqual({ added: 1, updated: 0, skipped: 0 })
    }
  })

  it('nikoli ne obnovi telegramBotToken iz datoteke - ohrani trenutni token naprave', async () => {
    const sourceDb = freshDb()
    await seedAllTables(sourceDb)
    const file = await exportBackup(sourceDb)

    const targetDb = freshDb()
    await targetDb.settings.add(makeSettings({ telegramBotToken: 'TOKEN-NA-NAPRAVI' }))

    await importBackup(targetDb, file, 'zamenjaj')

    const settings = await targetDb.settings.get('singleton')
    expect(settings?.telegramBotToken).toBe('TOKEN-NA-NAPRAVI')
  })

  it('zavrne novejši schemaVersion PREDEN se baza sploh dotakne', async () => {
    const db = freshDb()
    await db.players.add(makePlayer({ id: 'obstojeci' }))

    const futureFile: BackupFile = {
      format: 'hgapp-backup',
      schemaVersion: SCHEMA_VERSION + 1,
      exportedAt: Date.now(),
      tables: {
        players: [],
        sessions: [],
        sessionPlayers: [],
        buyIns: [],
        discrepancies: [],
        settlementLines: [],
        openDebts: [],
        debtPayments: [],
        audit: [],
        outbox: [],
        settings: [],
      },
    }

    await expect(importBackup(db, futureFile, 'zamenjaj')).rejects.toThrow(BackupError)

    // Baza ostane popolnoma nedotaknjena.
    expect(await db.players.toArray()).toHaveLength(1)
    expect((await db.players.get('obstojeci'))?.id).toBe('obstojeci')
  })

  it('zavrne datoteko z napačnim format poljem', async () => {
    const db = freshDb()
    await expect(importBackup(db, { format: 'nekaj-drugega' }, 'zamenjaj')).rejects.toThrow(BackupError)
  })
})

describe('importBackup - zdruzi', () => {
  it('obdrži vrstico z novejšim updatedAt in prepiše starejšo', async () => {
    const db = freshDb()
    const older = makePlayer({ id: 'p1', name: 'Star zapis', updatedAt: 1000 })
    await db.players.add(older)

    const newer = makePlayer({ id: 'p1', name: 'Nov zapis', updatedAt: 2000 })
    const file: BackupFile = {
      format: 'hgapp-backup',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: Date.now(),
      tables: {
        players: [newer],
        sessions: [],
        sessionPlayers: [],
        buyIns: [],
        discrepancies: [],
        settlementLines: [],
        openDebts: [],
        debtPayments: [],
        audit: [],
        outbox: [],
        settings: [],
      },
    }

    const report = await importBackup(db, file, 'zdruzi')

    const result = await db.players.get('p1')
    expect(result?.name).toBe('Nov zapis')
    expect(report.players).toEqual({ added: 0, updated: 1, skipped: 0 })
  })

  it('ne prepiše novejšega lokalnega zapisa s starejšim iz datoteke', async () => {
    const db = freshDb()
    const newerLocal = makePlayer({ id: 'p1', name: 'Novejši lokalni', updatedAt: 5000 })
    await db.players.add(newerLocal)

    const olderIncoming = makePlayer({ id: 'p1', name: 'Starejši iz datoteke', updatedAt: 1000 })
    const file: BackupFile = {
      format: 'hgapp-backup',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: Date.now(),
      tables: {
        players: [olderIncoming],
        sessions: [],
        sessionPlayers: [],
        buyIns: [],
        discrepancies: [],
        settlementLines: [],
        openDebts: [],
        debtPayments: [],
        audit: [],
        outbox: [],
        settings: [],
      },
    }

    const report = await importBackup(db, file, 'zdruzi')

    const result = await db.players.get('p1')
    expect(result?.name).toBe('Novejši lokalni')
    expect(report.players).toEqual({ added: 0, updated: 0, skipped: 1 })
  })

  it('doda zapis brez updatedAt (audit), samo če id še ne obstaja', async () => {
    const db = freshDb()
    await db.audit.add(makeAudit({ id: 'a1', note: 'obstoječi' }))

    const file: BackupFile = {
      format: 'hgapp-backup',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: Date.now(),
      tables: {
        players: [],
        sessions: [],
        sessionPlayers: [],
        buyIns: [],
        discrepancies: [],
        settlementLines: [],
        openDebts: [],
        debtPayments: [],
        audit: [makeAudit({ id: 'a1', note: 'iz datoteke - ne sme prepisati' }), makeAudit({ id: 'a2', note: 'nov' })],
        outbox: [],
        settings: [],
      },
    }

    const report = await importBackup(db, file, 'zdruzi')

    expect((await db.audit.get('a1'))?.note).toBe('obstoječi')
    expect((await db.audit.get('a2'))?.note).toBe('nov')
    expect(report.audit).toEqual({ added: 1, updated: 0, skipped: 1 })
  })

  it('pusti bazo nedotaknjeno, če je datoteka neveljavna', async () => {
    const db = freshDb()
    await db.players.add(makePlayer({ id: 'obstojeci' }))

    await expect(importBackup(db, { totally: 'not a backup' }, 'zdruzi')).rejects.toThrow(BackupError)
    expect(await db.players.toArray()).toHaveLength(1)
  })
})

describe('sveža baza brez podatkov', () => {
  let db: HGappDB
  beforeEach(() => {
    db = freshDb()
  })

  it('exportBackup na prazni bazi vrne prazne tabele brez napake', async () => {
    const file = await exportBackup(db)
    expect(file.tables.players).toEqual([])
    expect(file.tables.settings).toEqual([])
  })
})
