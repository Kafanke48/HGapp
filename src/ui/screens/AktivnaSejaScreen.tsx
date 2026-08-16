import { useEffect, useRef, useState } from 'react'
import { db } from '../../db/schema.ts'
import { createBuyIn, transitionSessionStatus, voidBuyIn } from '../../db/repositories/index.ts'
import type { BuyIn, Player } from '../../db/types.ts'
import { acquireWakeLock, releaseWakeLock } from '../../platform/index.ts'
import {
  enqueue,
  enqueueConfirmationPrompt,
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
  const [confirmingEnd, setConfirmingEnd] = useState(false)
  const [pendingUndo, setPendingUndo] = useState<{ buyInId: string; playerName: string } | null>(null)
  const undoTimer = useRef<number | null>(null)

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

  function showUndo(buyInId: string, playerName: string) {
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current)
    setPendingUndo({ buyInId, playerName })
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

  async function handleQuickBuyIn(player: Player) {
    if (!session) return
    const buyIn = await createBuyIn(db, {
      sessionId: session.id,
      playerId: player.id,
      amountCents: session.defaultBuyInCents,
      paymentMethod: 'gotovina',
    })
    showUndo(buyIn.id, player.name)
    fireConfirmationPrompt(player, buyIn)
  }

  async function handleUndo() {
    if (!pendingUndo) return
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current)
    await voidBuyIn(db, pendingUndo.buyInId)
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
        boxCents={totals.boxCents}
        playerCount={rows.length}
        buyInCount={buyInCount}
        creditCents={creditCents}
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

      <div className="grid grid-cols-2 gap-3 px-4 pb-28">
        {rows.map(({ sessionPlayer, player }) => {
          const perPlayer = totals.perPlayer[player.id] ?? { takenCents: 0, paidCents: 0 }
          return (
            <PlayerTile
              key={sessionPlayer.id}
              name={player.name}
              takenCents={perPlayer.takenCents}
              paidCents={perPlayer.paidCents}
              pips={pipsByPlayer.get(player.id) ?? []}
              defaultBuyInCents={session.defaultBuyInCents}
              onQuickBuyIn={() => void handleQuickBuyIn(player)}
              onOpenDetail={() => setSheetPlayer(player)}
            />
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
