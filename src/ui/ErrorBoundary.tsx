import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Klic za vrnitev na varen zaslon. */
  onReset: () => void
}

interface State {
  error: Error | null
}

/**
 * Prestreže napako v katerem koli zaslonu.
 *
 * Brez tega React ob napaki odstrani celotno drevo in ostane BEL ZASLON brez
 * izhoda. Sredi seje, ko so za mizo ljudje in teče denar, je to najslabši
 * možen izid — zato mora biti tu vedno pot naprej.
 *
 * Podatki so v IndexedDB in napaka v vmesniku jih ne more pokvariti, kar je
 * prva stvar, ki jo mora uporabnik izvedeti.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Napaka v vmesniku:', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="bg-night safe-top safe-bottom flex min-h-dvh flex-col justify-center px-6">
        <p className="eyebrow text-oxblood">Nekaj je šlo narobe</p>

        <h1 className="text-bone mt-3 text-xl leading-tight font-semibold">
          Zaslona ni bilo mogoče prikazati
        </h1>

        <p className="text-bone-dim mt-3 text-[0.9375rem] leading-relaxed">
          Tvoji podatki so shranjeni in nedotaknjeni — napaka je samo v prikazu. Vrni se na seznam
          sej in poskusi znova.
        </p>

        <pre
          data-selectable
          className="border-line bg-surface text-bone-dim mt-5 max-h-40 overflow-auto rounded-xl border p-3 text-[0.6875rem] whitespace-pre-wrap"
        >
          {error.message}
        </pre>

        <button
          type="button"
          onClick={() => {
            this.setState({ error: null })
            this.props.onReset()
          }}
          className="bg-brass text-night mt-5 rounded-xl px-5 py-3.5 text-[0.9375rem] font-semibold"
        >
          Nazaj na seje
        </button>

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="border-line text-bone mt-3 rounded-xl border px-5 py-3.5 text-[0.9375rem] font-medium"
        >
          Znova naloži aplikacijo
        </button>
      </div>
    )
  }
}
