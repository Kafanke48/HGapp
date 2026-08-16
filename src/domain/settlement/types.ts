import type { Cents } from '../money.ts'

/**
 * Vhod v obračun za enega igralca.
 *
 * Denarni model (glej specifikacijo, razdelek 3):
 *   B = takenCents  — koliko žetonov je vzel (vsi buy-ini)
 *   P = paidCents   — koliko denarja je dejansko dal (gotovina + nakazilo; kredo = 0)
 *   C = cashoutCents — vrednost žetonov ob koncu
 *
 *   neto      = C − B
 *   izplačilo = (C − B) + P
 */
export interface PlayerInput {
  playerId: string
  /** B — vsota vseh nepreklicanih buy-inov v centih */
  takenCents: Cents
  /** P — dejansko plačano v centih */
  paidCents: Cents
  /** C — vrednost žetonov ob koncu v centih */
  cashoutCents: Cents
  /**
   * Koliko denarja je igralec ŽE dobil izplačano iz blagajne med sejo.
   *
   * Cash game: igralci prihajajo in odhajajo. Kdor odide sredi večera, denar
   * praviloma vzame takoj — in od tistega trenutka v blagajni ni več `Σ P`.
   * Brez tega člena bi kontrola blagajne od prve predčasne izplačitve naprej
   * kazala napačno vrednost.
   *
   * 0 pomeni, da igralec še ni dobil ničesar (običajno stanje).
   */
  paidOutCents: Cents
}

export type DiscrepancyMethod =
  | { method: 'enakomerno' }
  | { method: 'sorazmerno' }
  | { method: 'pripisi'; playerId: string }
  | { method: 'rocno'; adjustmentsCents: Record<string, Cents>; note: string }

export type ExpenseSplitMethod = 'po_glavah' | 'po_dobicku'

export interface ExpenseInput {
  totalCents: Cents
  method: ExpenseSplitMethod
  /** Kdo je strošek založil. Ta oseba plača tudi svoj delež in prejme celoten znesek nazaj. */
  paidByPlayerId: string
}

export type SettlementMode = 'blagajna' | 'p2p'

/** Popravek salda z razlogom. Vsak popravek se zapiše v revizijski dnevnik. */
export interface Adjustment {
  playerId: string
  deltaCents: Cents
  reason: string
}

/** Ena vrstica poravnalnega načrta. */
export interface Transfer {
  /** null pomeni "iz blagajne" */
  fromPlayerId: string | null
  /** null pomeni "v blagajno" */
  toPlayerId: string | null
  amountCents: Cents
  kind: 'direktno' | 'iz_blagajne' | 'v_blagajno'
}

export interface SettlementInput {
  players: readonly PlayerInput[]
  /** Obvezno, kadar je neskladje različno od 0. */
  discrepancy: DiscrepancyMethod | null
  expense: ExpenseInput | null
  mode: SettlementMode
  /**
   * Izbrani prejemnik za posameznega plačnika (playerId plačnika -> playerId prejemnika).
   * Upošteva se, kolikor daleč seže terjatev tega prejemnika; preostanek gre po
   * privzetem pravilu (največji dolg -> največji zmagovalec).
   */
  preferredCreditors?: Readonly<Record<string, string>>
}

export interface SettlementResult {
  /** Σ C − Σ B pred razrešitvijo. 0 pomeni, da se žetoni izidejo. */
  discrepancyCents: Cents
  /** neto_i = C_i − B_i po razrešitvi neskladja in po stroških. Vsota je 0. */
  netCents: Record<string, Cents>
  /**
   * Koliko igralcu še PRIPADA: neto_i + P_i − že izplačano_i.
   * Vsota je enaka vsebini blagajne. 0 pomeni, da je igralec že poravnan.
   */
  payoutCents: Record<string, Cents>
  /** Σ P − Σ že izplačano — koliko denarja naj bi bilo v blagajni zdaj. */
  boxCents: Cents
  transfers: Transfer[]
  discrepancyAdjustments: Adjustment[]
  expenseAdjustments: Adjustment[]
  /** Nastavljeno, ko je "po dobičku" padlo nazaj na "po glavah", ker ni bilo zmagovalcev. */
  expenseFellBackToHeadcount: boolean
  /** Opozorilo: izbran je P2P, v blagajni pa je denar. */
  p2pWithNonEmptyBox: boolean
}

export class ObracunNapaka extends Error {}
