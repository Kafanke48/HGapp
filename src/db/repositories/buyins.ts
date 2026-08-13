import type { HGappDB } from '../schema.ts'
import type { BuyIn, BuyInKind, ConfirmationStatus, PaymentMethod } from '../types.ts'
import type { Cents } from '../../domain/money.ts'
import { newId, now } from '../ids.ts'
import { snapshot, withAudit } from '../audit.ts'

/**
 * Izpelje P (dejansko plačano) iz načina vplačila. To je EDINO mesto v
 * celotni aplikaciji, kjer se ta izpeljava izvede — od nje je odvisna
 * invarianta "V blagajni naj bo: Σ P". Če bi jo kdo podvojil drugje in eno
 * kopijo pozabil posodobiti (npr. ob dodajanju novega načina vplačila),
 * bi blagajna tiho prenehala držati.
 */
export function derivePaidCents(paymentMethod: PaymentMethod, amountCents: Cents): Cents {
  switch (paymentMethod) {
    case 'gotovina':
    case 'nakazilo':
      return amountCents
    case 'kredo':
      return 0
  }
}

export interface CreateBuyInInput {
  sessionId: string
  playerId: string
  kind?: BuyInKind
  amountCents: Cents
  paymentMethod: PaymentMethod
  note?: string | null
}

export async function createBuyIn(db: HGappDB, input: CreateBuyInInput): Promise<BuyIn> {
  return withAudit(db, [db.buyIns], async (audit) => {
    const timestamp = now()
    const buyIn: BuyIn = {
      id: newId(),
      sessionId: input.sessionId,
      playerId: input.playerId,
      kind: input.kind ?? 'buyin',
      amountCents: input.amountCents,
      paymentMethod: input.paymentMethod,
      paidCents: derivePaidCents(input.paymentMethod, input.amountCents),
      confirmation: 'nepotrjen',
      rejectionReason: null,
      voided: false,
      note: input.note ?? null,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.buyIns.add(buyIn)
    audit.record({
      sessionId: input.sessionId,
      entityTable: 'buyIns',
      entityId: buyIn.id,
      action: 'create',
      before: null,
      after: snapshot(buyIn),
      versionAfter: buyIn.version,
    })
    return buyIn
  })
}

/** Preklic buy-ina. Nikoli trdo brisanje — vrstica ostane, a ne šteje več v izračune. */
export async function voidBuyIn(db: HGappDB, id: string): Promise<BuyIn> {
  return withAudit(db, [db.buyIns], async (audit) => {
    const existing = await db.buyIns.get(id)
    if (!existing) throw new Error(`Buy-in ${id} ne obstaja.`)
    // KLJUČNO: posnetek pred spremembo, preden karkoli mutiramo (glej audit.ts)
    const before = snapshot(existing)
    if (existing.voided) return existing // idempotentno — že preklican

    const updated: BuyIn = { ...existing, voided: true, version: existing.version + 1, updatedAt: now() }
    await db.buyIns.put(updated)
    audit.record({
      sessionId: existing.sessionId,
      entityTable: 'buyIns',
      entityId: id,
      action: 'void',
      before,
      after: snapshot(updated),
      versionAfter: updated.version,
    })
    return updated
  })
}

export async function setConfirmation(
  db: HGappDB,
  id: string,
  status: ConfirmationStatus,
  reason?: string | null,
): Promise<BuyIn> {
  return withAudit(db, [db.buyIns], async (audit) => {
    const existing = await db.buyIns.get(id)
    if (!existing) throw new Error(`Buy-in ${id} ne obstaja.`)
    const before = snapshot(existing)

    // Zavrnitev NE spremeni tiho izračuna (glej sessionTotals) — dvigne le zastavico
    // za gostitelja. Razlog se pripne k zapisu, ostalo ostane nedotaknjeno.
    const updated: BuyIn = {
      ...existing,
      confirmation: status,
      rejectionReason: status === 'zavrnjen' ? (reason ?? null) : null,
      version: existing.version + 1,
      updatedAt: now(),
    }
    await db.buyIns.put(updated)
    audit.record({
      sessionId: existing.sessionId,
      entityTable: 'buyIns',
      entityId: id,
      action: 'update',
      before,
      after: snapshot(updated),
      versionAfter: updated.version,
    })
    return updated
  })
}

export interface SessionTotals {
  /** B in P na igralca, seštevana čez NE-preklicane (voided=false) buy-ine. */
  perPlayer: Record<string, { takenCents: Cents; paidCents: Cents }>
  /** Σ paidCents čez vse igralce — "V blagajni naj bo: X €". */
  boxCents: Cents
}

/**
 * Vsote za prikaz kontrole blagajne med igro.
 *
 * Preklicani (voided) buy-ini ne štejejo nikamor — undo jih je razveljavil.
 * Zavrnjeni (`zavrnjen`) buy-ini PA štejejo normalno: zavrnitev je le
 * opozorilo za gostitelja, nikoli tiha sprememba matematike (glej
 * specifikacijo, razdelek 7.5). Filtriramo torej izključno po `voided`,
 * nikoli po `confirmation`.
 */
export async function sessionTotals(db: HGappDB, sessionId: string): Promise<SessionTotals> {
  const buyIns = await db.buyIns.where('sessionId').equals(sessionId).toArray()
  const perPlayer: Record<string, { takenCents: Cents; paidCents: Cents }> = {}
  let boxCents = 0

  for (const buyIn of buyIns) {
    if (buyIn.voided) continue
    const bucket = perPlayer[buyIn.playerId] ?? { takenCents: 0, paidCents: 0 }
    bucket.takenCents += buyIn.amountCents
    bucket.paidCents += buyIn.paidCents
    perPlayer[buyIn.playerId] = bucket
    boxCents += buyIn.paidCents
  }

  return { perPlayer, boxCents }
}

export async function listBuyIns(db: HGappDB, sessionId: string): Promise<BuyIn[]> {
  return db.buyIns.where('sessionId').equals(sessionId).toArray()
}
