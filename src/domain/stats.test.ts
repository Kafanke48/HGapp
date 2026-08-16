import { describe, it, expect } from 'vitest'
import {
  computePlayerStats,
  computeCumulativeSeries,
  playersInResults,
  type SessionResult,
} from './stats.ts'

describe('prazen vhod', () => {
  it('computePlayerStats([]) vrne prazen seznam', () => {
    expect(computePlayerStats([])).toEqual([])
  })

  it('computeCumulativeSeries([], playerId) vrne prazen seznam', () => {
    expect(computeCumulativeSeries([], 'a')).toEqual([])
  })

  it('playersInResults([]) vrne prazen seznam', () => {
    expect(playersInResults([])).toEqual([])
  })
})

describe('ena sama seja', () => {
  const results: SessionResult[] = [
    { sessionId: 's1', playedAt: 1000, location: 'Ljubljana', netByPlayer: { a: 5000, b: -5000 } },
  ]

  it('computePlayerStats izracuna osnovne vrednosti', () => {
    const stats = computePlayerStats(results)
    expect(stats).toEqual([
      {
        playerId: 'a',
        sessionCount: 1,
        totalNetCents: 5000,
        averageNetCents: 5000,
        bestCents: 5000,
        worstCents: 5000,
        winningSessions: 1,
      },
      {
        playerId: 'b',
        sessionCount: 1,
        totalNetCents: -5000,
        averageNetCents: -5000,
        bestCents: -5000,
        worstCents: -5000,
        winningSessions: 0,
      },
    ])
  })

  it('computeCumulativeSeries vrne eno tocko', () => {
    expect(computeCumulativeSeries(results, 'a')).toEqual([
      { sessionId: 's1', playedAt: 1000, cumulativeCents: 5000 },
    ])
  })

  it('playersInResults vrne oba igralca', () => {
    expect(playersInResults(results)).toEqual(['a', 'b'])
  })
})

describe('igralec, ki je izpustil sejo', () => {
  // b igra samo v s1, c se pridruzi sele v s2 namesto b.
  const results: SessionResult[] = [
    { sessionId: 's1', playedAt: 1000, location: null, netByPlayer: { a: 1000, b: -1000 } },
    { sessionId: 's2', playedAt: 2000, location: null, netByPlayer: { a: -1000, c: 1000 } },
  ]

  it('sessionCount izpuscene seje ne steje', () => {
    const stats = computePlayerStats(results)
    const b = stats.find((s) => s.playerId === 'b')
    expect(b?.sessionCount).toBe(1)

    const a = stats.find((s) => s.playerId === 'a')
    expect(a?.sessionCount).toBe(2)
  })

  it('kumulativna vrsta za b ima samo tocko iz seje, kjer je igral', () => {
    expect(computeCumulativeSeries(results, 'b')).toEqual([
      { sessionId: 's1', playedAt: 1000, cumulativeCents: -1000 },
    ])
  })

  it('kumulativna vrsta za c nima tocke iz s1', () => {
    expect(computeCumulativeSeries(results, 'c')).toEqual([
      { sessionId: 's2', playedAt: 2000, cumulativeCents: 1000 },
    ])
  })
})

describe('urejanje po totalNetCents padajoce, izenacenje po playerId narascajoce', () => {
  const results: SessionResult[] = [
    {
      sessionId: 's1',
      playedAt: 1000,
      location: null,
      netByPlayer: { zoran: 3000, bine: 1000, ana: -2000, cene: -2000 },
    },
  ]

  it('vrstni red je zoran, bine, ana, cene', () => {
    const order = computePlayerStats(results).map((s) => s.playerId)
    // zoran (3000) > bine (1000) > ana/cene izenaceni na -2000, tie-break po playerId: ana < cene
    expect(order).toEqual(['zoran', 'bine', 'ana', 'cene'])
  })
})

describe('averageNetCents zaokrozi proti nic', () => {
  it('negativno povprecje: -100 centov cez 3 seje -> -33 (ne -34)', () => {
    const results: SessionResult[] = [
      { sessionId: 's1', playedAt: 1, location: null, netByPlayer: { p1: -33, sink: 33 } },
      { sessionId: 's2', playedAt: 2, location: null, netByPlayer: { p1: -34, sink: 34 } },
      { sessionId: 's3', playedAt: 3, location: null, netByPlayer: { p1: -33, sink: 33 } },
    ]
    const stats = computePlayerStats(results)
    const p1 = stats.find((s) => s.playerId === 'p1')
    expect(p1?.totalNetCents).toBe(-100)
    expect(p1?.averageNetCents).toBe(-33)
  })

  it('pozitivno povprecje: +100 centov cez 3 seje -> 33 (ne 34)', () => {
    const results: SessionResult[] = [
      { sessionId: 's1', playedAt: 1, location: null, netByPlayer: { p2: 33, sink: -33 } },
      { sessionId: 's2', playedAt: 2, location: null, netByPlayer: { p2: 34, sink: -34 } },
      { sessionId: 's3', playedAt: 3, location: null, netByPlayer: { p2: 33, sink: -33 } },
    ]
    const stats = computePlayerStats(results)
    const p2 = stats.find((s) => s.playerId === 'p2')
    expect(p2?.totalNetCents).toBe(100)
    expect(p2?.averageNetCents).toBe(33)
  })
})

describe('bestCents/worstCents, kadar je vsaka seja izguba', () => {
  const results: SessionResult[] = [
    { sessionId: 's1', playedAt: 1, location: null, netByPlayer: { p3: -50, sink: 50 } },
    { sessionId: 's2', playedAt: 2, location: null, netByPlayer: { p3: -30, sink: 30 } },
    { sessionId: 's3', playedAt: 3, location: null, netByPlayer: { p3: -70, sink: 70 } },
  ]

  it('best je najmanjsa izguba, worst najvecja', () => {
    const stats = computePlayerStats(results)
    const p3 = stats.find((s) => s.playerId === 'p3')
    expect(p3?.bestCents).toBe(-30)
    expect(p3?.worstCents).toBe(-70)
    expect(p3?.winningSessions).toBe(0)
  })
})

describe('winningSessions ne steje nicelnega rezultata', () => {
  const results: SessionResult[] = [
    { sessionId: 's1', playedAt: 1, location: null, netByPlayer: { p4: 0, sink: 0 } },
    { sessionId: 's2', playedAt: 2, location: null, netByPlayer: { p4: 50, sink: -50 } },
    { sessionId: 's3', playedAt: 3, location: null, netByPlayer: { p4: -20, sink: 20 } },
  ]

  it('samo seja z net > 0 se steje kot zmagovalna', () => {
    const stats = computePlayerStats(results)
    const p4 = stats.find((s) => s.playerId === 'p4')
    expect(p4?.winningSessions).toBe(1)
    expect(p4?.sessionCount).toBe(3)
  })
})

describe('kumulativna vrsta je urejena po playedAt, tudi ce vhod ni urejen', () => {
  const results: SessionResult[] = [
    { sessionId: 's3', playedAt: 3000, location: null, netByPlayer: { a: 100 } },
    { sessionId: 's1', playedAt: 1000, location: null, netByPlayer: { a: -50 } },
    { sessionId: 's2', playedAt: 2000, location: null, netByPlayer: { a: 20 } },
  ]

  it('tocke so urejene narascajoce po case, ne po vrstnem redu vhoda', () => {
    expect(computeCumulativeSeries(results, 'a')).toEqual([
      { sessionId: 's1', playedAt: 1000, cumulativeCents: -50 },
      { sessionId: 's2', playedAt: 2000, cumulativeCents: -30 },
      { sessionId: 's3', playedAt: 3000, cumulativeCents: 70 },
    ])
  })
})

describe('neznan playerId', () => {
  const results: SessionResult[] = [
    { sessionId: 's1', playedAt: 1000, location: null, netByPlayer: { a: 100, b: -100 } },
  ]

  it('computeCumulativeSeries za neznanega igralca vrne prazen seznam', () => {
    expect(computeCumulativeSeries(results, 'nihce')).toEqual([])
  })
})
