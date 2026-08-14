import { useEffect, useRef, useState } from 'react'
import { db } from '../../db/schema.ts'
import { addSessionPlayer, createPlayer, createSession, transitionSessionStatus } from '../../db/repositories/index.ts'
import type { CashoutMode } from '../../db/types.ts'
import type { SettlementMode } from '../../domain/settlement/types.ts'
import { formatEur, parseEurToCents } from '../../domain/money.ts'
import { usePlayers } from '../hooks/usePlayers.ts'
import { useSettings } from '../hooks/useSettings.ts'
import { Button } from '../components/Button.tsx'

interface NovaSejaScreenProps {
  onCreated: (sessionId: string) => void
  onNazaj: () => void
}

function fieldClass(): string {
  return 'border-line bg-surface text-bone mt-1.5 min-h-11 w-full rounded-lg border px-3 text-[0.9375rem]'
}

function toggleClass(selected: boolean): string {
  return `border-line min-h-11 flex-1 rounded-lg border px-3 text-sm font-medium ${
    selected ? 'bg-raised text-bone' : 'bg-surface text-bone-dim'
  }`
}

/**
 * Nova seja. En zaslon, en izhod: ustvari sejo, doda izbrane igralce in jo
 * takoj prestavi v 'aktivna' — nihče ne želi dodatnega koraka med pripravo mize.
 */
export function NovaSejaScreen({ onCreated, onNazaj }: NovaSejaScreenProps) {
  const players = usePlayers()
  const settings = useSettings()

  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [blindsLabel, setBlindsLabel] = useState('')
  const [defaultBuyInInput, setDefaultBuyInInput] = useState('')
  const [cashoutMode, setCashoutMode] = useState<CashoutMode>('eur')
  const [settlementMode, setSettlementMode] = useState<SettlementMode>('blagajna')
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<string>>(new Set())
  const [newPlayerName, setNewPlayerName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Prvič, ko se nastavitve naložijo, predizpolni privzeti buy-in — a le enkrat,
  // da kasnejši ponovni izris nastavitev ne prepiše tega, kar je uporabnik vtipkal.
  const defaultsApplied = useRef(false)
  useEffect(() => {
    if (settings && !defaultsApplied.current) {
      setDefaultBuyInInput(formatEur(settings.defaultBuyInCents))
      defaultsApplied.current = true
    }
  }, [settings])

  function togglePlayer(id: string) {
    setSelectedPlayerIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleAddPlayer() {
    const trimmed = newPlayerName.trim()
    if (trimmed === '') return
    const player = await createPlayer(db, { name: trimmed })
    setSelectedPlayerIds((prev) => new Set(prev).add(player.id))
    setNewPlayerName('')
  }

  async function handleSubmit() {
    setError(null)

    const defaultBuyInCents = parseEurToCents(defaultBuyInInput)
    if (defaultBuyInCents === null || defaultBuyInCents <= 0) {
      setError('Vnesi veljaven privzeti buy-in, npr. 20,00.')
      return
    }
    if (selectedPlayerIds.size === 0) {
      setError('Izberi vsaj enega igralca, da lahko začneš sejo.')
      return
    }

    setSubmitting(true)
    try {
      const session = await createSession(db, {
        name: name.trim() === '' ? null : name.trim(),
        location: location.trim() === '' ? null : location.trim(),
        blindsLabel: blindsLabel.trim() === '' ? null : blindsLabel.trim(),
        defaultBuyInCents,
        cashoutMode,
        chipDenominations: cashoutMode === 'zetoni' ? (settings?.defaultChipDenominations ?? []) : [],
        settlementMode,
      })
      let seatOrder = 0
      for (const playerId of selectedPlayerIds) {
        await addSessionPlayer(db, session.id, playerId, seatOrder)
        seatOrder += 1
      }
      await transitionSessionStatus(db, session.id, 'aktivna')
      onCreated(session.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Seje ni bilo mogoče ustvariti. Poskusi znova.')
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col px-5 pt-2 pb-6">
      <header className="flex items-center gap-3 py-3">
        <button
          type="button"
          onClick={onNazaj}
          aria-label="Nazaj"
          className="text-bone-dim -ml-2 flex h-11 w-11 items-center justify-center"
        >
          <BackIcon />
        </button>
        <h1 className="text-bone text-xl font-semibold">Nova seja</h1>
      </header>

      <div className="space-y-5">
        <div>
          <label htmlFor="seja-ime" className="eyebrow">
            Ime seje (neobvezno)
          </label>
          <input
            id="seja-ime"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="npr. Petkova seja"
            className={fieldClass()}
          />
        </div>

        <div>
          <label htmlFor="seja-lokacija" className="eyebrow">
            Lokacija (neobvezno)
          </label>
          <input
            id="seja-lokacija"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="npr. pri Jaki"
            className={fieldClass()}
          />
        </div>

        <div>
          <label htmlFor="seja-blindi" className="eyebrow">
            Blindi (neobvezno)
          </label>
          <input
            id="seja-blindi"
            type="text"
            value={blindsLabel}
            onChange={(e) => setBlindsLabel(e.target.value)}
            placeholder="npr. 0,10/0,25"
            className={fieldClass()}
          />
        </div>

        <div>
          <label htmlFor="seja-buyin" className="eyebrow">
            Privzeti buy-in
          </label>
          <input
            id="seja-buyin"
            type="text"
            inputMode="decimal"
            value={defaultBuyInInput}
            onChange={(e) => setDefaultBuyInInput(e.target.value)}
            placeholder="20,00 €"
            className={`num ${fieldClass()}`}
          />
        </div>

        <div>
          <p className="eyebrow">Cashout</p>
          <div className="mt-1.5 flex gap-2">
            <button
              type="button"
              aria-pressed={cashoutMode === 'eur'}
              onClick={() => setCashoutMode('eur')}
              className={toggleClass(cashoutMode === 'eur')}
            >
              v evrih
            </button>
            <button
              type="button"
              aria-pressed={cashoutMode === 'zetoni'}
              onClick={() => setCashoutMode('zetoni')}
              className={toggleClass(cashoutMode === 'zetoni')}
            >
              po barvah žetonov
            </button>
          </div>
        </div>

        <div>
          <p className="eyebrow">Poravnava</p>
          <div className="mt-1.5 flex gap-2">
            <button
              type="button"
              aria-pressed={settlementMode === 'blagajna'}
              onClick={() => setSettlementMode('blagajna')}
              className={toggleClass(settlementMode === 'blagajna')}
            >
              Blagajna
            </button>
            <button
              type="button"
              aria-pressed={settlementMode === 'p2p'}
              onClick={() => setSettlementMode('p2p')}
              className={toggleClass(settlementMode === 'p2p')}
            >
              Med igralci (P2P)
            </button>
          </div>
        </div>

        <div>
          <p className="eyebrow">Igralci</p>
          <div className="mt-1.5 space-y-1.5">
            {(players ?? []).map((player) => {
              const selected = selectedPlayerIds.has(player.id)
              return (
                <button
                  key={player.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => togglePlayer(player.id)}
                  className={`border-line flex min-h-11 w-full items-center justify-between rounded-lg border px-3 text-left text-[0.9375rem] ${
                    selected ? 'bg-raised text-bone' : 'bg-surface text-bone-dim'
                  }`}
                >
                  <span>{player.name}</span>
                  {selected && <CheckIcon />}
                </button>
              )
            })}
          </div>

          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={newPlayerName}
              onChange={(e) => setNewPlayerName(e.target.value)}
              placeholder="Dodaj igralca"
              aria-label="Ime novega igralca"
              className={`${fieldClass()} mt-0 flex-1`}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAddPlayer()
              }}
            />
            <Button onClick={() => void handleAddPlayer()} disabled={newPlayerName.trim() === ''}>
              Dodaj
            </Button>
          </div>
        </div>

        {error && <p className="text-oxblood text-[0.8125rem]">{error}</p>}

        <Button fullWidth size="large" onClick={() => void handleSubmit()} disabled={submitting}>
          Ustvari sejo in začni
        </Button>
      </div>
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

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="M4 12l5 5L20 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
