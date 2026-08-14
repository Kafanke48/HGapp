import { useState } from 'react'
import { db } from '../../db/schema.ts'
import { archivePlayer, createPlayer, unarchivePlayer, updatePlayer } from '../../db/repositories/index.ts'
import type { Player } from '../../db/types.ts'
import { usePlayers } from '../hooks/usePlayers.ts'
import { Button } from '../components/Button.tsx'
import { EmptyState } from '../components/EmptyState.tsx'

function fieldClass(): string {
  return 'border-line bg-surface text-bone min-h-11 w-full rounded-lg border px-3 text-[0.9375rem]'
}

/**
 * Upravljanje igralcev. Arhiviranje je edino "brisanje" — vrstica ostane
 * (glej spec 10, pravilo db/types.ts), zato ima svoj preklopni pogled.
 */
export function IgralciScreen() {
  const [showArchived, setShowArchived] = useState(false)
  const players = usePlayers(showArchived)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  async function handleAdd() {
    const trimmed = newName.trim()
    if (trimmed === '') return
    await createPlayer(db, { name: trimmed })
    setNewName('')
  }

  function startRename(player: Player) {
    setEditingId(player.id)
    setEditValue(player.name)
  }

  async function saveRename() {
    const trimmed = editValue.trim()
    if (editingId && trimmed !== '') {
      await updatePlayer(db, editingId, { name: trimmed })
    }
    setEditingId(null)
  }

  // usePlayers(showArchived) že filtrira na nivoju baze (glej listPlayers) — tu ni treba podvajati.
  const visible = players ?? []

  return (
    <div className="flex min-h-full flex-col px-5 pt-2 pb-6">
      <header className="flex items-center justify-between py-3">
        <h1 className="text-bone text-xl font-semibold">Igralci</h1>
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          aria-pressed={showArchived}
          className="text-bone-dim min-h-11 px-2 text-[0.8125rem] font-medium"
        >
          {showArchived ? 'Skrij arhivirane' : 'Prikaži arhivirane'}
        </button>
      </header>

      <div className="mb-4 flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Ime novega igralca"
          aria-label="Ime novega igralca"
          className={fieldClass()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleAdd()
          }}
        />
        <Button onClick={() => void handleAdd()} disabled={newName.trim() === ''}>
          Dodaj
        </Button>
      </div>

      {visible.length === 0 && (
        <EmptyState
          title="Še ni igralcev"
          description="Dodaj prvega igralca zgoraj — od tam ga lahko takoj povabiš v sejo."
        />
      )}

      {visible.length > 0 && (
        <ul className="space-y-2">
          {visible.map((player) => (
            <li key={player.id} className="tile flex items-center justify-between gap-2 px-3.5">
              {editingId === player.id ? (
                <input
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveRename()
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  autoFocus
                  aria-label={`Novo ime za ${player.name}`}
                  className={fieldClass()}
                />
              ) : (
                <span className={`truncate text-[0.9375rem] font-medium ${player.archived ? 'text-bone-faint' : 'text-bone'}`}>
                  {player.name}
                  {player.archived && ' (arhiviran)'}
                </span>
              )}

              <div className="flex shrink-0 gap-2">
                {editingId === player.id ? (
                  <Button onClick={() => void saveRename()}>Shrani</Button>
                ) : (
                  <Button onClick={() => startRename(player)}>Preimenuj</Button>
                )}
                {player.archived ? (
                  <Button onClick={() => void unarchivePlayer(db, player.id)}>Obnovi</Button>
                ) : (
                  <Button variant="danger" onClick={() => void archivePlayer(db, player.id)}>
                    Arhiviraj
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
