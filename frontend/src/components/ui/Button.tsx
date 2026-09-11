import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'ghost' | 'outline' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-ink hover:brightness-125 disabled:opacity-45 disabled:cursor-not-allowed',
  outline:
    'border border-ink/25 text-ink hover:border-ink/50 disabled:opacity-40 disabled:cursor-not-allowed',
  // A quiet, link-styled action — the design's "Skip this one" / "← back" treatment.
  ghost:
    'text-link hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed',
  danger:
    'border border-[oklch(0.55_0.14_25)] text-[oklch(0.5_0.14_25)] hover:bg-[oklch(0.55_0.14_25)] hover:text-paper disabled:opacity-40',
}

const sizes: Record<Size, string> = {
  sm: 'text-[0.82rem] gap-1.5',
  md: 'text-sm gap-2',
  lg: 'text-[0.95rem] gap-2',
}

// Solid variants get real padding; the link-style ghost sits inline with no box.
const boxPad: Record<Size, string> = {
  sm: 'px-3.5 py-2',
  md: 'px-5 py-2.5',
  lg: 'px-6 py-3',
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  loading?: boolean
  children: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  children,
  className = '',
  ...rest
}: Props) {
  const boxed = variant !== 'ghost'
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-medium cursor-pointer rounded-xs ${
        boxed ? boxPad[size] : ''
      } ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {loading ? <span className="opacity-70">Working…</span> : children}
    </button>
  )
}
