import { useState } from 'react'
import { db } from '../../db/schema.ts'
import { recordPayment } from '../../db/repositories/index.ts'
import { enqueue, formatOpenDebtReminder, type OpenDebtRow } from '../../telegram/index.ts'
import type { Cents } from '../../domain/money.ts'
import { formatEur, parseEurToCents } from '../../domain/money.ts'
import type { DebtRow, DebtorGroup } from '../hooks/useDebts.ts'
import { useDebtPayments, useDebtsOverview } from '../hooks/useDebts.ts'
import { useSettings } from '../hooks/useSettings.ts'
import { Button } from '../components/Button.tsx'
import { Sheet } from '../components/Sheet.tsx'
import { Money } from '../components/Money.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import type { DebtStatus } from '../../db/types.ts'

const STATUS_LABEL: Record<DebtStatus, string> = {
  odprto: 'Odprto',
  delno: 'Delno plačano',
  placano: 'Plačano',
}

/** Slovenska dvojina za "dolg" — isti vzorec kot v BlagajnaStrip.tsx. */
function sklonDolg(n: number): string {
  const r = n % 100
  if (r === 1) return 'dolg'
  if (r === 2) return 'dolgova'
  if (r === 3 || r === 4) return 'dolgovi'
  return 'dolgov'
}

/** Cente nazaj v besedilo za predizpolnitev vnosnega polja, npr. 4750 -> "47,50". */
function centsToPlainInput(cents: Cents): string {
  const abs = Math.abs(cents)
  return `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`
}

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Evidenca odprtih dolgov (spec, razdelek 5).
 *
 * Namerno brez povezave z novo poravnavo: to ni pozabljena funkcija, ampak
 * odločitev. Mešanje starih dolgov v svežo poravnavo naredi obračun
 * nerazumljiv, obračun, ki ga nihče ne razume, pa mu nihče ne zaupa.
 */
export function DolgoviScreen() {
  const [showSettled, setShowSettled] = useState(false)
  const overview = useDebtsOverview(showSettled)
  const settings = useSettings()
  const [selected, setSelected] = useState<DebtRow | null>(null)
  const [reminderStatus, setReminderStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  // Telegram je "nastavljen" šele, ko sta oba podatka prisotna — brez skupine
  // sporočilo ne bi imelo kam iti (glej settings.ts).
  const telegramConfigured = Boolean(settings?.telegramBotToken && settings?.telegramGroupChatId)

  async function handleSendReminder(): Promise<void> {
    if (!overview || !settings?.telegramGroupChatId) return
    setReminderStatus('sending')
    try {
      const unpaidRows: OpenDebtRow[] = overview.groups
        .flatMap((g) => g.rows)
        .filter((r) => r.debt.status !== 'placano')
        .map((r) => ({
          debtorName: r.debtorName,
          creditorName: r.creditorName,
          remainingCents: r.remainingCents,
        }))

      await enqueue(db, {
        // Datum v ključu: isti opomnik se en dan ne more objaviti dvakrat po
        // nesreči, a jutri je spet nov dan in nov opomnik je smiseln (glej naloga).
        dedupKey: `dolgovi-opomnik:${todayKey()}`,
        method: 'sendMessage',
        params: { chat_id: settings.telegramGroupChatId, text: formatOpenDebtReminder(unpaidRows) },
        relatedTable: 'openDebts',
        relatedId: null,
      })
      setReminderStatus('sent')
    } catch {
      setReminderStatus('error')
    }
  }

  if (overview === undefined) {
    return (
      <div className="px-5 py-8">
        <p className="text-bone-dim text-sm">Nalagam …</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-col px-5 pt-2 pb-6">
      <header className="safe-top flex items-center justify-between py-3">
        <h1 className="text-bone text-xl font-semibold">Dolgovi</h1>
        <button
          type="button"
          onClick={() => setShowSettled((v) => !v)}
          aria-pressed={showSettled}
          className="text-bone-dim min-h-11 px-2 text-[0.8125rem] font-medium"
        >
          {showSettled ? 'Skrij plačane' : 'Prikaži plačane'}
        </button>
      </header>

      <section>
        <p className="eyebrow">Skupaj odprto</p>
        <Money
          cents={overview.totalRemainingCents}
          colored
          className="mt-1 block text-[2.25rem] leading-none font-semibold"
        />
      </section>

      {/* Namerno tiho, enkrat, na tem mestu — razlog, da se dolg iz prejšnje
          seje ne pojavi v nocojšnjem obračunu (glej spec, razdelek 5). */}
      <p className="text-bone-faint mt-3 text-[0.75rem] leading-relaxed">
        Odprti dolgovi so izključno evidenca preteklih sej. Nikoli se samodejno ne primešajo v izračun nove
        poravnave — mešanje starih dolgov v svež obračun bi ga naredilo nerazumljivega, obračunu pa, ki ga nihče
        ne razume, nihče ne zaupa.
      </p>

      {telegramConfigured && overview.totalRemainingCents > 0 && (
        <div className="mt-4">
          <Button onClick={() => void handleSendReminder()} disabled={reminderStatus === 'sending'} fullWidth>
            {reminderStatus === 'sending' ? 'Pošiljam …' : 'Pošlji opomnik v skupino'}
          </Button>
          {reminderStatus === 'sent' && <p className="text-jade mt-1 text-xs">Opomnik je dodan v vrsto za pošiljanje.</p>}
          {reminderStatus === 'error' && <p className="text-oxblood mt-1 text-xs">Opomnika ni bilo mogoče dodati v vrsto. Poskusi znova.</p>}
        </div>
      )}

      <div className="mt-6 flex-1">
        {overview.groups.length === 0 ? (
          <EmptyState
            title="Trenutno ti nihče ne dolguje"
            description="Vsi dolgovi iz preteklih sej so poravnani. Ko po naslednji poravnavi kaj ostane odprto, se pojavi tu."
          />
        ) : (
          <ul className="space-y-4">
            {overview.groups.map((group) => (
              <DebtorGroupSection key={group.debtorPlayerId} group={group} onSelect={setSelected} />
            ))}
          </ul>
        )}
      </div>

      {selected && (
        <PaymentSheet
          row={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

function DebtorGroupSection({ group, onSelect }: { group: DebtorGroup; onSelect: (row: DebtRow) => void }) {
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-bone text-base font-semibold">{group.debtorName}</span>
        <Money cents={group.totalRemainingCents} colored className="text-base font-semibold" />
      </div>
      <p className="text-bone-faint mt-0.5 text-[0.75rem]">
        {group.rows.length} {sklonDolg(group.rows.length)}
      </p>
      <ul className="mt-2 space-y-2">
        {group.rows.map((row) => (
          <li key={row.debt.id}>
            <button
              type="button"
              onClick={() => onSelect(row)}
              // Brez izrecne oznake bralnik zaslona prebere le puščico in znesek,
              // kar ne pove ne komu se dolguje ne kaj se ob pritisku zgodi.
              aria-label={
                row.debt.status === 'placano'
                  ? `Poravnan dolg ${row.creditorName ?? 'blagajni'}, ${formatEur(row.debt.originalCents)}`
                  : `Dolg ${row.creditorName ?? 'blagajni'}, ostane ${formatEur(row.remainingCents)} — zabeleži plačilo`
              }
              className="tile flex w-full min-h-11 items-center justify-between gap-3 p-3.5 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="text-bone block truncate text-[0.9375rem] font-medium">
                  → {row.creditorName ?? 'blagajna'}
                </span>
                <span className="text-bone-dim block text-[0.75rem]">
                  {row.sessionLabel} · {STATUS_LABEL[row.debt.status]}
                </span>
              </span>
              <Money
                cents={row.debt.status === 'placano' ? row.debt.originalCents : row.remainingCents}
                colored={row.debt.status !== 'placano'}
                className="shrink-0 text-[0.9375rem] font-semibold"
              />
            </button>
          </li>
        ))}
      </ul>
    </li>
  )
}

interface PaymentSheetProps {
  row: DebtRow
  onClose: () => void
}

/**
 * List za en dolg: znesek plačila (z bližnjico "Celoten znesek") in zgodovina
 * plačil. Zgodovina je vidna vedno, tudi za že plačane dolgove — delna
 * plačila so ravno tisti primer, kjer se ljudje kasneje ne strinjajo (glej
 * naloga), zato mora zapis ostati na dosegu.
 */
function PaymentSheet({ row, onClose }: PaymentSheetProps) {
  const payments = useDebtPayments(row.debt.id)
  const [amountInput, setAmountInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // `row` prihaja iz nadrejenega stanja, izbranega ob odprtju lista, in se NE
  // osveži samodejno (le podatki v `useDebtsOverview` se). Zato po uspešnem
  // plačilu lokalno prepišemo prikazane zneske z odgovorom `recordPayment` —
  // sicer bi list po plačilu še vedno kazal star ("pred plačilom") znesek.
  const [justPaid, setJustPaid] = useState<{ paidCents: Cents; status: DebtStatus } | null>(null)

  const paidCents = justPaid?.paidCents ?? row.debt.paidCents
  const status = justPaid?.status ?? row.debt.status
  const remainingCents = row.debt.originalCents - paidCents
  const parsedCents = parseEurToCents(amountInput)
  const canSubmit = status !== 'placano' && parsedCents !== null && parsedCents > 0 && parsedCents <= remainingCents

  async function handleSubmit(): Promise<void> {
    if (parsedCents === null || parsedCents <= 0) return
    setSubmitting(true)
    setError(null)
    try {
      const updated = await recordPayment(db, row.debt.id, parsedCents)
      setJustPaid({ paidCents: updated.paidCents, status: updated.status })
      setAmountInput('')
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      // Napako repozitorija ("Preplačilo: ...") pretvorimo v berljivo sporočilo,
      // ki pove, kolikšen je dovoljen maksimum — ne surovo besedilo napake.
      if (raw.includes('Preplačilo')) {
        setError(`To bi bilo preplačilo. Največ, kar lahko vplačaš za ta dolg, je ${formatEur(remainingCents)}.`)
      } else {
        setError('Plačila ni bilo mogoče zapisati. Poskusi znova.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open onClose={onClose} title={row.debtorName}>
      <div className="space-y-4">
        <div className="tile flex flex-col gap-1 p-4">
          <div className="flex items-center justify-between">
            <span className="text-bone-dim text-sm">Dolguje</span>
            <Money cents={remainingCents} colored className="text-lg font-semibold" />
          </div>
          <div className="border-line mt-1 flex items-center justify-between border-t pt-1.5 text-sm">
            <span className="text-bone-dim">Komu</span>
            <span className="text-bone font-medium">{row.creditorName ?? 'blagajna'}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-bone-dim">Iz seje</span>
            <span className="text-bone font-medium">{row.sessionLabel}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-bone-dim">Skupni znesek</span>
            <Money cents={row.debt.originalCents} className="text-bone" />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-bone-dim">Že plačano</span>
            <Money cents={paidCents} className="text-bone" />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-bone-dim">Stanje</span>
            <span className={status === 'placano' ? 'text-jade font-semibold' : 'text-oxblood font-semibold'}>
              {STATUS_LABEL[status]}
            </span>
          </div>
        </div>

        {justPaid && (
          <p className={justPaid.status === 'placano' ? 'text-jade text-sm font-medium' : 'text-bone-dim text-sm'}>
            {justPaid.status === 'placano'
              ? 'Zabeleženo — dolg je zdaj v celoti plačan.'
              : `Zabeleženo — ostane še ${formatEur(row.debt.originalCents - justPaid.paidCents)}.`}
          </p>
        )}

        {status !== 'placano' && (
          <div>
            <p className="eyebrow">Vplačilo</p>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                inputMode="decimal"
                placeholder="Znesek, npr. 15,50"
                value={amountInput}
                onChange={(e) => {
                  setAmountInput(e.target.value)
                  setError(null)
                }}
                aria-label="Znesek plačila v evrih"
                className="border-line bg-surface text-bone num min-h-11 flex-1 rounded-lg border px-3 text-sm"
              />
              <button
                type="button"
                onClick={() => setAmountInput(centsToPlainInput(remainingCents))}
                className="border-line bg-surface text-bone-dim min-h-11 shrink-0 rounded-lg border px-3 text-[0.8125rem] font-medium"
              >
                Celoten znesek
              </button>
            </div>
            {error && <p className="text-oxblood mt-2 text-sm">{error}</p>}

            <Button
              fullWidth
              size="large"
              className="mt-3"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit || submitting}
            >
              {submitting ? 'Zapisujem …' : 'Zabeleži plačilo'}
            </Button>
          </div>
        )}

        <div>
          <p className="eyebrow">Zgodovina plačil</p>
          {payments === undefined ? (
            <p className="text-bone-dim mt-2 text-sm">Nalagam …</p>
          ) : payments.length === 0 ? (
            <p className="text-bone-faint mt-2 text-sm">Še ni bilo nobenega plačila.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between text-sm">
                  <span className="text-bone-dim">
                    {new Date(p.paidAt).toLocaleDateString('sl-SI', { day: 'numeric', month: 'numeric', year: 'numeric' })}
                  </span>
                  <Money cents={p.amountCents} className="text-bone" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Sheet>
  )
}
