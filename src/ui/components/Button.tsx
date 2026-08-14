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
  // Medenina je rezervirana IZKLJUČNO za blagajnino številko (BlagajnaStrip
  // in cifra v PoravnavaScreen) — zato tudi "primary" gumb uporablja kost
  // (bone), sicer bi velike medeninaste površine na navadnih gumbih
  // tekmovale z blagajno za pozornost (glej fix 4 v pregledu UI).
  primary: 'bg-bone text-night',
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
 * Noben variant tega gumba ne uporablja medenine — ta je rezervirana
 * izključno za blagajnino številko. `variant="primary"` je zato kost (bone),
 * enako opazna, a brez tekmovanja z blagajno za pozornost.
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
