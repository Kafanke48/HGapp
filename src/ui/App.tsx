import { useEffect, useState } from 'react'
import { InstallGuard } from './InstallGuard.tsx'

export type View = 'domov' | 'seja' | 'zakljucek' | 'zgodovina' | 'dolgovi' | 'nastavitve'

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
  const [view, setView] = useState<View>('domov')
  const [guardPassed, setGuardPassed] = useState<boolean | null>(null)

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    const acknowledged = localStorage.getItem(ACK_KEY) === '1'
    setGuardPassed(standalone || acknowledged)
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

  return (
    <div className="bg-night flex min-h-dvh flex-col">
      <main className="safe-top flex-1">
        {view === 'domov' && <Placeholder title="Seje" />}
        {view === 'seja' && <Placeholder title="Aktivna seja" />}
        {view === 'zakljucek' && <Placeholder title="Zaključek" />}
        {view === 'zgodovina' && <Placeholder title="Zgodovina" />}
        {view === 'dolgovi' && <Placeholder title="Odprti dolgovi" />}
        {view === 'nastavitve' && <Placeholder title="Nastavitve" />}
      </main>

      <TabBar view={view} onChange={setView} />
    </div>
  )
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className="px-5 py-8">
      <h1 className="text-bone text-xl font-semibold">{title}</h1>
      <p className="text-bone-dim mt-2 text-sm">Se pripravlja.</p>
    </div>
  )
}

const TABS: { view: View; label: string }[] = [
  { view: 'domov', label: 'Seje' },
  { view: 'zgodovina', label: 'Zgodovina' },
  { view: 'dolgovi', label: 'Dolgovi' },
  { view: 'nastavitve', label: 'Nastavitve' },
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
