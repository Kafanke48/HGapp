import type { Cents } from '../../domain/money.ts'
import { formatEur, formatEurSigned } from '../../domain/money.ts'

interface MoneyProps {
  cents: Cents
  /** Prikaži predznak + pri pozitivnih vrednostih (za saldo, ne za vsote). */
  signed?: boolean
  /** Obarvaj glede na predznak. Za nevtralne vsote pusti izklopljeno. */
  colored?: boolean
  className?: string
}

/**
 * Denarni znesek. Vedno tabelarne števke, da se stolpci poravnajo po vejici.
 *
 * Nula je namenoma NEVTRALNA barva tudi pri `colored` — zelena nula bi bralcu
 * sporočala dobiček, ki ga ni.
 */
export function Money({ cents, signed = false, colored = false, className = '' }: MoneyProps) {
  const tone = !colored || cents === 0 ? '' : cents > 0 ? 'text-jade' : 'text-oxblood'
  return (
    <span className={`num ${tone} ${className}`.trim()}>
      {signed ? formatEurSigned(cents) : formatEur(cents)}
    </span>
  )
}
