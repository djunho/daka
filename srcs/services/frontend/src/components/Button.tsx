import { forwardRef, type ButtonHTMLAttributes } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'dangerOutline' | 'ghost' | 'link'
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
  // A text action that looks like a link ("Limpar filtros", "Editar perfil").
  // It is still a <button>: it does something on the page, it goes nowhere.
  link: 'bg-transparent text-brand not-disabled:hover:underline',
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3.5 py-2 text-xs rounded-full',
  md: 'px-5 py-2.5 text-sm rounded-full',
  lg: 'px-6 py-3 text-sm rounded-xl',
}

// A link-style button has no box: no padding and no rounded corners, so it
// can sit inside a sentence. The size only sets the text size; a caller that
// needs a bigger touch area adds padding through className.
const LINK_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
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
  const sizeClasses = variant === 'link' ? LINK_SIZE_CLASSES[size] : SIZE_CLASSES[size]
  return `${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${sizeClasses}${className ? ` ${className}` : ''}`
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

// Shared button component. Defaults to type="button" so buttons inside forms
// do not submit accidentally unless type="submit" is passed explicitly.
// forwardRef: a page can keep a ref to the button, e.g. to give the focus back
// to it after a form it opened is closed.
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = 'secondary', // Visual style: 'primary' | 'secondary' | 'danger' | 'dangerOutline' | 'ghost' | 'link'
  size = 'md',           // Padding, font scale, and border radius: 'sm' | 'md' | 'lg' (text size only for 'link')
  loading = false,       // Shows a spinner and disables the button while an async action runs
  disabled,              // Native disabled state (combined with `loading`)
  className = '',        // Extra utility classes appended to the button (e.g. 'w-full')
  type = 'button',       // Native button type ('button' | 'submit' | 'reset')
  children,
  ...props
}, ref) {
  return (
    <button
      ref={ref}
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
})

export default Button
