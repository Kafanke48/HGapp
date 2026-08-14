import type { Session, SessionStatus } from '../../db/types.ts'
import { useSessionsOverview } from '../hooks/useSessions.ts'
import { Button } from '../components/Button.tsx'
import { EmptyState } from '../components/EmptyState.tsx'

interface SejeScreenProps {
  onNovaSeja: () => void
  onNadaljuj: (sessionId: string) => void
  /** Odpre zaključeno, a še ne poravnano sejo — nadaljuje pri vpisu končnega stanja. */
  onPoravnaj: (sessionId: string) => void
}

const STATUS_LABELS: Record<SessionStatus, string> = {
  nacrtovana: 'Načrtovana',
  aktivna: 'Aktivna',
  zakljucena: 'Zaključena',
  poravnana: 'Poravnana',
}

/** Slovenska dvojina za "igralec" — glej isti vzorec v BlagajnaStrip.tsx. */
function sklonIgralci(n: number): string {
  const r = n % 100
  if (r === 1) return 'igralec'
  if (r === 2) return 'igralca'
  if (r === 3 || r === 4) return 'igralci'
  return 'igralcev'
}

function formatDate(ts: number | null): string {
  if (ts === null) return 'brez datuma'
  return new Date(ts).toLocaleDateString('sl-SI', { day: 'numeric', month: 'numeric', year: 'numeric' })
}

function sessionSubtitle(session: Session): string {
  const parts: string[] = []
  if (session.location) parts.push(session.location)
  if (session.blindsLabel) parts.push(session.blindsLabel)
  return parts.length > 0 ? parts.join(' · ') : 'brez lokacije'
}

/**
 * Domov: seznam sej. Aktivna seja (če obstaja) je pripeta na vrh z "Nadaljuj",
 * ker je to edino dejanje, ki ga uporabnik med igro dejansko potrebuje odtod.
 */
export function SejeScreen({ onNovaSeja, onNadaljuj, onPoravnaj }: SejeScreenProps) {
  const overview = useSessionsOverview()

  if (overview === undefined) return null

  const aktivna = overview.find((o) => o.session.status === 'aktivna')

  // Zaključena, a še ne poravnana seja je nedokončan posel in mora biti enako
  // vidna kot aktivna. Med štetjem žetonov se aplikacija skoraj vedno zapre —
  // če takšna seja ne bi imela poti nazaj, bi podatki obtičali brez poravnave.
  const zaPoravnavo = overview.filter((o) => o.session.status === 'zakljucena')

  const rest = overview.filter(
    (o) => o.session.id !== aktivna?.session.id && o.session.status !== 'zakljucena',
  )

  return (
    <div className="flex min-h-full flex-col px-5 pt-2 pb-6">
      <header className="flex items-center justify-between py-3">
        <h1 className="text-bone text-xl font-semibold">Seje</h1>
      </header>

      <Button variant="primary" size="large" fullWidth onClick={onNovaSeja}>
        Nova seja
      </Button>

      {aktivna && (
        <section className="mt-5">
          <p className="eyebrow">Trenutno v teku</p>
          <div className="tile mt-2 flex flex-col gap-3 p-4">
            <div>
              <p className="text-bone text-base font-semibold">
                {aktivna.session.name ?? 'Seja brez imena'}
              </p>
              <p className="text-bone-dim mt-0.5 text-[0.8125rem]">
                {sessionSubtitle(aktivna.session)} · {aktivna.playerCount} {sklonIgralci(aktivna.playerCount)}
              </p>
            </div>
            <Button fullWidth onClick={() => onNadaljuj(aktivna.session.id)}>
              Nadaljuj
            </Button>
          </div>
        </section>
      )}

      {zaPoravnavo.length > 0 && (
        <section className="mt-5">
          <p className="eyebrow text-oxblood">Čaka na poravnavo</p>
          <ul className="mt-2 space-y-2">
            {zaPoravnavo.map(({ session, playerCount }) => (
              <li key={session.id} className="tile flex flex-col gap-3 p-4">
                <div>
                  <p className="text-bone text-base font-semibold">
                    {session.name ?? 'Seja brez imena'}
                  </p>
                  <p className="text-bone-dim mt-0.5 text-[0.8125rem]">
                    {formatDate(session.startedAt ?? session.scheduledAt)} · {sessionSubtitle(session)}{' '}
                    · {playerCount} {sklonIgralci(playerCount)}
                  </p>
                </div>
                <Button fullWidth onClick={() => onPoravnaj(session.id)}>
                  Poravnaj
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6 flex-1">
        <p className="eyebrow">Pretekle seje</p>

        {rest.length === 0 && !aktivna && zaPoravnavo.length === 0 && (
          <EmptyState
            title="Še ni nobene seje"
            description="Ustvari prvo sejo zgoraj — od tam v paru tapov dodaš igralce in začneš."
          />
        )}

        {rest.length === 0 && (aktivna || zaPoravnavo.length > 0) && (
          <p className="text-bone-faint mt-3 text-sm">Ni preteklih sej.</p>
        )}

        {rest.length > 0 && (
          <ul className="mt-3 space-y-2">
            {rest.map(({ session, playerCount }) => (
              <li key={session.id} className="tile flex flex-col gap-1 p-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-bone truncate text-[0.9375rem] font-semibold">
                    {session.name ?? 'Seja brez imena'}
                  </span>
                  <span className="text-bone-dim shrink-0 text-[0.75rem] font-medium">
                    {STATUS_LABELS[session.status]}
                  </span>
                </div>
                <p className="text-bone-dim text-[0.8125rem]">
                  {formatDate(session.startedAt ?? session.scheduledAt)} · {sessionSubtitle(session)} ·{' '}
                  {playerCount} {sklonIgralci(playerCount)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
