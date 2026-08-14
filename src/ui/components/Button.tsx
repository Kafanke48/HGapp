import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'default' | 'danger' | 'ghost'
export type ButtonSize = 'default' | 'large'

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children' | 'type'> {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  className?: string
  children: ReactNode
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  // Medenina je rezervirana za blagajno IN natanko en gumb v celi aplikaciji.
  primary: 'bg-brass text-night',
  default: 'bg-raised text-bone border border-line',
  danger: 'bg-surface text-oxblood border border-oxblood/50',
  ghost: 'text-bone-dim',
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  // 44px — najmanjša tarča za palec povsod v aplikaciji.
  default: 'min-h-11 px-4 text-[0.9375rem]',
  // 88px — glavne tarče med igro (glej PlayerTile.tile).
  large: 'min-h-[88px] px-6 text-base',
}

/**
 * Edini gumb v aplikaciji.
 *
 * `variant="primary"` (medenina) sme biti uporabljen SAMO na enem mestu v celi
 * aplikaciji — na "Nova seja" v SejeScreen. Glej oblikovna pravila: zadržanost
 * pri medenini je bistvo palete, zato je ne uporabljaj nikjer drugje.
 */
export function Button({
  variant = 'default',
  size = 'default',
  fullWidth = false,
  className = '',
  disabled = false,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type="button"
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-xl font-semibold transition-transform active:scale-[0.97] disabled:opacity-40 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${fullWidth ? 'w-full' : ''} ${className}`.trim()}
    >
      {children}
    </button>
  )
}
