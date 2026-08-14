import { useEffect, useState } from 'react'
import { InstallGuard } from './InstallGuard.tsx'
import { requestPersistentStorage } from '../platform/index.ts'
import { db } from '../db/schema.ts'
import { getSettings } from '../db/repositories/index.ts'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { SejeScreen } from './screens/SejeScreen.tsx'
import { NovaSejaScreen } from './screens/NovaSejaScreen.tsx'
import { AktivnaSejaScreen } from './screens/AktivnaSejaScreen.tsx'
import { IgralciScreen } from './screens/IgralciScreen.tsx'
import { ZakljucekScreen } from './screens/ZakljucekScreen.tsx'
import { PoravnavaScreen } from './screens/PoravnavaScreen.tsx'

export type View = 'seje' | 'nova-seja' | 'aktivna' | 'zakljucek' | 'poravnava' | 'igralci'

/** Med temi pogledi je tabvrstica skrita — so osredotočeni, celozaslonski tokovi (glej spec 6). */
const FOCUSED_VIEWS: readonly View[] = ['aktivna', 'zakljucek', 'poravnava']

const ACK_KEY = 'hgapp.installGuardAcknowledged'

/**
 * Lupina aplikacije.
 *
 * Namerno BREZ routerja: ena stran, preklop pogledov s stanjem. Na GitHub Pages
 * pod podpotjo (/HGapp/) je usmerjanje po URL-jih pogost vir okvar — 404 na
 * osveži, napačna osnovna pot, zlomljen deep link. Aplikacija za eno osebo
 * tega ne potrebuje.
 */
export function App() {
  const [view, setView] = useState<View>('seje')
  // Seja, na katero se nanašajo aktivna/zakljucek/poravnava. Ločeno od `view`,
  // da se pogled in identiteta seje ne moreta razsinhronizirati.
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [guardPassed, setGuardPassed] = useState<boolean | null>(null)

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    const acknowledged = localStorage.getItem(ACK_KEY) === '1'
    setGuardPassed(standalone || acknowledged)
  }, [])

  useEffect(() => {
    // Sekundarna varovalka pred iOS-ovim brisanjem neaktivne shrambe (glej storage.ts) —
    // enkrat ob zagonu, brez prikaza rezultata uporabniku.
    void requestPersistentStorage()

    // Vrstico nastavitev je treba ustvariti TUKAJ, ob zagonu, in ne v hooku:
    // Dexie znotraj liveQuery ne dovoli pisanja. Hooki berejo z `readSettings`.
    void getSettings(db)
  }, [])

  if (guardPassed === null) return null

  if (!guardPassed) {
    return (
      <InstallGuard
        onAcknowledge={() => {
          localStorage.setItem(ACK_KEY, '1')
          setGuardPassed(true)
        }}
      />
    )
  }

  const showTabBar = !FOCUSED_VIEWS.includes(view)

  return (
    <div className="bg-night flex min-h-dvh flex-col">
      <main className="safe-top flex-1">
        {/* Ključ je `view`: ob menjavi zaslona se varovalka ponastavi, sicer bi
            napaka na enem zaslonu ostala prikazana tudi po vrnitvi drugam. */}
        <ErrorBoundary
          key={view}
          onReset={() => {
            setSessionId(null)
            setView('seje')
          }}
        >
        {view === 'seje' && (
          <SejeScreen
            onNovaSeja={() => setView('nova-seja')}
            onNadaljuj={(id) => {
              setSessionId(id)
              setView('aktivna')
            }}
            onPoravnaj={(id) => {
              // Vedno najprej na vpis končnega stanja: če je že vpisano, se
              // vrednosti prikažejo in gumb "Naprej" je takoj na voljo.
              setSessionId(id)
              setView('zakljucek')
            }}
          />
        )}

        {view === 'nova-seja' && (
          <NovaSejaScreen
            onCreated={(id) => {
              setSessionId(id)
              setView('aktivna')
            }}
            onNazaj={() => setView('seje')}
          />
        )}

        {view === 'aktivna' && sessionId && (
          <AktivnaSejaScreen
            sessionId={sessionId}
            onZakljuceno={() => setView('zakljucek')}
            onNazaj={() => setView('seje')}
          />
        )}

        {view === 'zakljucek' && sessionId && (
          <ZakljucekScreen
            sessionId={sessionId}
            onNaprej={() => setView('poravnava')}
            // Nazaj gre na seznam, ne na aktivno sejo: ta je že zaključena in
            // buy-inov vanjo ni več mogoče beležiti.
            onNazaj={() => setView('seje')}
          />
        )}

        {view === 'poravnava' && sessionId && (
          <PoravnavaScreen
            sessionId={sessionId}
            onKoncano={() => {
              setSessionId(null)
              setView('seje')
            }}
            onNazaj={() => setView('zakljucek')}
          />
        )}

        {view === 'igralci' && <IgralciScreen />}
        </ErrorBoundary>
      </main>

      {showTabBar && <TabBar view={view} onChange={setView} />}
    </div>
  )
}

const TABS: { view: View; label: string }[] = [
  { view: 'seje', label: 'Seje' },
  { view: 'igralci', label: 'Igralci' },
]

function TabBar({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <nav className="border-line bg-surface safe-bottom border-t px-2 pt-1.5">
      <ul className="flex">
        {TABS.map((tab) => (
          <li key={tab.view} className="flex-1">
            <button
              type="button"
              onClick={() => onChange(tab.view)}
              aria-current={view === tab.view ? 'page' : undefined}
              className={`w-full rounded-lg py-2 text-[0.75rem] font-medium ${
                view === tab.view ? 'text-bone' : 'text-bone-faint'
              }`}
            >
              {tab.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
