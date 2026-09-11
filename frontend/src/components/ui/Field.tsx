import type { InputHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react'

type FieldShellProps = {
  label: string
  htmlFor: string
  hint?: string
  error?: string
  children: ReactNode
}

export function FieldShell({ label, htmlFor, hint, error, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="meta">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p className="text-[0.8rem] text-ink/55 leading-snug">{hint}</p>
      )}
      {error && (
        <p className="text-[0.8rem] text-[oklch(0.5_0.14_25)] leading-snug" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  hint?: string
  error?: string
}

export function Input({ label, hint, error, id, className = '', ...rest }: InputProps) {
  const inputId = id ?? `i-${label.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <FieldShell label={label} htmlFor={inputId} hint={hint} error={error}>
      <input
        id={inputId}
        {...rest}
        aria-invalid={error ? true : undefined}
        className={`bg-transparent border-b border-ink/25 focus:border-link focus:outline-none py-2 text-base text-ink placeholder:text-ink/40 ${className}`}
      />
    </FieldShell>
  )
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string
  hint?: string
  error?: string
}

export function Textarea({ label, hint, error, id, className = '', ...rest }: TextareaProps) {
  const inputId = id ?? `t-${label.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <FieldShell label={label} htmlFor={inputId} hint={hint} error={error}>
      <textarea
        id={inputId}
        {...rest}
        aria-invalid={error ? true : undefined}
        className={`bg-inset border border-line-strong focus:border-link focus:outline-none px-5 py-4 text-[16px] leading-[1.78] text-ink placeholder:text-ink/40 resize-y rounded-xs ${className}`}
      />
    </FieldShell>
  )
}
