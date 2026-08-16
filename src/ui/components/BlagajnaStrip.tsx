import { useEffect, useRef, useState } from 'react'
import type { Cents } from '../../domain/money.ts'
import { formatEur } from '../../domain/money.ts'

interface BlagajnaStripProps {
  /**
   * Σ P − Σ že izplačano — koliko denarja naj bi bilo v blagajni ZDAJ.
   * Predčasni odhodi (glej OdhodSheet) denar fizično vzamejo iz blagajne,
   * zato golo Σ P od prvega takega odhoda naprej ne bi bilo več res.
   */
  boxCents: Cents
  playerCount: number
  buyInCount: number
  /** Koliko od tega je na kredo — torej koliko denarja fizično MANJKA. */
  creditCents: Cents
  /** Σ že izplačanega med sejo — razloži, zakaj je zgornja številka manjša od Σ P. */
  paidOutCents: Cents
}

/**
 * Junak zaslona: koliko denarja mora biti v blagajni.
 *
 * To je edina številka, zaradi katere aplikacija sploh obstaja. Težava, ki jo
 * rešuje, je "blagajna se ob koncu ne izide" — in edini način, da se to odkrije
 * pravočasno, je, da je vrednost ves čas pred očmi, ne šele ob zaključku.
 *
 * Medenina je rezervirana za ta element. Nikjer drugje v aplikaciji je ni.
 */
export function BlagajnaStrip({
  boxCents,
  playerCount,
  buyInCount,
  creditCents,
  paidOutCents,
}: BlagajnaStripProps) {
  const [ticking, setTicking] = useState(false)
  const previous = useRef(boxCents)

  useEffect(() => {
    if (previous.current === boxCents) return
    previous.current = boxCents
    setTicking(true)
    const t = setTimeout(() => setTicking(false), 200)
    return () => clearTimeout(t)
  }, [boxCents])

  return (
    <section
      className="px-5 pt-4 pb-3"
      aria-label="Stanje blagajne"
    >
      <p className="eyebrow">V blagajni naj bo</p>

      <p
        key={boxCents}
        className={`num text-brass mt-1 text-[2.75rem] leading-none font-semibold ${
          ticking ? 'drawer-tick' : ''
        }`}
        style={{ fontStretch: '112%' }}
      >
        {formatEur(boxCents)}
      </p>

      <div className="drawer-edge mt-3" />

      <p className="text-bone-dim mt-2 text-[0.8125rem]">
        {playerCount} {sklonIgralci(playerCount)} · {buyInCount} {sklonBuyIn(buyInCount)}
        {creditCents > 0 && (
          <>
            {' · '}
            <span className="text-oxblood">na kredo {formatEur(creditCents)}</span>
          </>
        )}
        {paidOutCents > 0 && (
          <>
            {' · '}
            <span>izplačano {formatEur(paidOutCents)}</span>
          </>
        )}
      </p>
    </section>
  )
}

/* Slovenska dvojina — "2 igralca" ni isto kot "2 igralcev". Napačen sklon
   takoj izda, da je aplikacija prevedena in ne napisana. */
function sklonIgralci(n: number): string {
  const r = n % 100
  if (r === 1) return 'igralec'
  if (r === 2) return 'igralca'
  if (r === 3 || r === 4) return 'igralci'
  return 'igralcev'
}

function sklonBuyIn(n: number): string {
  const r = n % 100
  if (r === 1) return 'buy-in'
  if (r === 2) return 'buy-ina'
  if (r === 3 || r === 4) return 'buy-ini'
  return 'buy-inov'
}
