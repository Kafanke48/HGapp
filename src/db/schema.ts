import Dexie, { type Table } from 'dexie'
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
} from './types.ts'

export const SCHEMA_VERSION = 1

export class HGappDB extends Dexie {
  players!: Table<Player, string>
  sessions!: Table<Session, string>
  sessionPlayers!: Table<SessionPlayer, string>
  buyIns!: Table<BuyIn, string>
  discrepancies!: Table<DiscrepancyRecord, string>
  settlementLines!: Table<SettlementLine, string>
  openDebts!: Table<OpenDebt, string>
  debtPayments!: Table<DebtPayment, string>
  audit!: Table<AuditEntry, string>
  outbox!: Table<OutboxItem, string>
  settings!: Table<AppSettings, string>

  constructor(name = 'hgapp') {
    super(name)
    this.version(1).stores({
      players: 'id, name, archived, telegramUserId',
      sessions: 'id, status, startedAt, endedAt, settledAt, location',
      sessionPlayers: 'id, sessionId, playerId, [sessionId+playerId]',
      buyIns: 'id, sessionId, playerId, [sessionId+playerId], confirmation, paymentMethod, voided, createdAt',
      discrepancies: 'id, sessionId, createdAt',
      settlementLines: 'id, sessionId, fromPlayerId, toPlayerId, createdAt',
      openDebts: 'id, sessionId, debtorPlayerId, creditorPlayerId, status, createdAt',
      debtPayments: 'id, debtId, paidAt',
      audit: 'id, sessionId, entityTable, entityId, action, createdAt',
      outbox: 'id, &dedupKey, status, nextAttemptAt, [relatedTable+relatedId], createdAt',
      settings: 'id',
    })
  }
}

/** Edini primerek za aplikacijo. Testi si ustvarijo svojega z drugim imenom. */
export const db = new HGappDB()

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'singleton',
  hostPlayerId: null,
  defaultBuyInCents: 2000,
  buyInPresetsCents: [1000, 2000, 5000],
  defaultChipDenominations: [
    { label: 'bela', colorHex: '#f8fafc', cents: 10 },
    { label: 'rdeča', colorHex: '#ef4444', cents: 25 },
    { label: 'zelena', colorHex: '#22c55e', cents: 100 },
    { label: 'črna', colorHex: '#1e293b', cents: 500 },
  ],
  defaultSettlementMode: 'blagajna',
  telegramBotToken: null,
  telegramGroupChatId: null,
  telegramOffset: 0,
  telegramSeenGroups: [],
  lastBackupAt: null,
  installGuardAcknowledgedAt: null,
  schemaVersion: SCHEMA_VERSION,
}
