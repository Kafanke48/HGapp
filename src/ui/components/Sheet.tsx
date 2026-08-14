import { useEffect, useRef, type ReactNode } from 'react'

interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

/**
 * Osnovna lupina spodnjega lista (bottom sheet). Ena implementacija za
 * BuyInSheet in za potrditev zaključka seje — isto obnašanje povsod: Escape
 * zapre, tap zunaj zapre, spodaj upošteva varno območje iPhona.
 */
export function Sheet({ open, onClose, title, children }: SheetProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Zapri"
        className="bg-night/70 absolute inset-0"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="safe-bottom border-line bg-surface relative max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t px-5 pt-4 outline-none"
      >
        <div className="bg-line mx-auto mb-3 h-1 w-10 rounded-full" aria-hidden="true" />
        <h2 className="text-bone text-base font-semibold">{title}</h2>
        <div className="mt-4 pb-2">{children}</div>
      </div>
    </div>
  )
}
