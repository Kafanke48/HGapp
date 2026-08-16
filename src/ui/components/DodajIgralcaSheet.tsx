import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/schema.ts'
import { addSessionPlayer, createPlayer, listPlayers } from '../../db/repositories/index.ts'
import type { Player } from '../../db/types.ts'
import { Sheet } from './Sheet.tsx'
import { Button } from './Button.tsx'

export interface DodajIgralcaSheetProps {
  open: boolean
  sessionId: string
  /** playerId vseh, ki že sedijo v tej seji — izločimo jih iz seznama za posesti. */
  seatedPlayerIds: readonly string[]
  /** Naslednji prosti seatOrder (glej addSessionPlayer). */
  nextSeatOrder: number
  onClose: () => void
}

/**
 * Dodajanje igralca sredi seje — "vsak lahko pride kadarkoli" (lastnikove
 * besede). Nov ali obstoječi igralec se posede z `addSessionPlayer` in od
 * takoj naprej obnaša popolnoma enako kot vsak drug igralec seje — brez
 * posebne obravnave (glej nalogo, razdelek 1).
 */
export function DodajIgralcaSheet({
  open,
  sessionId,
  seatedPlayerIds,
  nextSeatOrder,
  onClose,
}: DodajIgralcaSheetProps) {
  // Branje seznama igralcev (read-only) je varno znotraj useLiveQuery — pisanje
  // (createPlayer/addSessionPlayer) gre vedno skozi ločene rokovalnike spodaj.
  const allPlayers = useLiveQuery(() => listPlayers(db), [])
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  // Vsako novo odprtje lista počisti vnos imena — prejšnji poskus ne sme ostati.
  useEffect(() => {
    if (!open) return
    setNewName('')
  }, [open])

  if (allPlayers === undefined) return null

  const seatedSet = new Set(seatedPlayerIds)
  const available = allPlayers.filter((p) => !seatedSet.has(p.id))

  async function handleSeatExisting(player: Player) {
    setBusy(true)
    try {
      await addSessionPlayer(db, sessionId, player.id, nextSeatOrder)
    } finally {
      setBusy(false)
    }
  }

  async function handleCreateAndSeat() {
    const name = newName.trim()
    if (name === '') return
    setBusy(true)
    try {
      const player = await createPlayer(db, { name })
      await addSessionPlayer(db, sessionId, player.id, nextSeatOrder)
      setNewName('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Dodaj igralca">
      <div className="space-y-5">
        <div>
          <label htmlFor="dodaj-igralec-ime" className="eyebrow">
            Nov igralec
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="dodaj-igralec-ime"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ime"
              aria-label="Ime novega igralca"
              className="border-line bg-raised text-bone min-h-11 flex-1 rounded-lg border px-3 text-sm"
            />
            <Button
              variant="primary"
              disabled={newName.trim() === '' || busy}
              onClick={() => void handleCreateAndSeat()}
            >
              Ustvari in posedi
            </Button>
          </div>
        </div>

        <div>
          <p className="eyebrow">Že v seznamu igralcev</p>
          {available.length === 0 ? (
            <p className="text-bone-faint mt-2 text-sm">Vsi znani igralci so že za mizo.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {available.map((player) => (
                <li key={player.id} className="border-line flex items-center justify-between gap-2 rounded-lg border p-2">
                  <span className="text-bone truncate text-sm font-medium">{player.name}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleSeatExisting(player)}
                    aria-label={`Posedi ${player.name} za mizo`}
                    className="bg-raised text-bone min-h-11 shrink-0 rounded-lg px-4 text-sm font-semibold disabled:opacity-40"
                  >
                    Posedi
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Sheet>
  )
}
