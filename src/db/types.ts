import type { Cents } from '../domain/money.ts'
import type { ExpenseSplitMethod, SettlementMode } from '../domain/settlement/types.ts'

/**
 * Oblike zapisov v IndexedDB.
 *
 * Pravila:
 *  - Vsako denarno polje ima končnico `Cents`. Nikoli `amount`, `total`, `value`.
 *  - Časi so epoch milisekunde (number), nikoli Date — zaradi izvoza v JSON.
 *  - Vrednosti enumov so brez šumnikov: to so shranjene vrednosti, ne besedilo za prikaz.
 *    Slovenske oznake s šumniki so stvar vmesnika.
 *  - Nič se ne briše na trdo. Brisanje je `voided` oz. `archived`.
 */

export type SessionStatus = 'nacrtovana' | 'aktivna' | 'zakljucena' | 'poravnana'
export type PaymentMethod = 'gotovina' | 'nakazilo' | 'kredo'
export type ConfirmationStatus = 'nepotrjen' | 'potrjen' | 'zavrnjen'
export type BuyInKind = 'buyin' | 'rebuy' | 'addon'
export type CashoutMode = 'eur' | 'zetoni'
export type DebtStatus = 'odprto' | 'delno' | 'placano'

export interface Player {
  id: string
  name: string
  telegramUserId: string | null
  telegramUsername: string | null
  archived: boolean
  createdAt: number
  updatedAt: number
}

/** Barva žetona z vrednostjo, npr. { label: 'rdeča', cents: 25 } */
export interface ChipDenomination {
  label: string
  colorHex: string
  cents: Cents
}

export interface Session {
  id: string
  name: string | null
  location: string | null
  status: SessionStatus
  /** Poljubna oznaka limitov, npr. "0,10/0,25". Zgolj informativna — obračun šteje denar, ne blindov. */
  blindsLabel: string | null
  scheduledAt: number | null
  startedAt: number | null
  endedAt: number | null
  settledAt: number | null
  /** Kdo drži blagajno. */
  hostPlayerId: string | null
  cashoutMode: CashoutMode
  chipDenominations: ChipDenomination[]
  defaultBuyInCents: Cents
  settlementMode: SettlementMode
  expenseEnabled: boolean
  expenseTotalCents: Cents
  expenseSplitMethod: ExpenseSplitMethod
  expensePaidByPlayerId: string | null
  version: number
  createdAt: number
  updatedAt: number
}

export interface SessionPlayer {
  id: string
  sessionId: string
  playerId: string
  seatOrder: number
  /** C — končna vrednost žetonov. null pomeni "še ni vpisano". */
  cashoutCents: Cents | null
  /**
   * Koliko denarja je igralec že dobil izplačano iz blagajne MED sejo.
   *
   * Cash game: igralci prihajajo in odhajajo. Kdor odide sredi večera, denar
   * praviloma vzame takoj, zato v blagajni od tistega trenutka ni več `Σ P`.
   * 0 je običajno stanje. Stari zapisi tega polja nimajo — beri z `?? 0`.
   */
  paidOutCents: Cents
  /** Kdaj je igralec zapustil mizo. null pomeni, da še igra. */
  leftAt: number | null
  /** Surov vnos po barvah, kadar je cashoutMode 'zetoni'. Hranimo zaradi revizije. */
  cashoutChipCounts: Record<string, number> | null
  version: number
  createdAt: number
  updatedAt: number
}

export interface BuyIn {
  id: string
  sessionId: string
  playerId: string
  kind: BuyInKind
  /** Prispevek k B — koliko žetonov je vzel. */
  amountCents: Cents
  paymentMethod: PaymentMethod
  /**
   * Prispevek k P — koliko denarja je s tem dejansko dal.
   * Izpeljano ob zapisu: gotovina/nakazilo -> amountCents, kredo -> 0.
   * Shranjeno eksplicitno, da je invarianta blagajne revizijsko preverljiva.
   */
  paidCents: Cents
  confirmation: ConfirmationStatus
  rejectionReason: string | null
  /** Preklican vnos (undo). Ne šteje nikamor, a ostane v zgodovini. */
  voided: boolean
  note: string | null
  version: number
  createdAt: number
  updatedAt: number
}

export interface DiscrepancyRecord {
  id: string
  sessionId: string
  /** Σ C − Σ B pred razrešitvijo. */
  discrepancyCents: Cents
  method: 'enakomerno' | 'sorazmerno' | 'pripisi' | 'rocno'
  assignedPlayerId: string | null
  adjustmentsCents: Record<string, Cents>
  note: string | null
  createdAt: number
}

export interface SettlementLine {
  id: string
  sessionId: string
  fromPlayerId: string | null
  toPlayerId: string | null
  amountCents: Cents
  kind: 'direktno' | 'iz_blagajne' | 'v_blagajno'
  /** Ali je bil prejemnik ročno spremenjen glede na predlog. */
  manuallyReassigned: boolean
  createdAt: number
}

export interface OpenDebt {
  id: string
  sessionId: string
  settlementLineId: string | null
  debtorPlayerId: string
  creditorPlayerId: string | null
  originalCents: Cents
  paidCents: Cents
  status: DebtStatus
  note: string | null
  version: number
  createdAt: number
  updatedAt: number
}

export interface DebtPayment {
  id: string
  debtId: string
  amountCents: Cents
  paidAt: number
  note: string | null
}

export type AuditAction =
  | 'create'
  | 'update'
  | 'void'
  | 'undo'
  | 'status'
  | 'settle'
  | 'discrepancy'
  | 'import'
  | 'export'

export interface AuditEntry {
  id: string
  sessionId: string | null
  entityTable: string
  entityId: string
  action: AuditAction
  /** Globok posnetek pred spremembo. null ob ustvarjanju. */
  before: unknown | null
  /** Globok posnetek po spremembi. null ob brisanju. */
  after: unknown | null
  /** Ujema se z entity.version po spremembi. Ščiti undo pred zastarelim razveljavljanjem. */
  versionAfter: number | null
  note: string | null
  createdAt: number
}

export type OutboxStatus = 'caka' | 'poslano' | 'napaka'

export interface OutboxItem {
  id: string
  /** Ključ proti podvajanju. Isto sporočilo se nikoli ne pošlje dvakrat. */
  dedupKey: string
  method: string
  params: Record<string, unknown>
  status: OutboxStatus
  attempts: number
  nextAttemptAt: number
  lastError: string | null
  relatedTable: string | null
  relatedId: string | null
  expiresAt: number | null
  createdAt: number
  updatedAt: number
}

export interface AppSettings {
  id: 'singleton'
  hostPlayerId: string | null
  defaultBuyInCents: Cents
  buyInPresetsCents: Cents[]
  defaultChipDenominations: ChipDenomination[]
  defaultSettlementMode: SettlementMode
  telegramBotToken: string | null
  telegramGroupChatId: string | null
  /** Zadnji obdelan update_id iz getUpdates. */
  telegramOffset: number
  lastBackupAt: number | null
  installGuardAcknowledgedAt: number | null
  schemaVersion: number
}
