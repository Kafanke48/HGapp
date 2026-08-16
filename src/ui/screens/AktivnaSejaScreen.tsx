import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/schema.ts'
import {
  createBuyIn,
  sessionPaidOutTotal,
  transitionSessionStatus,
  undoEarlyCashout,
  voidBuyIn,
} from '../../db/repositories/index.ts'
import type { BuyIn, Player, SessionPlayer } from '../../db/types.ts'
import { acquireWakeLock, releaseWakeLock } from '../../platform/index.ts'
import {
  enqueue,
  enqueueConfirmationPrompt,
  formatBuyInPosted,
  formatCurrentStandings,
  formatSessionStarted,
  type StandingRow,
} from '../../telegram/index.ts'
import { useSession } from '../hooks/useSession.ts'
import { useSessionPlayerRows } from '../hooks/useSessionPlayers.ts'
import { useSessionTotals } from '../hooks/useSessionTotals.ts'
import { useBuyIns } from '../hooks/useBuyIns.ts'
import { useSettings } from '../hooks/useSettings.ts'
import { useTelegramStatus } from '../hooks/useTelegramStatus.ts'
import { BlagajnaStrip } from '../components/BlagajnaStrip.tsx'
import { PlayerTile, type TilePip } from '../components/PlayerTile.tsx'
import { BuyInSheet, type BuyInSubmission } from '../components/BuyInSheet.tsx'
import { IgralecSheet } from '../components/IgralecSheet.tsx'
import { OdhodSheet } from '../components/OdhodSheet.tsx'
import { DodajIgralcaSheet } from '../components/DodajIgralcaSheet.tsx'
import { Sheet } from '../components/Sheet.tsx'
import { Button } from '../components/Button.tsx'

interface AktivnaSejaScreenProps {
  sessionId: string
  onZakljuceno: () => void
  onNazaj: () => void
}

const UNDO_WINDOW_MS = 6000

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/**
 * Zaslon, ki šteje največ: med igro, v temnem prostoru, z eno roko. Hitrost
 * pred funkcijami — zato kratek tap ne sprašuje ničesar (spec 6.1).
 */
export function AktivnaSejaScreen({ sessionId, onZakljuceno, onNazaj }: AktivnaSejaScreenProps) {
  const session = useSession(sessionId)
  const rows = useSessionPlayerRows(sessionId)
  const totals = useSessionTotals(sessionId)
  const buyIns = useBuyIns(sessionId)
  const settings = useSettings()
  const telegramStatus = useTelegramStatus()

  const [elapsedNow, setElapsedNow] = useState(() => Date.now())
  const [sheetPlayer, setSheetPlayer] = useState<Player | null>(null)
  const [detailPlayer, setDetailPlayer] = useState<Player | null>(null)
  const [confirmingEnd, setConfirmingEnd] = useState(false)
  const [pendingUndo, setPendingUndo] = useState<{ buyIn: BuyIn; playerName: string } | null>(null)
  const [odhodTarget, setOdhodTarget] = useState<{ sessionPlayer: SessionPlayer; player: Player } | null>(null)
  const [dodajOpen, setDodajOpen] = useState(false)
  const undoTimer = useRef<number | null>(null)

  // Σ že izplačanega med sejo (predčasni odhodi) — bere se ločeno od
  // sessionTotals, ker gre za drugo tabelo/polje (glej cashouts.ts). Samo
  // branje znotraj useLiveQuery, nikoli pisanje (glej pravila naloge).
  const paidOutTotal = useLiveQuery(() => sessionPaidOutTotal(db, sessionId), [sessionId], 0)

  // Zaslon ne sme zaspati sredi igre (spec 6.1) — pridobi ob priklopu, sprosti ob odklopu.
  useEffect(() => {
    void acquireWakeLock()
    return () => void releaseWakeLock()
  }, [])

  // Časovnik seje.
  useEffect(() => {
    const t = window.setInterval(() => setElapsedNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    return () => {
      if (undoTimer.current !== null) window.clearTimeout(undoTimer.current)
    }
  }, [])

  // Obvestilo v skupino ob začetku seje — TOČNO ENKRAT, ne glede na to,
  // kolikokrat je ta zaslon odprt/zaprt/ponovno naložen (glej spec 7.4:
  // dedupKey ščiti pred podvajanjem). `enqueue` samo doda v vrsto — pravo
  // pošiljanje opravi `useTelegramRuntime` (drain) v App, zunaj naše lasti.
  useEffect(() => {
    if (!session || session.startedAt === null) return
    if (!settings?.telegramGroupChatId) return // Skupina ni nastavljena — ni kam poslati.
    void enqueue(db, {
      dedupKey: `session-started:${session.id}`,
      method: 'sendMessage',
      params: {
        chat_id: settings.telegramGroupChatId,
        text: formatSessionStarted({ name: session.name, location: session.location }),
      },
      relatedTable: 'sessions',
      relatedId: session.id,
    }).catch((err: unknown) => {
      console.warn('Telegram: obvestilo o začetku seje ni bilo dodano v vrsto', err)
    })
  }, [session, settings])

  function showUndo(buyIn: BuyIn, playerName: string) {
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current)
    setPendingUndo({ buyIn, playerName })
    undoTimer.current = window.setTimeout(() => setPendingUndo(null), UNDO_WINDOW_MS)
  }

  // Zasebna potrditev buy-ina gre v vrsto NEODVISNO od glavnega zapisa —
  // fire-and-forget: nikoli ne sme zakasniti ali blokirati buy-ina, in
  // nepovezan igralec je normalno stanje, ne napaka (glej spec 7.3/7.5).
  function fireConfirmationPrompt(player: Player, buyIn: BuyIn) {
    void enqueueConfirmationPrompt(db, player, buyIn).catch((err: unknown) => {
      console.warn('Telegram: potrditev buy-ina ni bila dodana v vrsto', err)
    })
  }

  // Objava v SKUPINO ob vsakem buy-inu (in njegovem preklicu/popravku) —
  // lastnikova izrecna zahteva po realni rabi (prej je skupina ostala brez
  // vsakršnega obvestila). Fire-and-forget kot zgoraj: nikoli ne sme
  // upočasniti beleženja, brez skupine (settings.telegramGroupChatId manjka)
  // je to normalno stanje, ne napaka. Ključ IZHAJA iz ID-ja buy-ina, zato
  // ponovno odprtje zaslona ali podvojen klic nikoli ne podvoji sporočila.
  function firePostedToGroup(action: 'zabelezen' | 'preklican', playerName: string, buyIn: BuyIn) {
    if (!settings?.telegramGroupChatId) return
    const dedupKey = action === 'zabelezen' ? `buyin-posted:${buyIn.id}` : `buyin-voided:${buyIn.id}`
    void enqueue(db, {
      dedupKey,
      method: 'sendMessage',
      params: {
        chat_id: settings.telegramGroupChatId,
        text: formatBuyInPosted(action, playerName, buyIn.kind, buyIn.amountCents, buyIn.paymentMethod),
      },
      relatedTable: 'buyIns',
      relatedId: buyIn.id,
    }).catch((err: unknown) => {
      console.warn('Telegram: objava buy-ina v skupino ni bila dodana v vrsto', err)
    })
  }

  async function handleQuickBuyIn(player: Player) {
    if (!session) return
    const buyIn = await createBuyIn(db, {
      sessionId: session.id,
      playerId: player.id,
      amountCents: session.defaultBuyInCents,
      paymentMethod: 'gotovina',
    })
    showUndo(buyIn, player.name)
    fireConfirmationPrompt(player, buyIn)
    firePostedToGroup('zabelezen', player.name, buyIn)
  }

  async function handleUndo() {
    if (!pendingUndo) return
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current)
    const voided = await voidBuyIn(db, pendingUndo.buyIn.id)
    firePostedToGroup('preklican', pendingUndo.playerName, voided)
    setPendingUndo(null)
  }

  async function handleBuyInSubmit(input: BuyInSubmission) {
    if (!session || !sheetPlayer) return
    const buyIn = await createBuyIn(db, {
      sessionId: session.id,
      playerId: sheetPlayer.id,
      kind: input.kind,
      amountCents: input.amountCents,
      paymentMethod: input.paymentMethod,
      note: input.note,
    })
    fireConfirmationPrompt(sheetPlayer, buyIn)
    firePostedToGroup('zabelezen', sheetPlayer.name, buyIn)
    setSheetPlayer(null)
  }

  // Ročna objava vmesnega stanja v skupino (spec 7.4) — NIKOLI samodejno.
  // dedupKey vsebuje čas, ker gre za ponovljivo dejanje: vsak pritisk je
  // svoje, novo sporočilo, ne popravek prejšnjega.
  async function handleSendStandings() {
    if (!session || !rows || !settings?.telegramGroupChatId) return
    const standingRows: StandingRow[] = rows.map(({ player }) => {
      const p = totals.perPlayer[player.id] ?? { takenCents: 0, paidCents: 0 }
      return { name: player.name, takenCents: p.takenCents, paidCents: p.paidCents }
    })
    await enqueue(db, {
      dedupKey: `standings:${session.id}:${Date.now()}`,
      method: 'sendMessage',
      params: {
        chat_id: settings.telegramGroupChatId,
        text: formatCurrentStandings(standingRows, totals.boxCents),
      },
      relatedTable: 'sessions',
      relatedId: session.id,
    })
  }

  async function handleConfirmEnd() {
    if (!session) return
    await transitionSessionStatus(db, session.id, 'zakljucena')
    setConfirmingEnd(false)
    onZakljuceno()
  }

  // "Vrnil se je za mizo" — igralec, ki je odšel, se je premislil. Realen
  // primer pri gotovinski igri (glej nalogo, razdelek 2).
  async function handleReturn(sessionPlayer: SessionPlayer) {
    await undoEarlyCashout(db, sessionPlayer.id)
  }

  if (!session || rows === undefined) return null

  const pipsByPlayer = new Map<string, TilePip[]>()
  for (const buyIn of buyIns ?? []) {
    if (buyIn.voided) continue
    const list = pipsByPlayer.get(buyIn.playerId) ?? []
    list.push({ method: buyIn.paymentMethod, confirmation: buyIn.confirmation })
    pipsByPlayer.set(buyIn.playerId, list)
  }

  const creditCents = Object.values(totals.perPlayer).reduce(
    (sum, p) => sum + (p.takenCents - p.paidCents),
    0,
  )
  const buyInCount = (buyIns ?? []).filter((b) => !b.voided).length
  const presetsCents = settings?.buyInPresetsCents ?? [session.defaultBuyInCents]
  const elapsedMs = session.startedAt ? elapsedNow - session.startedAt : 0

  // Kontrola blagajne po predčasnih odhodih (spec, razdelek 4 naloge):
  // Σ P − Σ že izplačano, ne golo Σ P — sicer bi bila številka od prvega
  // odhoda naprej preprosto napačna.
  const boxCents = totals.boxCents - paidOutTotal
  // Naslednji prosti sedež za novo dodanega igralca (glej addSessionPlayer).
  const nextSeatOrder = rows.length

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between px-4 pt-2">
        <button
          type="button"
          onClick={onNazaj}
          aria-label="Nazaj na seznam sej"
          className="text-bone-dim flex h-11 w-11 items-center justify-center"
        >
          <BackIcon />
        </button>
        <span className="num text-bone-dim text-sm" aria-label="Čas od začetka seje">
          {formatElapsed(elapsedMs)}
        </span>
        <Button variant="danger" onClick={() => setConfirmingEnd(true)}>
          Zaključi sejo
        </Button>
      </header>

      <BlagajnaStrip
        boxCents={boxCents}
        playerCount={rows.length}
        buyInCount={buyInCount}
        creditCents={creditCents}
        paidOutCents={paidOutTotal}
      />

      {settings?.telegramGroupChatId && (
        <div className="flex items-center justify-between px-4 pb-2">
          <button
            type="button"
            onClick={() => void handleSendStandings()}
            className="text-bone-dim min-h-11 px-1 text-[0.8125rem] font-medium underline"
          >
            Pošlji stanje v skupino
          </button>
          {/* Tih indikator — namerno majhen in bledih barv, da ne tekmuje z blagajno zgoraj. */}
          {telegramStatus.pendingCount > 0 && (
            <span className="text-bone-faint text-[0.6875rem]">
              {telegramStatus.pendingCount} v vrsti
            </span>
          )}
        </div>
      )}

      <div className="px-4 pb-3">
        <Button fullWidth onClick={() => setDodajOpen(true)}>
          + Dodaj igralca
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 px-4 pb-28">
        {rows.map(({ sessionPlayer, player }) => {
          const perPlayer = totals.perPlayer[player.id] ?? { takenCents: 0, paidCents: 0 }
          const hasLeft = sessionPlayer.leftAt !== null
          return (
            // self-start: BREZ tega bi CSS grid ta ovojni div raztegnil na višino
            // najvišje ploščice v isti vrstici (grid privzeto poravna po "stretch").
            // Odšla ploščica ima drugačno višino od aktivne (dodatna vrstica "odšel
            // z ..."), zato bi se prekrivni gumb spodaj (bottom-14/bottom-28,
            // merjeno od DNA OVOJA) razšel od dejanskega dna ploščice in prekril
            // njen gumb "Vrnil se je za mizo" (odkrito z elementFromPoint).
            <div key={sessionPlayer.id} className="relative self-start">
              <PlayerTile
                name={player.name}
                takenCents={perPlayer.takenCents}
                paidCents={perPlayer.paidCents}
                pips={pipsByPlayer.get(player.id) ?? []}
                defaultBuyInCents={session.defaultBuyInCents}
                onQuickBuyIn={() => void handleQuickBuyIn(player)}
                onOpenDetail={() => setSheetPlayer(player)}
                leftAt={sessionPlayer.leftAt}
                cashoutCents={sessionPlayer.cashoutCents}
                paidOutCents={sessionPlayer.paidOutCents}
                onOpenOdhod={() => setOdhodTarget({ sessionPlayer, player })}
                onReturn={() => void handleReturn(sessionPlayer)}
              />
              {/* Prekriva samo zgornji del ploščice (ime/znesek), NE spodnjega dela z
                  gumbi — ta del mora ostati klikljiv (glej nalogo). Aktivna ploščica
                  ima ZDAJ tri gumbe v dveh vrsticah (bottom-28 = mt-3 + 44 + gap-2 +
                  44, zaokroženo navzgor), odšla ploščica samo enega (bottom-14, kot
                  prej). PlayerTile.tsx zato ni bilo treba spreminjati: ta prekrivni
                  gumb je sosed, ne starš, gumbov. */}
              <button
                type="button"
                onClick={() => setDetailPlayer(player)}
                aria-label={`${player.name}: uredi buy-ine te seje`}
                className={`absolute inset-x-0 top-0 ${hasLeft ? 'bottom-14' : 'bottom-28'}`}
              />
            </div>
          )
        })}
      </div>

      {pendingUndo && (
        <div
          role="status"
          className="border-line bg-raised safe-bottom fixed inset-x-4 bottom-4 flex items-center justify-between gap-3 rounded-xl border px-4 py-3"
        >
          <span className="text-bone text-[0.875rem]">Buy-in za {pendingUndo.playerName} zabeležen.</span>
          <button
            type="button"
            onClick={() => void handleUndo()}
            className="text-bone min-h-11 shrink-0 px-2 text-[0.875rem] font-semibold underline"
          >
            Razveljavi
          </button>
        </div>
      )}

      <BuyInSheet
        open={sheetPlayer !== null}
        playerName={sheetPlayer?.name ?? ''}
        presetsCents={presetsCents}
        defaultAmountCents={session.defaultBuyInCents}
        onClose={() => setSheetPlayer(null)}
        onSubmit={(input) => void handleBuyInSubmit(input)}
      />

      <IgralecSheet
        open={detailPlayer !== null}
        sessionId={session.id}
        player={detailPlayer}
        buyIns={buyIns ?? []}
        groupChatId={settings?.telegramGroupChatId ?? null}
        onClose={() => setDetailPlayer(null)}
      />

      <OdhodSheet
        open={odhodTarget !== null}
        sessionPlayerId={odhodTarget?.sessionPlayer.id ?? null}
        playerName={odhodTarget?.player.name ?? ''}
        takenCents={odhodTarget ? (totals.perPlayer[odhodTarget.player.id]?.takenCents ?? 0) : 0}
        paidCents={odhodTarget ? (totals.perPlayer[odhodTarget.player.id]?.paidCents ?? 0) : 0}
        cashoutMode={session.cashoutMode}
        chipDenominations={session.chipDenominations}
        boxCentsNow={boxCents}
        onClose={() => setOdhodTarget(null)}
      />

      <DodajIgralcaSheet
        open={dodajOpen}
        sessionId={session.id}
        seatedPlayerIds={rows.map((r) => r.player.id)}
        nextSeatOrder={nextSeatOrder}
        onClose={() => setDodajOpen(false)}
      />

      <Sheet open={confirmingEnd} onClose={() => setConfirmingEnd(false)} title="Zaključi sejo?">
        <p className="text-bone-dim text-[0.875rem] leading-relaxed">
          Po zaključku ne moreš več beležiti buy-inov. Naslednji korak je vpis končnega stanja žetonov.
        </p>
        <div className="mt-4 flex gap-2">
          <Button className="flex-1" onClick={() => setConfirmingEnd(false)}>
            Prekliči
          </Button>
          <Button variant="danger" className="flex-1" onClick={() => void handleConfirmEnd()}>
            Zaključi sejo
          </Button>
        </div>
      </Sheet>
    </div>
  )
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
