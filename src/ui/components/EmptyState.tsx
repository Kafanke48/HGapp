import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
}

/**
 * Prazno stanje, ki vabi k prvi akciji — ne skomigne z rameni (glej pravila copyja).
 * Zato je `action` prvorazreden del komponente, ne poznejši dodatek.
 */
export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      {icon}
      <p className="text-bone text-base font-semibold">{title}</p>
      {description && <p className="text-bone-dim max-w-xs text-sm leading-relaxed">{description}</p>}
      {action}
    </div>
  )
}
