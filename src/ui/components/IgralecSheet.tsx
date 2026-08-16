import { useState } from 'react'
import { formatEur, parseEurToCents } from '../../domain/money.ts'
import type { BuyIn, BuyInKind, ConfirmationStatus, PaymentMethod, Player } from '../../db/types.ts'
import { db } from '../../db/schema.ts'
import { createBuyIn, voidBuyIn } from '../../db/repositories/index.ts'
import { enqueue, formatBuyInPosted } from '../../telegram/index.ts'
import { Sheet } from './Sheet.tsx'
import { Button } from './Button.tsx'
import { Money } from './Money.tsx'

/** Pokerski izrazi ostanejo v angleščini (glej pravila copyja) — enak seznam kot BuyInSheet. */
const KIND_LABELS: Record<BuyInKind, string> = {
  buyin: 'buy-in',
  rebuy: 'rebuy',
  addon: 'add-on',
}
const KIND_ORDER: readonly BuyInKind[] = ['buyin', 'rebuy', 'addon']
const METHOD_ORDER: readonly PaymentMethod[] = ['gotovina', 'nakazilo', 'kredo']

const CONFIRMATION_LABELS: Record<ConfirmationStatus, string> = {
  nepotrjen: 'nepotrjeno',
  potrjen: 'potrjeno',
  zavrnjen: 'zavrnjeno',
}

interface IgralecSheetProps {
  open: boolean
  sessionId: string
  player: Player | null
  /** Vsi buy-ini seje (tudi preklicani) — komponenta sama filtrira po igralcu, da zgodovina ostane vidna. */
  buyIns: readonly BuyIn[]
  /** `settings.telegramGroupChatId` — null pomeni "skupina ni nastavljena", normalno stanje, ne napaka. */
  groupChatId: string | null
  onClose: () => void
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' })
}

function chipClass(selected: boolean): string {
  return `border-line min-h-11 flex-1 rounded-lg border px-2 text-xs font-medium ${
    selected ? 'bg-raised text-bone' : 'bg-surface text-bone-dim'
  }`
}

/**
 * Objavi buy-in (ali njegov preklic/popravek) v skupino. Samostojna kopija
 * glede na AktivnaSejaScreen — ta komponenta namerno ne uvaža internih
 * funkcij zaslona (glej obseg naloge), zato ima svojo fire-and-forget
 * različico. Nikoli ne sme blokirati ali upočasniti popravka/preklica, zato
 * napaka gre samo v konzolo, ne v uporabniški vmesnik.
 */
function firePostedToGroup(
  groupChatId: string | null,
  action: 'zabelezen' | 'preklican',
  playerName: string,
  buyIn: BuyIn,
): void {
  if (!groupChatId) return
  // Ključ IZHAJA iz ID-ja buy-ina in dejanja — ponovno odprtje tega lista ali
  // podvojen klic (npr. dvojni tap) zato nikoli ne podvoji sporočila v skupini.
  const dedupKey = action === 'zabelezen' ? `buyin-posted:${buyIn.id}` : `buyin-voided:${buyIn.id}`
  void enqueue(db, {
    dedupKey,
    method: 'sendMessage',
    params: {
      chat_id: groupChatId,
      text: formatBuyInPosted(action, playerName, buyIn.kind, buyIn.amountCents, buyIn.paymentMethod),
    },
    relatedTable: 'buyIns',
    relatedId: buyIn.id,
  }).catch((err: unknown) => {
    console.warn('Telegram: objava popravka/preklica buy-ina ni bila dodana v vrsto', err)
  })
}

/**
 * List za popravljanje napak, opaženih pozneje med večerom (undo snackbar
 * izgine po nekaj sekundah in ni dovolj). Odpre se s tapom na ime/znesek
 * igralčeve ploščice — oba gumba za buy-in na ploščici ostajata nespremenjena.
 *
 * Nič se tu ne briše na trdo: preklic je vedno `voidBuyIn`, popravek pa
 * preklic stare vrstice + nov `createBuyIn` s popravljenimi vrednostmi (glej
 * `handleSaveCorrection` spodaj za razlog).
 */
export function IgralecSheet({ open, sessionId, player, buyIns, groupChatId, onClose }: IgralecSheetProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editAmountInput, setEditAmountInput] = useState('')
  const [editKind, setEditKind] = useState<BuyInKind>('buyin')
  const [editMethod, setEditMethod] = useState<PaymentMethod>('gotovina')

  if (!player) return null

  const playerBuyIns = buyIns
    .filter((b) => b.playerId === player.id)
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)

  // Tekoča B/P samo za tega igralca — da je učinek popravka viden takoj, brez
  // da bi bilo treba zapreti list in gledati blagajno na glavnem zaslonu.
  const runningTotals = playerBuyIns.reduce(
    (acc, b) =>
      b.voided
        ? acc
        : { takenCents: acc.takenCents + b.amountCents, paidCents: acc.paidCents + b.paidCents },
    { takenCents: 0, paidCents: 0 },
  )

  function startEdit(buyIn: BuyIn) {
    setEditingId(buyIn.id)
    setEditAmountInput(formatEur(buyIn.amountCents))
    setEditKind(buyIn.kind)
    setEditMethod(buyIn.paymentMethod)
  }

  function cancelEdit() {
    setEditingId(null)
  }

  async function handleVoid(buyIn: BuyIn) {
    const voided = await voidBuyIn(db, buyIn.id)
    firePostedToGroup(groupChatId, 'preklican', player!.name, voided)
    if (editingId === buyIn.id) setEditingId(null)
  }

  async function handleSaveCorrection(original: BuyIn) {
    const amountCents = parseEurToCents(editAmountInput)
    if (amountCents === null || amountCents <= 0) return

    // Ni funkcije za posodobitev buy-ina (namerno, glej db/repositories/buyins.ts) —
    // popravek zato izvedemo kot `voidBuyIn` na stari vrstici in `createBuyIn` z
    // novimi vrednostmi. To ohrani revizijsko sled pošteno (napaka IN popravek
    // sta oba vidna v zgodovini, nič ni tiho prepisano) in gre skozi
    // `createBuyIn`, edino mesto, ki kliče `derivePaidCents` — zato sprememba
    // gotovina<->kredo pravilno premakne P (in s tem blagajno), namesto da bi
    // kdo tu ročno pisal paidCents in tvegal, da blagajna tiho preneha držati.
    const voided = await voidBuyIn(db, original.id)
    const created = await createBuyIn(db, {
      sessionId,
      playerId: original.playerId,
      kind: editKind,
      amountCents,
      paymentMethod: editMethod,
      note: original.note,
    })
    firePostedToGroup(groupChatId, 'preklican', player!.name, voided)
    firePostedToGroup(groupChatId, 'zabelezen', player!.name, created)
    setEditingId(null)
  }

  return (
    <Sheet open={open} onClose={onClose} title={player.name}>
      <div className="space-y-4">
        <div className="flex gap-6">
          <div>
            <p className="eyebrow">Vzel (B)</p>
            <Money cents={runningTotals.takenCents} className="mt-1 block text-xl" />
          </div>
          <div>
            <p className="eyebrow">Plačal (P)</p>
            <Money cents={runningTotals.paidCents} className="mt-1 block text-xl" />
          </div>
        </div>

        {playerBuyIns.length === 0 && (
          <p className="text-bone-faint text-sm">Ta igralec še nima buy-inov v tej seji.</p>
        )}

        <ul className="space-y-2">
          {playerBuyIns.map((buyIn) => {
            const isEditing = editingId === buyIn.id
            return (
              <li key={buyIn.id} className={`border-line rounded-lg border p-3 ${buyIn.voided ? 'opacity-50' : ''}`}>
                {isEditing ? (
                  <div className="space-y-3">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={editAmountInput}
                      onChange={(e) => setEditAmountInput(e.target.value)}
                      aria-label={`Popravljen znesek za ${player.name} v evrih`}
                      className="border-line bg-surface text-bone num min-h-11 w-full rounded-lg border px-3 text-sm"
                    />
                    <div className="flex gap-2">
                      {KIND_ORDER.map((k) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setEditKind(k)}
                          aria-pressed={editKind === k}
                          aria-label={`Vrsta: ${KIND_LABELS[k]}`}
                          className={chipClass(editKind === k)}
                        >
                          {KIND_LABELS[k]}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      {METHOD_ORDER.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setEditMethod(m)}
                          aria-pressed={editMethod === m}
                          aria-label={`Način vplačila: ${m}`}
                          className={chipClass(editMethod === m)}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Button className="flex-1" onClick={cancelEdit}>
                        Prekliči urejanje
                      </Button>
                      <Button variant="primary" className="flex-1" onClick={() => void handleSaveCorrection(buyIn)}>
                        Shrani popravek
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className={buyIn.voided ? 'line-through' : ''}>
                      <span className="text-bone block text-sm font-medium">
                        {KIND_LABELS[buyIn.kind]} · {buyIn.paymentMethod} · {formatTime(buyIn.createdAt)}
                      </span>
                      <span className="text-bone-faint block text-xs">
                        {buyIn.voided ? 'preklican' : CONFIRMATION_LABELS[buyIn.confirmation]}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Money
                        cents={buyIn.amountCents}
                        className={buyIn.voided ? 'text-bone-faint line-through text-sm' : 'text-sm'}
                      />
                      {!buyIn.voided && (
                        <>
                          <button
                            type="button"
                            onClick={() => startEdit(buyIn)}
                            aria-label={`Popravi buy-in ${formatEur(buyIn.amountCents)} igralca ${player.name}`}
                            className="text-bone-dim min-h-11 px-2 text-xs font-semibold underline"
                          >
                            Popravi
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleVoid(buyIn)}
                            aria-label={`Prekliči buy-in ${formatEur(buyIn.amountCents)} igralca ${player.name}`}
                            className="text-oxblood min-h-11 px-2 text-xs font-semibold underline"
                          >
                            Prekliči
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </Sheet>
  )
}
