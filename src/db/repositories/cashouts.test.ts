import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HGappDB } from '../schema.ts'
import type { ChipDenomination } from '../types.ts'
import { chipCountsToCents } from '../../domain/chips.ts'
import { createSession, addSessionPlayer } from './sessions.ts'
import { createPlayer } from './players.ts'
import { setCashout } from './cashouts.ts'

const DENOMINATIONS: ChipDenomination[] = [
  { label: 'bela', colorHex: '#f8fafc', cents: 10 },
  { label: 'rdeča', colorHex: '#ef4444', cents: 25 },
  { label: 'zelena', colorHex: '#22c55e', cents: 100 },
]

describe('cashouts', () => {
  let db: HGappDB

  beforeEach(() => {
    db = new HGappDB('test-cashouts-' + crypto.randomUUID())
  })

  afterEach(async () => {
    await db.delete()
  })

  it('setCashout stores the entered amount directly in eur mode', async () => {
    const session = await createSession(db, { defaultBuyInCents: 2000, cashoutMode: 'eur' })
    const player = await createPlayer(db, { name: 'Ana' })
    const sessionPlayer = await addSessionPlayer(db, session.id, player.id, 0)

    const updated = await setCashout(db, sessionPlayer.id, 4750)

    expect(updated.cashoutCents).toBe(4750)
    expect(updated.cashoutChipCounts).toBeNull()
  })

  it('in zetoni mode, the stored cashoutCents matches chipCountsToCents for the same counts', async () => {
    const session = await createSession(db, {
      defaultBuyInCents: 2000,
      cashoutMode: 'zetoni',
      chipDenominations: DENOMINATIONS,
    })
    const player = await createPlayer(db, { name: 'Bine' })
    const sessionPlayer = await addSessionPlayer(db, session.id, player.id, 0)

    const chipCounts = { bela: 5, rdeča: 4, zelena: 2 } // 5*10 + 4*25 + 2*100 = 350 centov
    const expectedCents = chipCountsToCents(chipCounts, DENOMINATIONS)

    const updated = await setCashout(db, sessionPlayer.id, expectedCents, chipCounts)

    expect(updated.cashoutCents).toBe(expectedCents)
    expect(updated.cashoutChipCounts).toEqual(chipCounts)
  })

  it('overwriting an existing cashout bumps the version and audits the change', async () => {
    const session = await createSession(db, { defaultBuyInCents: 2000, cashoutMode: 'eur' })
    const player = await createPlayer(db, { name: 'Ciril' })
    const sessionPlayer = await addSessionPlayer(db, session.id, player.id, 0)

    const first = await setCashout(db, sessionPlayer.id, 3000)
    expect(first.version).toBe(2) // addSessionPlayer ustvari z version 1, setCashout ga poveča

    const entriesBeforeSecond = await db.audit.where('entityId').equals(sessionPlayer.id).toArray()

    const second = await setCashout(db, sessionPlayer.id, 5500)
    expect(second.version).toBe(3)
    expect(second.cashoutCents).toBe(5500)

    // Poiščemo natanko tisti revizijski zapis, ki ga je dodal drugi klic — ne
    // zanašamo se na razvrščanje po `createdAt`, ker imata lahko dva hitro
    // zaporedna klica isti milisekundni žig.
    const entriesAfterSecond = await db.audit.where('entityId').equals(sessionPlayer.id).toArray()
    const beforeIds = new Set(entriesBeforeSecond.map((e) => e.id))
    const newEntries = entriesAfterSecond.filter((e) => !beforeIds.has(e.id))
    expect(newEntries).toHaveLength(1)

    const lastEntry = newEntries[0]!
    expect(lastEntry.action).toBe('update')
    expect((lastEntry.before as { cashoutCents: number | null }).cashoutCents).toBe(3000)
    expect((lastEntry.after as { cashoutCents: number | null }).cashoutCents).toBe(5500)
  })
})
