/**
 * Vsa besedila sporočil za Telegram — v slovenščini, kot čiste funkcije brez
 * stranskih učinkov. Nič tu ne dostopa do baze ali omrežja, zato je to
 * najlažje testiran del `telegram/` modula.
 *
 * Sporočila so namerno kratka — pristanejo kot obvestilo na telefonu.
 */
import { formatEur, formatEurSigned, type Cents } from '../domain/money.ts'
import type { BuyInKind, PaymentMethod } from '../db/types.ts'

/**
 * Slovenščina loči ednino/dvojino/(tro/štiri)množino/množino po ostanku pri
 * deljenju s 100 (za števila nad 100 velja isto pravilo kot za zadnji dve
 * števki, npr. 101 je "ednina"). `forms` = [ednina, dvojina, 3–4, 5+].
 */
function slovenianCount(n: number, forms: readonly [string, string, string, string]): string {
  const mod = n % 100
  if (mod === 1) return forms[0]
  if (mod === 2) return forms[1]
  if (mod === 3 || mod === 4) return forms[2]
  return forms[3]
}

const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  gotovina: 'gotovina',
  nakazilo: 'nakazilo',
  kredo: 'kredo',
}

/** Pokerski izrazi ostanejo v angleščini (glej pravila copyja). */
const BUY_IN_KIND_LABEL: Record<BuyInKind, string> = {
  buyin: 'buy-in',
  rebuy: 'rebuy',
  addon: 'add-on',
}

/** Obvestilo v skupino ob začetku seje. */
export function formatSessionStarted(session: { name: string | null; location: string | null }): string {
  const parts: string[] = ['🎲 Seja se je začela.']
  if (session.name) parts.push(`Ime: ${session.name}.`)
  if (session.location) parts.push(`Lokacija: ${session.location}.`)
  return parts.join(' ')
}

export interface StandingRow {
  name: string
  takenCents: Cents
  paidCents: Cents
}

/** Vmesno stanje na zahtevo (`/stanje` ali ročni gumb) — nikoli samodejno. */
export function formatCurrentStandings(rows: readonly StandingRow[], boxCents: Cents): string {
  const lines = rows.map((r) => `${r.name}: vzel ${formatEur(r.takenCents)}, plačal ${formatEur(r.paidCents)}`)
  return ['📊 Trenutno stanje:', ...lines, '', `V blagajni naj bo: ${formatEur(boxCents)}`].join('\n')
}

export interface FinalStandingRow {
  name: string
  netCents: Cents
  payoutCents: Cents
}

export interface SettlementTransferRow {
  /** null pomeni "iz blagajne" */
  fromName: string | null
  /** null pomeni "v blagajno" */
  toName: string | null
  amountCents: Cents
}

/** Končna lestvica s poravnalnim načrtom — glavno sporočilo ob zaključku seje. */
export function formatFinalStandings(
  rows: readonly FinalStandingRow[],
  transfers: readonly SettlementTransferRow[],
  boxCents: Cents,
): string {
  const standingLines = rows.map((r) => `${r.name}: neto ${formatEurSigned(r.netCents)}, izplačilo ${formatEurSigned(r.payoutCents)}`)
  const transferLines = transfers.map((t) => {
    const from = t.fromName ?? 'blagajna'
    const to = t.toName ?? 'blagajna'
    return `${from} → ${to}: ${formatEur(t.amountCents)}`
  })
  return [
    '🏁 Seja je zaključena.',
    '',
    'Lestvica:',
    ...standingLines,
    '',
    'Poravnalni načrt:',
    ...(transferLines.length > 0 ? transferLines : ['(brez prenosov — vsi so poravnani)']),
    '',
    `V blagajni je bilo: ${formatEur(boxCents)}`,
  ].join('\n')
}

export interface OpenDebtRow {
  debtorName: string
  /** null pomeni "blagajna" (dolg do hosta/blagajne). */
  creditorName: string | null
  remainingCents: Cents
}

/** Opomnik za odprte dolgove (ni samodejno vezan na novo sejo — glej spec 5). */
export function formatOpenDebtReminder(debts: readonly OpenDebtRow[]): string {
  if (debts.length === 0) return 'Ni odprtih dolgov.'
  const noun = slovenianCount(debts.length, ['odprt dolg', 'odprta dolgova', 'odprti dolgovi', 'odprtih dolgov'])
  const lines = debts.map((d) => {
    const to = d.creditorName ?? 'blagajna'
    return `${d.debtorName} → ${to}: ${formatEur(d.remainingCents)}`
  })
  return [`💸 Imaš ${debts.length} ${noun}:`, ...lines].join('\n')
}

/** Zasebno potrditveno vprašanje ob buy-inu (glej spec 7.5). Gumbi se dodajo v `confirmations.ts`. */
export function formatBuyInConfirmationPrompt(amountCents: Cents, paymentMethod: PaymentMethod): string {
  return `Zabeležen je tvoj buy-in ${formatEur(amountCents)} (${PAYMENT_METHOD_LABEL[paymentMethod]}). Potrdi?`
}

/**
 * Objava buy-ina v SKUPINO (ne zasebno — to je `formatBuyInConfirmationPrompt`).
 * Lastnikova izrecna zahteva po realni rabi: prej je buy-in proizvedel samo
 * zasebno DM potrditev igralcu, skupina pa ni izvedela nič.
 *
 * Ista funkcija pokriva tako nov buy-in kot njegov preklic/popravek (`action`),
 * da ostane ena sama nova formatirna funkcija v tej datoteki (glej obseg
 * naloge) — klicatelj izbere ustrezen `dedupKey`, izpeljan iz ID-ja buy-ina,
 * da se isto stanje nikoli ne objavi dvakrat.
 */
export function formatBuyInPosted(
  action: 'zabelezen' | 'preklican',
  playerName: string,
  kind: BuyInKind,
  amountCents: Cents,
  paymentMethod: PaymentMethod,
): string {
  const base = `${playerName}: ${BUY_IN_KIND_LABEL[kind]} ${formatEur(amountCents)} (${PAYMENT_METHOD_LABEL[paymentMethod]})`
  return action === 'preklican' ? `${base} — preklican` : base
}
