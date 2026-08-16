import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/schema.ts'
import { updateSettings } from '../../db/repositories/index.ts'
import type { OutboxItem, Player } from '../../db/types.ts'
import {
  discardOutboxItem,
  enqueue,
  findLinkCandidates,
  getMe,
  getUpdates,
  linkPlayer,
  realTelegramTransport,
  unlinkPlayer,
  type LinkCandidate,
} from '../../telegram/index.ts'
import { useSettings } from '../hooks/useSettings.ts'
import { usePlayers } from '../hooks/usePlayers.ts'
import { useTelegramStatus } from '../hooks/useTelegramStatus.ts'
import { Button } from '../components/Button.tsx'
import { Sheet } from '../components/Sheet.tsx'
import { EmptyState } from '../components/EmptyState.tsx'

function fieldClass(): string {
  return 'border-line bg-surface text-bone min-h-11 w-full rounded-lg border px-3 text-[0.9375rem]'
}

/**
 * Odstrani žeton iz sporočila, preden ga karkoli pokaže uporabniku (glej
 * varnostno zahtevo naloge: žeton se nikoli ne sme znajti v napaki na
 * zaslonu). Enaka ideja kot `sanitizeError` v `telegram/outbox.ts`, ki pa ni
 * izvožena — zato majhna lokalna kopija tu.
 */
function withoutToken(message: string, token: string): string {
  if (!token) return message
  return message.split(token).join('[žeton]')
}

type CheckState =
  | { status: 'idle' }
  | { status: 'preverjam' }
  | { status: 'ok'; username: string | null }
  | { status: 'napaka'; message: string }

type FindState =
  | { status: 'idle' }
  | { status: 'iscem' }
  | { status: 'done' }
  | { status: 'napaka'; message: string }

/**
 * Nastavitve — Telegram bot, povezovanje igralcev, neuspela sporočila.
 *
 * Samostojen zaslon brez propov (glej nalogo): sam bere nastavitve in
 * igralce prek živih hookov, sam piše prek `updateSettings`/telegram modula.
 */
export function NastavitveScreen() {
  const settings = useSettings()
  const players = usePlayers()
  const status = useTelegramStatus()

  // --- Žeton --------------------------------------------------------------
  const [editingToken, setEditingToken] = useState(false)
  const [tokenDraft, setTokenDraft] = useState('')
  const [confirmingRemoveToken, setConfirmingRemoveToken] = useState(false)
  const [savingToken, setSavingToken] = useState(false)

  const savedToken = settings?.telegramBotToken ?? null
  const tokenLast4 = savedToken ? savedToken.slice(-4) : null

  async function handleSaveToken() {
    const trimmed = tokenDraft.trim()
    if (trimmed === '') return
    setSavingToken(true)
    try {
      await updateSettings(db, { telegramBotToken: trimmed })
      setTokenDraft('')
      setEditingToken(false)
      setCheckState({ status: 'idle' })
    } finally {
      setSavingToken(false)
    }
  }

  async function handleRemoveToken() {
    await updateSettings(db, { telegramBotToken: null })
    setConfirmingRemoveToken(false)
    setCheckState({ status: 'idle' })
  }

  // --- ID skupine -----------------------------------------------------------
  const [chatIdDraft, setChatIdDraft] = useState<string | null>(null)
  const chatIdValue = chatIdDraft ?? settings?.telegramGroupChatId ?? ''
  const [savingChatId, setSavingChatId] = useState(false)

  async function handleSaveChatId() {
    const trimmed = chatIdValue.trim()
    setSavingChatId(true)
    try {
      await updateSettings(db, { telegramGroupChatId: trimmed === '' ? null : trimmed })
      setChatIdDraft(null)
    } finally {
      setSavingChatId(false)
    }
  }

  // --- Preveri povezavo -----------------------------------------------------
  const [checkState, setCheckState] = useState<CheckState>({ status: 'idle' })
  // Ime bota postane znano šele po uspešnem preverjanju v tej seji — v
  // nastavitvah ga ne hranimo (ni v shemi AppSettings), zato t.me povezava
  // izgine ob ponovnem odprtju zaslona, dokler uporabnik znova ne preveri.
  const [knownBotUsername, setKnownBotUsername] = useState<string | null>(null)

  const tokenForCheck = editingToken && tokenDraft.trim() !== '' ? tokenDraft.trim() : savedToken

  async function handleCheckConnection() {
    const token = tokenForCheck
    if (!token) return
    setCheckState({ status: 'preverjam' })
    try {
      const res = await getMe(realTelegramTransport, token)
      if (res.ok) {
        setCheckState({ status: 'ok', username: res.result.username ?? null })
        if (res.result.username) setKnownBotUsername(res.result.username)
      } else {
        // Telegramov opis se konča brez pike — dodamo jo, da se stavka ne zlijeta.
        const description = withoutToken(res.description, token).trim()
        setCheckState({
          status: 'napaka',
          message: description.endsWith('.') ? description : `${description}.`,
        })
      }
    } catch {
      // Surovega sporočila brskalnika ("Failed to fetch") uporabniku ne
      // kažemo — ne pove mu ničesar uporabnega in zveni kot okvara aplikacije,
      // čeprav gre skoraj vedno za manjkajočo povezavo ali napačen žeton.
      setCheckState({
        status: 'napaka',
        message: 'Telefon ni mogel doseči Telegrama.',
      })
    }
  }

  // --- Povezovanje igralcev --------------------------------------------------
  const [candidates, setCandidates] = useState<LinkCandidate[]>([])
  const [findState, setFindState] = useState<FindState>({ status: 'idle' })
  const [linkingCandidate, setLinkingCandidate] = useState<LinkCandidate | null>(null)

  async function handleFindCandidates() {
    const token = savedToken
    if (!token || !settings) return
    setFindState({ status: 'iscem' })
    try {
      const res = await getUpdates(realTelegramTransport, token, {
        offset: settings.telegramOffset + 1,
        timeout: 0,
        allowed_updates: ['message', 'callback_query'],
      })
      if (!res.ok) {
        setFindState({ status: 'napaka', message: withoutToken(res.description, token) })
        return
      }
      // NAMERNO: telegramOffset tu NE posodobimo. To je enkraten pregled, ne
      // obdelava — poller (ko bo sejaaktivna) mora te iste posodobitve še
      // vedno videti, da jih dejansko obdela (potrditve, odgovori na zavrnitev).
      const found = await findLinkCandidates(db, res.result)
      setCandidates(found)
      setFindState({ status: 'done' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Neznana napaka omrežja.'
      setFindState({ status: 'napaka', message: withoutToken(message, token) })
    }
  }

  async function handleLink(playerId: string, candidate: LinkCandidate) {
    await linkPlayer(db, playerId, candidate.tgUserId, candidate.tgUsername)
    setCandidates((prev) => prev.filter((c) => c.tgUserId !== candidate.tgUserId))
    setLinkingCandidate(null)
  }

  async function handleUnlink(playerId: string) {
    await unlinkPlayer(db, playerId)
  }

  const linkedPlayers = (players ?? []).filter((p) => p.telegramUserId !== null)
  const unlinkedPlayers = (players ?? []).filter((p) => p.telegramUserId === null)

  // --- Neuspela sporočila -----------------------------------------------------
  const failedItems = useLiveQuery(() => db.outbox.where('status').equals('napaka').sortBy('createdAt'), [])

  async function handleRetry(item: OutboxItem) {
    // `enqueue` s podvojenim dedupKey na elementu v stanju 'napaka' ga
    // ponovno postavi v 'caka' (glej telegram/outbox.ts) — to je edini
    // podprt način za ponovni poskus.
    await enqueue(db, {
      dedupKey: item.dedupKey,
      method: item.method,
      params: item.params,
      relatedTable: item.relatedTable,
      relatedId: item.relatedId,
      expiresAt: item.expiresAt,
    })
  }

  async function handleDiscard(item: OutboxItem) {
    // Gre skozi telegram sloj, ne neposredno v Dexie: izbris se tako revidira
    // in je dovoljen samo za trajno spodletele postavke.
    await discardOutboxItem(db, item.id)
  }

  return (
    <div className="safe-top safe-bottom flex min-h-full flex-col gap-6 px-5 pb-8">
      <header className="pt-2">
        <p className="eyebrow">Nastavitve</p>
        <h1 className="text-bone text-xl font-semibold">Telegram</h1>
      </header>

      {/* ---------------------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <p className="eyebrow">Bot</p>
        <p className="text-bone-dim text-[0.8125rem] leading-relaxed">
          Bot pošilja obvestila v skupino in zasebno potrjuje buy-ine. Vse odhodne pošiljke gredo najprej v
          vrsto na tem telefonu in počakajo na povezavo — nič se ne izgubi, če si offline.
        </p>

        {status.configured && (status.pendingCount > 0 || status.failedCount > 0) && (
          <p className="text-bone-dim text-[0.75rem]">
            {status.pendingCount > 0 && <>V vrsti čaka {status.pendingCount}. </>}
            {status.failedCount > 0 && <span className="text-oxblood">Neuspelih {status.failedCount}.</span>}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-bone-faint text-[0.6875rem]" htmlFor="tg-token">
            Žeton bota (Bot API token)
          </label>
          {!editingToken && tokenLast4 ? (
            <div className="border-line bg-surface flex min-h-11 items-center justify-between rounded-lg border px-3">
              <span className="num text-bone-dim text-[0.9375rem]">•••• {tokenLast4}</span>
              <button
                type="button"
                onClick={() => setEditingToken(true)}
                className="text-bone min-h-11 px-2 text-[0.8125rem] font-semibold underline"
              >
                Spremeni
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                id="tg-token"
                type="password"
                autoComplete="off"
                value={tokenDraft}
                onChange={(e) => setTokenDraft(e.target.value)}
                placeholder="1234567890:AA...  (iz @BotFather)"
                className={fieldClass()}
              />
              <Button onClick={() => void handleSaveToken()} disabled={savingToken || tokenDraft.trim() === ''}>
                Shrani
              </Button>
              {tokenLast4 && (
                <Button
                  onClick={() => {
                    setEditingToken(false)
                    setTokenDraft('')
                  }}
                >
                  Prekliči
                </Button>
              )}
            </div>
          )}

          {!editingToken && tokenLast4 && (
            <div className="mt-0.5">
              {confirmingRemoveToken ? (
                <div className="flex items-center gap-2">
                  <span className="text-oxblood text-[0.75rem]">Res odstraniti žeton s te naprave?</span>
                  <button
                    type="button"
                    onClick={() => setConfirmingRemoveToken(false)}
                    className="text-bone-dim min-h-11 px-2 text-[0.75rem] font-medium underline"
                  >
                    Prekliči
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRemoveToken()}
                    className="text-oxblood min-h-11 px-2 text-[0.75rem] font-semibold underline"
                  >
                    Odstrani
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingRemoveToken(true)}
                  className="text-bone-faint min-h-11 px-0 text-[0.75rem] underline"
                >
                  Odstrani žeton s te naprave
                </button>
              )}
            </div>
          )}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-bone-faint text-[0.6875rem]">ID skupine (Group Chat ID)</span>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              value={chatIdValue}
              onChange={(e) => setChatIdDraft(e.target.value)}
              placeholder="npr. -1001234567890"
              className={fieldClass()}
            />
            <Button
              onClick={() => void handleSaveChatId()}
              disabled={savingChatId || chatIdDraft === null}
            >
              Shrani
            </Button>
          </div>
        </label>

        <div>
          <Button fullWidth onClick={() => void handleCheckConnection()} disabled={!tokenForCheck || checkState.status === 'preverjam'}>
            {checkState.status === 'preverjam' ? 'Preverjam …' : 'Preveri povezavo'}
          </Button>
          {checkState.status === 'ok' && (
            <p className="text-jade mt-2 text-[0.8125rem]">
              Povezava deluje{checkState.username ? ` — bot je @${checkState.username}` : ''}.
              {checkState.username && (
                <>
                  {' '}
                  Povabi igralce v skupino z{' '}
                  <a
                    href={`https://t.me/${checkState.username}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    t.me/{checkState.username}
                  </a>
                  .
                </>
              )}
            </p>
          )}
          {checkState.status === 'napaka' && (
            <p className="text-oxblood mt-2 text-[0.8125rem]">
              Povezava ni uspela: {checkState.message} Preveri, ali je žeton pravilno prepisan iz @BotFather, in
              internetno povezavo telefona.
            </p>
          )}
        </div>

        <p className="text-bone-faint text-[0.75rem] leading-relaxed">
          Žeton je shranjen samo v tem telefonu — ni del izvožene varnostne kopije in ga aplikacija nikamor ne
          pošilja razen na api.telegram.org. Če posumiš, da ga je kdo videl, ga v @BotFather prekliči z ukazom{' '}
          <span className="num">/revoke</span> — bot takoj preneha delovati, dokler ne vpišeš novega.
        </p>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <p className="eyebrow">Povezovanje igralcev</p>
        <p className="text-bone-dim text-[0.8125rem] leading-relaxed">
          Bot ne sme prvi pisati igralcu — vsak igralec mora enkrat sam pritisniti Start v pogovoru z botom.
          {knownBotUsername && (
            <>
              {' '}
              Povezavo do bota deli v skupino:{' '}
              <a
                href={`https://t.me/${knownBotUsername}`}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                t.me/{knownBotUsername}
              </a>
              .
            </>
          )}{' '}
          Šele nato ga aplikacija zazna spodaj in ga lahko s tapom povežeš z imenom.
        </p>

        <Button onClick={() => void handleFindCandidates()} disabled={!savedToken || findState.status === 'iscem'}>
          {findState.status === 'iscem' ? 'Iščem …' : 'Poišči nove'}
        </Button>
        {findState.status === 'napaka' && (
          <p className="text-oxblood text-[0.8125rem]">Iskanje ni uspelo: {findState.message}</p>
        )}
        {findState.status === 'done' && candidates.length === 0 && (
          <p className="text-bone-dim text-[0.8125rem]">
            Ni novih uporabnikov. Preveri, ali je igralec res pritisnil Start na botu.
          </p>
        )}

        {candidates.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-bone-faint text-[0.6875rem]">Novi, še nepovezani uporabniki</p>
            {candidates.map((c) => (
              <button
                key={c.tgUserId}
                type="button"
                onClick={() => setLinkingCandidate(c)}
                className="tile flex min-h-11 items-center justify-between p-3 text-left"
              >
                <span className="text-bone text-[0.9375rem] font-medium">
                  {c.firstName ?? 'Neznano ime'}
                  {c.tgUsername && <span className="text-bone-dim"> · @{c.tgUsername}</span>}
                </span>
                <span className="text-bone-dim text-[0.8125rem] underline">Poveži</span>
              </button>
            ))}
          </div>
        )}

        {linkedPlayers.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-bone-faint text-[0.6875rem]">Povezani igralci</p>
            {linkedPlayers.map((p) => (
              <div key={p.id} className="tile flex min-h-11 items-center justify-between p-3">
                <span className="text-bone text-[0.9375rem] font-medium">
                  {p.name}
                  {p.telegramUsername && <span className="text-bone-dim"> · @{p.telegramUsername}</span>}
                </span>
                <Button variant="danger" onClick={() => void handleUnlink(p.id)}>
                  Odveži
                </Button>
              </div>
            ))}
          </div>
        )}

        {unlinkedPlayers.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-bone-faint text-[0.6875rem]">Nepovezani igralci</p>
            <p className="text-bone-dim text-[0.8125rem] leading-relaxed">
              {unlinkedPlayers.map((p) => p.name).join(', ')} — ne prejemajo zasebnih potrditev buy-ina, dokler
              se ne povežejo. Vse ostalo v aplikaciji deluje zanje normalno.
            </p>
          </div>
        )}

        {players !== undefined && players.length === 0 && (
          <EmptyState title="Še ni igralcev" description="Dodaj igralce na zaslonu Igralci, nato jih tu poveži s Telegramom." />
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="tile flex flex-col gap-1.5 p-4">
        <p className="eyebrow">Iskrena omejitev</p>
        <p className="text-bone-dim text-[0.8125rem] leading-relaxed">
          Aplikacija posluša odgovore samo, dokler je odprta na zaslonu — iOS ustavi izvajanje kode nekaj sekund
          po tem, ko jo daš v ozadje ali zakleneš telefon. Zamujeni odgovori se samodejno poberejo ob naslednjem
          odprtju aplikacije — zamuda, ne izguba.
        </p>
      </section>

      {/* ---------------------------------------------------------------- */}
      {failedItems !== undefined && failedItems.length > 0 && (
        <section className="flex flex-col gap-2">
          <p className="eyebrow">Neuspela sporočila</p>
          <p className="text-bone-dim text-[0.8125rem] leading-relaxed">
            Sporočilo, ki tiho izgine, je slabše kot tisto, ki vidno javi napako. Za vsako lahko poskusiš znova
            ali ga zavržeš.
          </p>
          <div className="flex flex-col gap-2">
            {failedItems.map((item) => (
              <div key={item.id} className="tile flex flex-col gap-2 p-3">
                <p className="text-bone text-[0.8125rem] font-medium">{item.method}</p>
                <p className="text-oxblood text-[0.75rem]">{item.lastError ?? 'Neznana napaka.'}</p>
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => void handleRetry(item)}>
                    Poskusi znova
                  </Button>
                  <Button variant="danger" className="flex-1" onClick={() => void handleDiscard(item)}>
                    Zavrzi
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <Sheet
        open={linkingCandidate !== null}
        onClose={() => setLinkingCandidate(null)}
        title={`Poveži ${linkingCandidate?.firstName ?? 'uporabnika'} z igralcem`}
      >
        {unlinkedPlayers.length === 0 ? (
          <p className="text-bone-dim text-sm">Vsi igralci so že povezani. Najprej nekoga odveži.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {unlinkedPlayers.map((p: Player) => (
              <button
                key={p.id}
                type="button"
                onClick={() => linkingCandidate && void handleLink(p.id, linkingCandidate)}
                className="border-line min-h-11 rounded-lg border px-3 py-2 text-left"
              >
                <span className="text-bone text-[0.9375rem] font-medium">{p.name}</span>
              </button>
            ))}
          </div>
        )}
      </Sheet>
    </div>
  )
}
