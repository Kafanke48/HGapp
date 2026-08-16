import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/schema.ts'
import { listSessionPlayers } from '../../db/repositories/sessions.ts'
import { sessionTotals } from '../../db/repositories/buyins.ts'
import { computeForSession, finalizeSettlement } from '../../db/repositories/settlement.ts'
import { exportBackup, downloadOrShareBackup } from '../../platform/index.ts'
import { formatEur, formatEurSigned } from '../../domain/money.ts'
import type { DiscrepancyMethod, SettlementMode, SettlementResult, Transfer } from '../../domain/settlement/types.ts'
import {
  enqueue,
  formatFinalStandings,
  type FinalStandingRow,
  type SettlementTransferRow,
} from '../../telegram/index.ts'
import { useSettings } from '../hooks/useSettings.ts'
import { Money } from '../components/Money.tsx'
import { NeskladjeSheet, clearDiscrepancyDraft, readDiscrepancyDraft, writeDiscrepancyDraft } from '../components/NeskladjeSheet.tsx'

/** Ključ proti podvajanju za objavo končne poravnave — glej `handlePostToGroup`. */
function finalStandingsDedupKey(sessionId: string): string {
  return `final-standings:${sessionId}`
}

interface PoravnavaScreenProps {
  sessionId: string
  onKoncano: () => void
  onNazaj: () => void
}

type Phase = 'pregled' | 'potrjevanje' | 'koncano'
type BackupStatus = 'idle' | 'working' | 'done' | 'error'
type CopyStatus = 'idle' | 'done' | 'error'

/**
 * Poravnalni zaslon — predogled poravnalnega načrta in njegova potrditev.
 *
 * Vse do klika na "Potrdi" je to zgolj PREDOGLED (`computeForSession`), v bazo
 * se ne zapiše nič. Šele `finalizeSettlement` je nepovraten korak (glej
 * specifikacijo, razdelek 4 in 8.2 — takrat se ponudi tudi varnostna kopija).
 */
export function PoravnavaScreen({ sessionId, onKoncano, onNazaj }: PoravnavaScreenProps) {
  const session = useLiveQuery(() => db.sessions.get(sessionId), [sessionId])
  const sessionPlayers = useLiveQuery(() => listSessionPlayers(db, sessionId), [sessionId])
  const totals = useLiveQuery(() => sessionTotals(db, sessionId), [sessionId])
  const allPlayers = useLiveQuery(() => db.players.toArray(), [])
  const settings = useSettings()

  // Ali je objava končne poravnave v skupino že v vrsti/poslana — prebrano iz
  // baze, ne iz lokalnega stanja, da tudi ponovni obisk zaslona (npr. po
  // ponovnem zagonu aplikacije) pravilno pokaže "že poslano" namesto da bi
  // uporabnika zavedlo, da še ni bilo nič objavljeno (glej nalogo: "dedup key
  // derived from the session id — a settlement must never be posted twice").
  const finalStandingsItem = useLiveQuery(
    () => db.outbox.where('dedupKey').equals(finalStandingsDedupKey(sessionId)).first(),
    [sessionId],
  )

  const nameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of allPlayers ?? []) m.set(p.id, p.name)
    return m
  }, [allPlayers])
  const nameOf = (id: string | null): string => (id === null ? 'blagajna' : (nameById.get(id) ?? id))

  const [mode, setMode] = useState<SettlementMode | null>(null)
  useEffect(() => {
    if (session && mode === null) setMode(session.settlementMode)
  }, [session, mode])

  const [preferredCreditors, setPreferredCreditors] = useState<Record<string, string>>({})
  const [discrepancyMethod, setDiscrepancyMethod] = useState<DiscrepancyMethod | null>(() =>
    readDiscrepancyDraft(sessionId),
  )
  const [sheetOpen, setSheetOpen] = useState(false)

  // Surova razlika Σ cashout − Σ buy-in, izračunana neposredno iz podatkov —
  // NE prek engine-a — samo zato, da vemo, ali je razrešitev sploh potrebna,
  // preden kličemo computeForSession (ki bi sicer vrgel napako).
  const rawDiscrepancy = useMemo(() => {
    if (!sessionPlayers || !totals) return 0
    const sumC = sessionPlayers.reduce((s, sp) => s + (sp.cashoutCents ?? 0), 0)
    const sumB = sessionPlayers.reduce((s, sp) => s + (totals.perPlayer[sp.playerId]?.takenCents ?? 0), 0)
    return sumC - sumB
  }, [sessionPlayers, totals])

  const needsDiscrepancy = rawDiscrepancy !== 0 && discrepancyMethod === null

  const [result, setResult] = useState<SettlementResult | null>(null)
  const [computeError, setComputeError] = useState<string | null>(null)

  useEffect(() => {
    if (!session || mode === null || needsDiscrepancy) {
      setResult(null)
      return
    }
    let cancelled = false
    computeForSession(db, sessionId, { discrepancy: discrepancyMethod, preferredCreditors, mode })
      .then((r) => {
        if (cancelled) return
        setResult(r)
        setComputeError(null)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setResult(null)
        setComputeError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [session, sessionId, mode, discrepancyMethod, preferredCreditors, needsDiscrepancy])

  const [phase, setPhase] = useState<Phase>('pregled')
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeError, setFinalizeError] = useState<string | null>(null)
  const [backupStatus, setBackupStatus] = useState<BackupStatus>('idle')
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle')

  // Indeksi v result.transfers, ki jih je uporabnik v koraku potrjevanja
  // označil kot "že plačano" — zanje finalizeSettlement NE ustvari OpenDebt.
  // Privzeto prazen: direktni transfer praviloma pomeni kredo, ki bo poravnan
  // kasneje, zato je odprt dolg pravilen privzeti izid (glej fix 1).
  const [paidTransferIndexes, setPaidTransferIndexes] = useState<Set<number>>(new Set())

  // Samo 'direktno' transferji lahko postanejo odprt dolg — 'iz_blagajne'
  // nima plačnika (fromPlayerId je null), zato zanj toggle ne obstaja.
  const directTransferEntries = useMemo(
    () =>
      (result?.transfers ?? [])
        .map((transfer, index) => ({ transfer, index }))
        .filter((entry) => entry.transfer.kind === 'direktno'),
    [result],
  )
  const openDebtCount = directTransferEntries.length - paidTransferIndexes.size

  async function handleFinalize(): Promise<void> {
    if (!result) return
    setFinalizing(true)
    setFinalizeError(null)
    try {
      await finalizeSettlement(db, sessionId, result, {
        discrepancy: discrepancyMethod,
        preferredCreditors,
        immediatelyPaidTransferIndexes: [...paidTransferIndexes],
      })
      clearDiscrepancyDraft(sessionId)
      setPhase('koncano')
    } catch (e) {
      setFinalizeError(e instanceof Error ? e.message : String(e))
      setPhase('pregled')
    } finally {
      setFinalizing(false)
    }
  }

  async function handleBackup(): Promise<void> {
    setBackupStatus('working')
    try {
      const file = await exportBackup(db)
      const r = await downloadOrShareBackup(file)
      setBackupStatus(r.cancelled ? 'idle' : 'done')
    } catch {
      setBackupStatus('error')
    }
  }

  const summaryText = result ? buildSummaryText(result, nameOf) : ''

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(summaryText)
      setCopyStatus('done')
    } catch {
      setCopyStatus('error')
    }
  }

  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)

  /**
   * Objava končne lestvice in poravnalnega načrta v Telegram skupino —
   * EKSPLICITNO dejanje uporabnika (glej nalogo), nikoli tih stranski učinek
   * `finalizeSettlement`. `enqueue` je idempotenten glede na `dedupKey`, zato
   * ponovni klik (ali ponovni obisk zaslona) sporočila ne podvoji.
   */
  async function handlePostToGroup(): Promise<void> {
    if (!result || !settings?.telegramGroupChatId) return
    setPosting(true)
    setPostError(null)
    try {
      const standingRows: FinalStandingRow[] = Object.keys(result.netCents).map((id) => ({
        name: nameOf(id),
        netCents: result.netCents[id] ?? 0,
        payoutCents: result.payoutCents[id] ?? 0,
      }))
      const transferRows: SettlementTransferRow[] = result.transfers.map((t) => ({
        fromName: t.fromPlayerId === null ? null : nameOf(t.fromPlayerId),
        toName: t.toPlayerId === null ? null : nameOf(t.toPlayerId),
        amountCents: t.amountCents,
      }))
      await enqueue(db, {
        dedupKey: finalStandingsDedupKey(sessionId),
        method: 'sendMessage',
        params: {
          chat_id: settings.telegramGroupChatId,
          text: formatFinalStandings(standingRows, transferRows, result.boxCents),
        },
        relatedTable: 'sessions',
        relatedId: sessionId,
      })
    } catch (e) {
      setPostError(e instanceof Error ? e.message : String(e))
    } finally {
      setPosting(false)
    }
  }

  const groupChatConfigured = Boolean(settings?.telegramGroupChatId)
  // 'caka' ALI 'poslano' pomeni, da je objava že v teku ali opravljena — gumb
  // takrat zamenja tiho stanje, ne dovoli ponovnega pošiljanja iz te seje
  // (glej `enqueue`: isti dedupKey v teh dveh stanjih se ne prepiše).
  const alreadyQueuedOrSent =
    finalStandingsItem !== undefined &&
    (finalStandingsItem.status === 'caka' || finalStandingsItem.status === 'poslano')
  const alreadyFailed = finalStandingsItem?.status === 'napaka'

  if (!session || !sessionPlayers) {
    return (
      <div className="px-5 py-8">
        <p className="text-bone-dim text-sm">Nalagam …</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="safe-top flex items-center gap-3 px-5 pb-2">
        {phase !== 'koncano' && (
          <button
            type="button"
            onClick={onNazaj}
            aria-label="Nazaj"
            className="text-bone flex size-11 items-center justify-center text-xl"
          >
            ‹
          </button>
        )}
        <div>
          <p className="eyebrow">Poravnava</p>
          <h1 className="text-bone text-lg font-semibold">{session.name ?? 'Poravnalni načrt'}</h1>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 pb-6">
        {phase === 'koncano' && result ? (
          <KoncanoView
            result={result}
            backupStatus={backupStatus}
            onBackup={handleBackup}
            summaryText={summaryText}
            copyStatus={copyStatus}
            onCopy={handleCopy}
            onKoncano={onKoncano}
            groupChatConfigured={groupChatConfigured}
            posting={posting}
            postError={postError}
            alreadyQueuedOrSent={alreadyQueuedOrSent}
            alreadyFailed={alreadyFailed}
            onPostToGroup={handlePostToGroup}
          />
        ) : needsDiscrepancy ? (
          <div className="border-oxblood bg-oxblood/10 mt-2 rounded-lg border p-4">
            <p className="text-oxblood text-sm font-semibold">
              Neskladje {formatEur(Math.abs(rawDiscrepancy))} ni razrešeno.
            </p>
            <p className="text-bone-dim mt-1 text-sm">
              Poravnalnega načrta ni mogoče sestaviti, dokler ni izbrana razrešitev neskladja žetonov.
            </p>
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="bg-oxblood text-bone mt-3 min-h-11 w-full rounded-lg text-sm font-semibold"
            >
              Razreši neskladje
            </button>
          </div>
        ) : computeError ? (
          <div className="border-oxblood bg-oxblood/10 mt-2 rounded-lg border p-4">
            <p className="text-oxblood text-sm font-semibold">Poravnalnega načrta ni mogoče sestaviti.</p>
            <p className="text-bone-dim mt-1 text-sm">{computeError}</p>
          </div>
        ) : !result ? (
          <p className="text-bone-dim mt-2 text-sm">Računam …</p>
        ) : (
          <PregledView
            result={result}
            nameOf={nameOf}
            mode={mode ?? 'blagajna'}
            onModeChange={setMode}
            preferredCreditors={preferredCreditors}
            onPreferredCreditorsChange={setPreferredCreditors}
            expenseEnabled={session.expenseEnabled}
            expenseTotalCents={session.expenseTotalCents}
            expenseSplitMethod={session.expenseSplitMethod}
            expensePaidByName={session.expensePaidByPlayerId ? nameOf(session.expensePaidByPlayerId) : '—'}
            finalizeError={finalizeError}
          />
        )}
      </div>

      {phase === 'pregled' && result && !needsDiscrepancy && (
        <div className="border-line bg-surface safe-bottom sticky bottom-0 border-t px-5 pt-3 pb-3">
          <button
            type="button"
            onClick={() => {
              // Sveža izbira ob vsakem odprtju koraka potrjevanja — če je bil
              // uporabnik prej v tem koraku in preklical, se ne vlečejo stare
              // (morda zdaj neveljavne) oznake "že plačano".
              setPaidTransferIndexes(new Set())
              setPhase('potrjevanje')
            }}
            className="bg-bone text-night min-h-11 w-full rounded-lg py-3 font-semibold"
          >
            Potrdi in zapri sejo
          </button>
        </div>
      )}

      {phase === 'potrjevanje' && result && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/60" role="dialog" aria-modal="true">
          <div className="bg-surface safe-bottom w-full rounded-t-2xl p-5">
            <h2 className="text-bone text-lg font-semibold">Potrdi poravnavo</h2>
            <p className="text-bone-dim mt-2 text-sm">
              To bo zapisalo {result.transfers.length} {sklonVrsticeTozilnik(result.transfers.length)}{' '}
              poravnalnega načrta in sejo prestavilo v stanje "poravnana". Tega dejanja ni mogoče
              razveljaviti.
            </p>

            {directTransferEntries.length > 0 && (
              <div className="mt-4">
                <p className="eyebrow">Direktna nakazila</p>
                <p className="text-bone-dim mt-1 text-xs">
                  Če je denar že zamenjal roke, označi "že plačano" — sicer postavka postane odprt dolg.
                </p>
                <div className="mt-2 flex max-h-56 flex-col gap-2 overflow-y-auto">
                  {directTransferEntries.map(({ transfer, index }) => (
                    <label
                      key={index}
                      className="border-line flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2"
                    >
                      <input
                        type="checkbox"
                        checked={paidTransferIndexes.has(index)}
                        onChange={(e) => {
                          setPaidTransferIndexes((prev) => {
                            const next = new Set(prev)
                            if (e.target.checked) next.add(index)
                            else next.delete(index)
                            return next
                          })
                        }}
                        className="accent-bone size-5 flex-none"
                        aria-label={`${nameOf(transfer.fromPlayerId)} nakaže ${nameOf(transfer.toPlayerId)} — že plačano`}
                      />
                      <span className="text-bone-dim flex-1 text-sm">
                        {nameOf(transfer.fromPlayerId)} → {nameOf(transfer.toPlayerId)} ·{' '}
                        {formatEur(transfer.amountCents)}
                      </span>
                      <span className="text-bone text-xs font-medium">že plačano</span>
                    </label>
                  ))}
                </div>
                <p className="text-bone-dim mt-2 text-xs">{describeOpenDebtCount(openDebtCount)}</p>
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setPhase('pregled')}
                disabled={finalizing}
                className="border-line text-bone min-h-11 flex-1 rounded-lg border py-3 font-medium"
              >
                Prekliči
              </button>
              <button
                type="button"
                onClick={() => void handleFinalize()}
                disabled={finalizing}
                className="bg-bone text-night min-h-11 flex-1 rounded-lg py-3 font-semibold disabled:opacity-40"
              >
                {finalizing ? 'Zapisujem …' : 'Potrdi'}
              </button>
            </div>
          </div>
        </div>
      )}

      {sheetOpen && (
        <NeskladjeSheet
          discrepancyCents={rawDiscrepancy}
          players={sessionPlayers.map((sp) => ({
            playerId: sp.playerId,
            name: nameOf(sp.playerId),
            cashoutCents: sp.cashoutCents ?? 0,
          }))}
          initial={discrepancyMethod}
          onApply={(method) => {
            setDiscrepancyMethod(method)
            writeDiscrepancyDraft(sessionId, method)
          }}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pregled: blagajna, neto/izplačilo, načrt, urejanje prejemnikov, P2P opozorilo
// ---------------------------------------------------------------------------

interface PregledViewProps {
  result: SettlementResult
  nameOf: (id: string | null) => string
  mode: SettlementMode
  onModeChange: (m: SettlementMode) => void
  preferredCreditors: Record<string, string>
  onPreferredCreditorsChange: (updater: (prev: Record<string, string>) => Record<string, string>) => void
  expenseEnabled: boolean
  expenseTotalCents: number
  expenseSplitMethod: 'po_glavah' | 'po_dobicku'
  expensePaidByName: string
  finalizeError: string | null
}

function PregledView({
  result,
  nameOf,
  mode,
  onModeChange,
  preferredCreditors,
  onPreferredCreditorsChange,
  expenseEnabled,
  expenseTotalCents,
  expenseSplitMethod,
  expensePaidByName,
  finalizeError,
}: PregledViewProps) {
  const playerIds = Object.keys(result.netCents).sort((a, b) => result.netCents[b]! - result.netCents[a]!)
  const creditorIds = playerIds.filter((id) => (result.payoutCents[id] ?? 0) > 0)
  const biggestWinnerId = [...creditorIds].sort((a, b) => result.payoutCents[b]! - result.payoutCents[a]!)[0]

  const directByDebtor = new Map<string, Transfer[]>()
  for (const t of result.transfers) {
    if (t.kind !== 'direktno' || t.fromPlayerId === null) continue
    const arr = directByDebtor.get(t.fromPlayerId) ?? []
    arr.push(t)
    directByDebtor.set(t.fromPlayerId, arr)
  }
  const boxTransfers = result.transfers.filter((t) => t.kind === 'iz_blagajne')

  return (
    <div className="flex flex-col gap-5">
      {finalizeError && (
        <div className="border-oxblood bg-oxblood/10 rounded-lg border p-3">
          <p className="text-oxblood text-sm font-semibold">Poravnave ni bilo mogoče zapisati.</p>
          <p className="text-bone-dim mt-1 text-sm">{finalizeError}</p>
        </div>
      )}

      {/* Blagajna — edino mesto v aplikaciji, kjer je dovoljena medenina. */}
      <section>
        <p className="eyebrow">V blagajni naj bo</p>
        <p className="num text-brass mt-1 text-[2.25rem] leading-none font-semibold">{formatEur(result.boxCents)}</p>
      </section>

      {/* Način poravnave */}
      <section>
        <p className="eyebrow">Način poravnave</p>
        <div className="mt-2 flex gap-2">
          <ModeButton label="Blagajna" active={mode === 'blagajna'} onClick={() => onModeChange('blagajna')} />
          <ModeButton label="Med igralci (P2P)" active={mode === 'p2p'} onClick={() => onModeChange('p2p')} />
        </div>
        {result.p2pWithNonEmptyBox && (
          <div className="border-oxblood bg-oxblood/10 mt-2 rounded-lg border p-3">
            <p className="text-oxblood text-sm font-semibold">
              V blagajni je {formatEur(result.boxCents)} — način P2P zanj ne velja.
            </p>
            <p className="text-bone-dim mt-1 text-xs">
              Če zdaj uporabiš P2P, bo nekdo plačan dvakrat: enkrat direktno od drugega igralca in enkrat iz blagajne.
              Najprej izprazni blagajno ali ostani pri načinu "Blagajna".
            </p>
          </div>
        )}
      </section>

      {/* Neto in izplačilo — namerno ločeno, ker je to najpogostejši vir nezaupanja. */}
      <section>
        <p className="eyebrow">Rezultat po igralcih</p>
        <div className="mt-2 flex flex-col gap-2">
          {playerIds.map((id) => {
            const net = result.netCents[id]!
            const payout = result.payoutCents[id]!
            return (
              <div key={id} className="tile flex flex-col gap-1 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-bone font-semibold">{nameOf(id)}</span>
                  <Money cents={net} signed colored className="text-lg" />
                </div>
                <p className="text-bone-faint text-[0.6875rem]">neto (dobiček/izguba)</p>
                <div className="border-line mt-1 flex items-center justify-between border-t pt-1.5">
                  <span className="text-bone-dim text-sm">{payout >= 0 ? 'Prejme' : 'Vplača'}</span>
                  <Money cents={Math.abs(payout)} className="text-bone" />
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Poravnalni načrt */}
      <section>
        <p className="eyebrow">Poravnalni načrt</p>
        <div className="mt-2 flex flex-col gap-2">
          {[...directByDebtor.entries()].map(([debtorId, lines]) => {
            const total = lines.reduce((s, l) => s + l.amountCents, 0)
            const chosen = preferredCreditors[debtorId]
            return (
              <div key={debtorId} className="bg-surface border-line rounded-tile flex flex-col gap-2 border p-4">
                <div className="flex items-center justify-between">
                  <span className="text-bone font-semibold">{nameOf(debtorId)} nakaže</span>
                  <Money cents={total} className="text-bone" />
                </div>
                <div className="flex flex-col gap-1">
                  {lines.map((l, i) => (
                    <div key={i} className="text-bone-dim flex items-center justify-between text-sm">
                      <span>→ {nameOf(l.toPlayerId)}</span>
                      <Money cents={l.amountCents} />
                    </div>
                  ))}
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-bone-faint text-[0.6875rem]">Prejemnik</span>
                  <select
                    className="bg-raised border-line text-bone min-h-11 rounded-lg border px-2 text-sm"
                    value={chosen ?? ''}
                    onChange={(e) => {
                      const v = e.target.value
                      onPreferredCreditorsChange((prev) => {
                        const next = { ...prev }
                        if (v === '') delete next[debtorId]
                        else next[debtorId] = v
                        return next
                      })
                    }}
                  >
                    <option value="">
                      Privzeto{biggestWinnerId ? ` — največ v plusu (${nameOf(biggestWinnerId)})` : ''}
                    </option>
                    {creditorIds
                      .filter((id) => id !== debtorId)
                      .map((id) => (
                        <option key={id} value={id}>
                          {nameOf(id)}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            )
          })}

          {boxTransfers.map((t, i) => (
            <div key={i} className="bg-raised border-line rounded-tile flex items-center justify-between border p-4">
              <span className="text-bone font-semibold">Iz blagajne {nameOf(t.toPlayerId)}</span>
              <Money cents={t.amountCents} className="text-bone" />
            </div>
          ))}

          {directByDebtor.size === 0 && boxTransfers.length === 0 && (
            <p className="text-bone-dim text-sm">Ni transakcij — vsi so izenačeni.</p>
          )}
        </div>
      </section>

      {expenseEnabled && (
        <section>
          <p className="eyebrow">Delitev stroškov</p>
          <div className="tile mt-2 p-4">
            <p className="text-bone text-sm">
              {formatEur(expenseTotalCents)} · {expenseSplitMethod === 'po_glavah' ? 'po glavah' : 'po dobičku'} ·
              založil {expensePaidByName}
            </p>
            {result.expenseFellBackToHeadcount && (
              <p className="text-oxblood mt-1 text-xs font-medium">
                Nihče ni bil v plusu, zato je delitev "po dobičku" padla nazaj na "po glavah".
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

function ModeButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-11 flex-1 rounded-lg border py-2 text-sm font-medium ${
        active ? 'bg-raised border-bone text-bone' : 'border-line text-bone-dim'
      }`}
    >
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Končano: varnostna kopija + povzetek za skupinski klepet
// ---------------------------------------------------------------------------

interface KoncanoViewProps {
  result: SettlementResult
  backupStatus: BackupStatus
  onBackup: () => void
  summaryText: string
  copyStatus: CopyStatus
  onCopy: () => void
  onKoncano: () => void
  /** Ali je ID Telegram skupine sploh nastavljen — sicer se razdelek ne prikaže. */
  groupChatConfigured: boolean
  posting: boolean
  postError: string | null
  /** Objava je že v vrsti ali poslana (glej `finalStandingsDedupKey`) — gumb se skrije. */
  alreadyQueuedOrSent: boolean
  alreadyFailed: boolean
  onPostToGroup: () => void
}

function KoncanoView({
  result,
  backupStatus,
  onBackup,
  summaryText,
  copyStatus,
  onCopy,
  onKoncano,
  groupChatConfigured,
  posting,
  postError,
  alreadyQueuedOrSent,
  alreadyFailed,
  onPostToGroup,
}: KoncanoViewProps) {
  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <p className="text-jade text-lg font-semibold">Seja je poravnana.</p>
        <p className="text-bone-dim mt-1 text-sm">
          Zapisanih je {result.transfers.length} {sklonVrsticeImenovalnik(result.transfers.length)}{' '}
          načrta.
          Neplačane vrstice so zdaj odprti dolgovi.
        </p>
      </div>

      <div className="tile p-4">
        <p className="eyebrow">Varnostna kopija</p>
        <p className="text-bone-dim mt-1 text-sm">
          Shrani celotno bazo kot eno datoteko — zdaj je pravi trenutek, dokler so podatki sveži.
        </p>
        <button
          type="button"
          onClick={() => void onBackup()}
          disabled={backupStatus === 'working'}
          className="border-line text-bone mt-2 min-h-11 w-full rounded-lg border py-2 text-sm font-semibold"
        >
          {backupStatus === 'working' ? 'Pripravljam …' : 'Shrani varnostno kopijo'}
        </button>
        {backupStatus === 'done' && <p className="text-jade mt-1 text-xs">Shranjeno.</p>}
        {backupStatus === 'error' && <p className="text-oxblood mt-1 text-xs">Ni uspelo. Poskusi znova.</p>}
      </div>

      <div className="tile p-4">
        <p className="eyebrow">Povzetek za skupinski klepet</p>
        <textarea
          readOnly
          value={summaryText}
          className="num text-bone bg-raised border-line mt-2 h-40 w-full rounded-lg border p-2 text-xs"
        />
        <button
          type="button"
          onClick={() => void onCopy()}
          className="border-line text-bone mt-2 min-h-11 w-full rounded-lg border py-2 text-sm font-semibold"
        >
          Kopiraj besedilo
        </button>
        {copyStatus === 'done' && <p className="text-jade mt-1 text-xs">Kopirano.</p>}
        {copyStatus === 'error' && <p className="text-oxblood mt-1 text-xs">Kopiranje ni uspelo — označi besedilo ročno.</p>}
      </div>

      {groupChatConfigured && (
        <div className="tile p-4">
          <p className="eyebrow">Objava v skupino (Telegram)</p>
          <p className="text-bone-dim mt-1 text-sm">
            Pošlje končno lestvico in poravnalni načrt neposredno v skupino prek bota — eksplicitno dejanje, ne
            samodejno ob poravnavi.
          </p>
          {alreadyQueuedOrSent ? (
            <p className="text-jade mt-2 text-xs">Objavljeno — sporočilo je v vrsti ali že poslano v skupino.</p>
          ) : (
            <button
              type="button"
              onClick={() => void onPostToGroup()}
              disabled={posting}
              className="border-line text-bone mt-2 min-h-11 w-full rounded-lg border py-2 text-sm font-semibold disabled:opacity-40"
            >
              {posting ? 'Pošiljam …' : alreadyFailed ? 'Poskusi znova' : 'Objavi v skupino'}
            </button>
          )}
          {postError && <p className="text-oxblood mt-1 text-xs">{postError}</p>}
        </div>
      )}

      <button
        type="button"
        onClick={onKoncano}
        className="bg-bone text-night min-h-11 w-full rounded-lg py-3 font-semibold"
      >
        Končano
      </button>
    </div>
  )
}

/**
 * Slovenska dvojina za "vrstica".
 *
 * Preprosta delitev na ena/več tu ne zadošča: "3 vrstic" je napačno, pravilno
 * je "3 vrstice". Napačen sklon takoj izda, da je besedilo strojno sestavljeno.
 */
function sklonVrsticeImenovalnik(n: number): string {
  const r = n % 100
  if (r === 1) return 'vrstica'
  if (r === 2) return 'vrstici'
  if (r === 3 || r === 4) return 'vrstice'
  return 'vrstic'
}

/** Isti sklon v tožilniku: "To bo zapisalo 3 vrstice". */
function sklonVrsticeTozilnik(n: number): string {
  const r = n % 100
  if (r === 1) return 'vrstico'
  if (r === 2) return 'vrstici'
  if (r === 3 || r === 4) return 'vrstice'
  return 'vrstic'
}

/**
 * Slovenska dvojina za "postavka" glede na to, koliko direktnih transferjev
 * bo (po odbitku "že plačano") ostalo kot odprt dolg. Isti vzorec kot
 * sklonIgralci/sklonBuyIn v BlagajnaStrip — n % 100 določa obliko.
 */
function describeOpenDebtCount(n: number): string {
  if (n === 0) return 'Nobena postavka ne bo ostala med odprtimi dolgovi.'
  const r = n % 100
  if (r === 1) return `${n} postavka bo ostala med odprtimi dolgovi.`
  if (r === 2) return `${n} postavki bosta ostali med odprtimi dolgovi.`
  if (r === 3 || r === 4) return `${n} postavke bodo ostale med odprtimi dolgovi.`
  return `${n} postavk bo ostalo med odprtimi dolgovi.`
}

function buildSummaryText(result: SettlementResult, nameOf: (id: string | null) => string): string {
  const lines: string[] = ['Poravnava seje', '']
  const ids = Object.keys(result.netCents).sort((a, b) => result.netCents[b]! - result.netCents[a]!)
  for (const id of ids) {
    lines.push(`${nameOf(id)}: neto ${formatEurSigned(result.netCents[id]!)}, izplačilo ${formatEurSigned(result.payoutCents[id]!)}`)
  }
  lines.push('', 'Kdo komu plača:')
  const rest: string[] = []
  for (const t of result.transfers) {
    if (t.kind === 'iz_blagajne') rest.push(`Iz blagajne ${nameOf(t.toPlayerId)} ${formatEur(t.amountCents)}`)
    else if (t.kind === 'direktno') rest.push(`${nameOf(t.fromPlayerId)} nakaže ${nameOf(t.toPlayerId)} ${formatEur(t.amountCents)}`)
  }
  if (rest.length === 0) lines.push('Ni transakcij.')
  else lines.push(...rest)
  return lines.join('\n')
}
