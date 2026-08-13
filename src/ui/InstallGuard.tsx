import { useState } from 'react'

interface InstallGuardProps {
  onAcknowledge: () => void
}

/**
 * Ovira, ne namig.
 *
 * WebKit izbriše podatke spletne strani po 7 dneh neuporabe. Aplikacije, dodane
 * na domači zaslon, so iz tega izvzete. Če bi bilo to le odpravljivo obvestilo,
 * bi ga uporabnik zaprl in čez teden izgubil vso zgodovino — zato je tu zaslon,
 * ki ga je treba prebrati in izrecno potrditi.
 *
 * Druga past je manj očitna in prav tako smrtonosna: nameščena aplikacija in
 * Safari zavihek imata LOČENI shrambi. Kar vpišeš v zavihku, se po namestitvi
 * ne pojavi. Zato je to napisano tukaj, ne v dokumentaciji.
 */
export function InstallGuard({ onAcknowledge }: InstallGuardProps) {
  const [confirmed, setConfirmed] = useState(false)

  return (
    <div className="bg-night fixed inset-0 z-50 flex flex-col overflow-y-auto">
      <div className="safe-top safe-bottom mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-10">
        <p className="eyebrow text-oxblood">Preberi, preden začneš</p>

        <h1 className="text-bone mt-3 text-2xl leading-tight font-semibold">
          Dodaj na začetni zaslon, sicer bodo podatki izginili
        </h1>

        <p className="text-bone-dim mt-4 text-[0.9375rem] leading-relaxed">
          iOS po sedmih dneh neuporabe izbriše podatke spletnih strani. Aplikacije, dodane na
          začetni zaslon, so izvzete — zato mora HGapp tam živeti, ne v zavihku.
        </p>

        <ol className="mt-6 space-y-3">
          {[
            ['Pritisni gumb za deljenje', 'Kvadratek s puščico navzgor, na dnu Safarija.'],
            ['Izberi „Na začetni zaslon“', 'Morda je treba seznam malo podrsati navzgor.'],
            ['Odpri HGapp z ikone', 'Od zdaj naprej vedno od tam, ne iz Safarija.'],
          ].map(([title, detail], i) => (
            <li key={i} className="flex gap-3">
              <span className="num text-brass mt-0.5 text-sm tabular-nums">{i + 1}</span>
              <span>
                <span className="text-bone block text-[0.9375rem] font-medium">{title}</span>
                <span className="text-bone-dim block text-[0.8125rem]">{detail}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="border-oxblood/40 bg-oxblood/10 mt-6 rounded-xl border p-4">
          <p className="text-bone text-[0.8125rem] leading-relaxed">
            <strong className="font-semibold">Ne vpisuj podatkov tukaj v zavihku.</strong> Nameščena
            aplikacija ima svojo, ločeno shrambo — kar vpišeš zdaj, se po namestitvi ne bo pojavilo.
          </p>
        </div>

        <label className="mt-6 flex items-start gap-3">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="accent-brass mt-0.5 size-5 flex-none"
          />
          <span className="text-bone-dim text-[0.875rem]">
            Razumem. Aplikacijo bom odpiral z začetnega zaslona.
          </span>
        </label>

        <button
          type="button"
          disabled={!confirmed}
          onClick={onAcknowledge}
          className="bg-brass text-night mt-5 rounded-xl px-5 py-3.5 text-[0.9375rem] font-semibold disabled:opacity-30"
        >
          Nadaljuj
        </button>
      </div>
    </div>
  )
}
