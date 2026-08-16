import { describe, expect, it } from 'vitest'
import {
  formatBuyInConfirmationPrompt,
  formatBuyInPosted,
  formatCurrentStandings,
  formatFinalStandings,
  formatOpenDebtReminder,
  formatSessionStarted,
} from './formatters.ts'

describe('formatters', () => {
  it('formatBuyInConfirmationPrompt matches the exact wording from the spec', () => {
    expect(formatBuyInConfirmationPrompt(2000, 'gotovina')).toBe('Zabeležen je tvoj buy-in 20,00 € (gotovina). Potrdi?')
  })

  it('formatBuyInPosted announces a recorded buy-in to the group', () => {
    expect(formatBuyInPosted('zabelezen', 'Miha', 'buyin', 2000, 'gotovina')).toBe(
      'Miha: buy-in 20,00 € (gotovina)',
    )
  })

  it('formatBuyInPosted uses the correct English poker term per kind', () => {
    expect(formatBuyInPosted('zabelezen', 'Ana', 'rebuy', 1500, 'nakazilo')).toBe(
      'Ana: rebuy 15,00 € (nakazilo)',
    )
    expect(formatBuyInPosted('zabelezen', 'Bine', 'addon', 1000, 'kredo')).toBe(
      'Bine: add-on 10,00 € (kredo)',
    )
  })

  it('formatBuyInPosted marks a voided/corrected buy-in distinctly, so the group is never left with a stale message', () => {
    const posted = formatBuyInPosted('zabelezen', 'Miha', 'buyin', 2000, 'gotovina')
    const voided = formatBuyInPosted('preklican', 'Miha', 'buyin', 2000, 'gotovina')
    expect(voided).not.toBe(posted)
    expect(voided).toBe('Miha: buy-in 20,00 € (gotovina) — preklican')
  })

  it('formatSessionStarted includes name and location when present', () => {
    const text = formatSessionStarted({ name: 'Petkova seja', location: 'Jakov dom' })
    expect(text).toContain('Petkova seja')
    expect(text).toContain('Jakov dom')
  })

  it('formatSessionStarted omits missing fields gracefully', () => {
    const text = formatSessionStarted({ name: null, location: null })
    expect(text).not.toContain('null')
  })

  it('formatCurrentStandings lists every player and the box total', () => {
    const text = formatCurrentStandings(
      [
        { name: 'Ana', takenCents: 2000, paidCents: 2000 },
        { name: 'Bine', takenCents: 3000, paidCents: 0 },
      ],
      2000,
    )
    expect(text).toContain('Ana')
    expect(text).toContain('Bine')
    expect(text).toContain('20,00 €')
    expect(text).toContain('V blagajni naj bo: 20,00 €')
  })

  it('formatFinalStandings shows signed net/payout and the settlement plan', () => {
    const text = formatFinalStandings(
      [
        { name: 'Ana', netCents: 3000, payoutCents: 5000 },
        { name: 'Bine', netCents: -3000, payoutCents: -3000 },
      ],
      [{ fromName: 'Bine', toName: 'Ana', amountCents: 3000 }],
      2000,
    )
    expect(text).toContain('+30,00 €')
    expect(text).toContain('−30,00 €')
    expect(text).toContain('Bine → Ana: 30,00 €')
  })

  it('formatOpenDebtReminder uses correct Slovenian plural forms', () => {
    expect(formatOpenDebtReminder([])).toBe('Ni odprtih dolgov.')
    expect(formatOpenDebtReminder([{ debtorName: 'A', creditorName: 'B', remainingCents: 100 }])).toContain('1 odprt dolg')
    expect(
      formatOpenDebtReminder([
        { debtorName: 'A', creditorName: 'B', remainingCents: 100 },
        { debtorName: 'C', creditorName: 'D', remainingCents: 100 },
      ]),
    ).toContain('2 odprta dolgova')
    expect(
      formatOpenDebtReminder(
        Array.from({ length: 3 }, (_, i) => ({ debtorName: `P${i}`, creditorName: null, remainingCents: 100 })),
      ),
    ).toContain('3 odprti dolgovi')
    expect(
      formatOpenDebtReminder(
        Array.from({ length: 5 }, (_, i) => ({ debtorName: `P${i}`, creditorName: null, remainingCents: 100 })),
      ),
    ).toContain('5 odprtih dolgov')
  })
})
