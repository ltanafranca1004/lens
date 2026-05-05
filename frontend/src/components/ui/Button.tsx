import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'ghost' | 'outline' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
  primary:
    'bg-ink text-paper hover:bg-ink-2 disabled:bg-ink-mute disabled:cursor-not-allowed',
  outline:
    'border border-ink text-ink hover:bg-ink hover:text-paper disabled:opacity-40 disabled:cursor-not-allowed',
  ghost:
    'text-ink hover:bg-rule-soft disabled:opacity-40 disabled:cursor-not-allowed',
  danger:
    'border border-danger text-danger hover:bg-danger hover:text-paper disabled:opacity-40',
}

const sizes: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-[0.78rem]',
  md: 'px-5 py-2.5 text-sm',
  lg: 'px-7 py-3.5 text-base',
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
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 font-mono uppercase tracking-[0.14em] cursor-pointer rounded-xs ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {loading ? <span className="opacity-70">…</span> : children}
    </button>
  )
}
