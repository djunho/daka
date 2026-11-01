import { type ButtonHTMLAttributes } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'dangerOutline' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg'

const BASE_CLASSES =
  'inline-flex items-center justify-center gap-2 font-semibold transition no-underline ' +
  'disabled:opacity-50 disabled:cursor-not-allowed ' +
  'aria-disabled:opacity-50 aria-disabled:pointer-events-none'

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-surface border border-brand not-disabled:hover:opacity-95',
  secondary: 'bg-surface text-ink border border-line not-disabled:hover:border-brand not-disabled:hover:bg-paper',
  danger: 'bg-accent text-white border border-accent not-disabled:hover:opacity-90',
  dangerOutline: 'bg-transparent text-accent border border-accent not-disabled:hover:bg-accent not-disabled:hover:text-white',
  ghost: 'bg-transparent text-muted border border-transparent not-disabled:hover:text-ink not-disabled:hover:bg-paper',
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3.5 py-2 text-xs rounded-full',
  md: 'px-5 py-2.5 text-sm rounded-full',
  lg: 'px-6 py-3 text-sm rounded-xl',
}

export function buttonClasses({
  variant = 'secondary',
  size = 'md',
  className = '',
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
} = {}): string {
  return `${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]}${className ? ` ${className}` : ''}`
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

// Shared button component. Defaults to type="button" so buttons inside forms
// do not submit accidentally unless type="submit" is passed explicitly.
export default function Button({
  variant = 'secondary', // Visual style: 'primary' | 'secondary' | 'danger' | 'dangerOutline' | 'ghost'
  size = 'md',           // Padding, font scale, and border radius: 'sm' | 'md' | 'lg'
  loading = false,       // Shows a spinner and disables the button while an async action runs
  disabled,              // Native disabled state (combined with `loading`)
  className = '',        // Extra utility classes appended to the button (e.g. 'w-full')
  type = 'button',       // Native button type ('button' | 'submit' | 'reset')
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading}
      className={buttonClasses({ variant, size, className })}
      {...props}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
        />
      )}
      {children}
    </button>
  )
}
