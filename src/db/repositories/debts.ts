import type { HGappDB } from '../schema.ts'
import type { DebtPayment, DebtStatus, OpenDebt } from '../types.ts'
import type { Cents } from '../../domain/money.ts'
import { newId, now } from '../ids.ts'
import { snapshot, withAudit } from '../audit.ts'

function statusFor(originalCents: Cents, paidCents: Cents): DebtStatus {
  if (paidCents <= 0) return 'odprto'
  if (paidCents >= originalCents) return 'placano'
  return 'delno'
}

/**
 * Delno plačilo dolga. Podpira večkratna delna plačila (odprto -> delno ->
 * plačano). Preplačilo in ne-pozitiven znesek sta napaka — evidenca dolgov
 * ne sme dovoliti, da bi nekdo "dolgoval" negativen znesek.
 */
export async function recordPayment(db: HGappDB, debtId: string, amountCents: Cents): Promise<OpenDebt> {
  return withAudit(db, [db.openDebts, db.debtPayments], async (audit) => {
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new Error(`Znesek plačila mora biti pozitivno celo število centov, dobil ${amountCents}.`)
    }

    const existing = await db.openDebts.get(debtId)
    if (!existing) throw new Error(`Dolg ${debtId} ne obstaja.`)
    // KLJUČNO: posnetek pred spremembo, preden karkoli mutiramo (glej audit.ts)
    const before = snapshot(existing)

    const remaining = existing.originalCents - existing.paidCents
    if (amountCents > remaining) {
      throw new Error(
        `Preplačilo: dolg ${debtId} ima še ${remaining} centov odprtih, poskus plačila ${amountCents} centov.`,
      )
    }

    const newPaidCents = existing.paidCents + amountCents
    const updated: OpenDebt = {
      ...existing,
      paidCents: newPaidCents,
      status: statusFor(existing.originalCents, newPaidCents),
      version: existing.version + 1,
      updatedAt: now(),
    }
    await db.openDebts.put(updated)
    audit.record({
      sessionId: existing.sessionId,
      entityTable: 'openDebts',
      entityId: debtId,
      action: 'update',
      before,
      after: snapshot(updated),
      versionAfter: updated.version,
    })

    const payment: DebtPayment = {
      id: newId(),
      debtId,
      amountCents,
      paidAt: now(),
      note: null,
    }
    await db.debtPayments.add(payment)
    audit.record({
      sessionId: existing.sessionId,
      entityTable: 'debtPayments',
      entityId: payment.id,
      action: 'create',
      before: null,
      after: snapshot(payment),
      versionAfter: null,
    })

    return updated
  })
}

/** Vsi neporavnani (odprto ali delno plačani) dolgovi, ne glede na sejo. */
export async function listOpenDebts(db: HGappDB): Promise<OpenDebt[]> {
  return db.openDebts.where('status').anyOf(['odprto', 'delno']).toArray()
}

export async function listDebtsForSession(db: HGappDB, sessionId: string): Promise<OpenDebt[]> {
  return db.openDebts.where('sessionId').equals(sessionId).toArray()
}

export async function listPaymentsForDebt(db: HGappDB, debtId: string): Promise<DebtPayment[]> {
  return db.debtPayments.where('debtId').equals(debtId).toArray()
}
