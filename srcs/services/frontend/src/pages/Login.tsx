import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { useAuth } from '../context/AuthContext'
import { ApiError } from '../lib/api'

// The authentication screen, now with real state and client-side validation.
//
// What this step adds over the static version:
//   - the tab actually switches between "Sign in" and "Create account"
//   - every field remembers what you type (controlled inputs)
//   - the form is validated when you submit, and errors show under each field
//   - the password eye shows / hides the characters
//
// What it does: talk to the backend via useAuth() (register/login) and rely on
// the backend to set the httpOnly session cookie on success. Client-side
// validation here is only for fast feedback; the backend still validates too.
//
// The validation rules here MIRROR the backend (app/schemas.py) on purpose.
// Client-side checks are for fast, friendly feedback; the backend repeats them
// because anyone can bypass a browser form. If the two disagree, the user gets
// confused -- so they must agree.

// Kept in sync with schemas.py: MIN_PASSWORD_LENGTH = 8, name >= 2 chars.
const MIN_PASSWORD_LENGTH = 8
const MIN_NAME_LENGTH = 2

// The shape of the errors object: a message per field, any of them optional.
type FieldErrors = {
  fullName?: string
  email?: string
  password?: string
}

// A minimal email sanity check. Deliberately loose -- the real authority is the
// backend's EmailStr. This only catches the obvious "there is no @" mistake so
// the user is not sent to the server to be told the obvious.
function looksLikeEmail(value: string): boolean {
  // something, an @, something, a dot, something -- no spaces.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export default function Login() {
  // Which tab is active. Real state now, so both branches are genuinely
  // reachable and TypeScript is happy without the cast we needed before.
  const [tab, setTab] = useState<'signin' | 'signup'>('signin')

  // One piece of state per field. "Controlled inputs": React holds the value
  // and the input just reflects it, which is what lets us validate on submit.
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // Validation messages, filled in only when the user submits.
  const [errors, setErrors] = useState<FieldErrors>({})

  // Whether the password is shown as text or dots.
  const [showPassword, setShowPassword] = useState(false)

  // True while a request is in flight, so we can disable the button and show
  // "Signing in…" instead of letting the user submit twice.
  const [submitting, setSubmitting] = useState(false)

  // A form-level error (as opposed to per-field): the message the SERVER sends
  // back, like "An account with this email already exists." or "Incorrect
  // email or password." Field errors catch mistakes before we call the API;
  // this catches what only the server can know. Also receives Google OAuth errors.
  const [formError, setFormError] = useState<string | null>(null)

  // From the context: the current user and login/register actions.
  const { user, login, register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()

  // Where to send the user after login (defaults to home page)
  const from = (location.state as { from?: string } | null)?.from || '/'

  // Preserve destination in Google login URL so it survives the OAuth redirect flow
  const googleLoginUrl =
    from && from !== '/'
      ? `/api/auth/google/login?dest=${encodeURIComponent(from)}`
      : '/api/auth/google/login'

  // If already authenticated (e.g. navigating to /login with an active session), redirect
  useEffect(() => {
    if (user) {
      navigate(from, { replace: true })
    }
  }, [user, navigate, from])

  // Display OAuth error feedback from URL query parameters (e.g. /login?error=access_denied)
  useEffect(() => {
    const errorParam = searchParams.get('error')
    if (!errorParam) return

    // Translate the errors from the error query param received from the OAuth redirect into user-friendly messages.
    //   The error codes are defined by the OAuth 2.0 spec and Google's implementation.
    // https://developers.google.com/identity/protocols/oauth2/web-server#handlingresponse
    // https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.2.1
    switch (errorParam) {
      case 'access_denied':
        setFormError('A autenticação com a Google foi cancelada.')
        break
      case 'google_unconfigured':
        setFormError('A autenticação com a Google não se encontra configurada.')
        break
      case 'google_conflict':
        setFormError('Este email já está associado a outra conta Google.')
        break
      case 'auth_failed':
        setFormError('Não foi possível concluir a autenticação com a Google.')
        break
      case 'server_error':
        setFormError('Ocorreu um erro no servidor durante a autenticação. Por favor, tenta novamente.')
        break
      default:
        setFormError('Ocorreu um erro ao tentar autenticar com a Google. Por favor, tenta novamente.')
        break
    }

    // Remove ?error= so a refresh or history navigation does not show the message again.
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params)
        next.delete('error')
        return next
      },
      { replace: true },
    )
  }, [searchParams, setSearchParams])

  const isSignup = tab === 'signup'

  // Switching tabs clears whatever errors were on screen, so the sign-up rules
  // don't linger as red text after you flip to sign-in. The typed values are
  // kept -- retyping your email just to switch tab would be annoying.
  function switchTab(next: 'signin' | 'signup') {
    setTab(next)
    setErrors({})
    setFormError(null)
  }

  // Runs on submit. Returns the errors it found (empty object = all good) so
  // the caller can decide whether to proceed.
  function validate(): FieldErrors {
    const found: FieldErrors = {}

    // Name: only exists and only matters on the sign-up tab.
    if (isSignup && fullName.trim().length < MIN_NAME_LENGTH) {
      found.fullName = 'Introduz o teu nome.'
    }

    // Email: required on both tabs, and must look like an address.
    if (!email.trim()) {
      found.email = 'Introduz o teu email.'
    } else if (!looksLikeEmail(email)) {
      found.email = 'Introduz um endereço de email válido.'
    }

    // Password: on sign-up it must meet the strength rule; on sign-in we only
    // require that it is not empty (an old, shorter password must still work).
    if (!password) {
      found.password = 'Introduz a tua palavra-passe.'
    } else if (isSignup && password.length < MIN_PASSWORD_LENGTH) {
      found.password = `Utiliza pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`
    }

    return found
  }

  async function handleSubmit() {
    // Clear any leftover server error from a previous attempt.
    setFormError(null)

    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) return

    setSubmitting(true)
    try {
      if (isSignup) {
        // register() creates the account and logs in, per our choice.
        await register(fullName.trim(), email.trim(), password)
      } else {
        await login(email.trim(), password)
      }
      // On success the context now holds the user; send them to the intended page.
      navigate(from, { replace: true })
    } catch (err) {
      // The API layer throws ApiError with the server's message in .message.
      // Anything else is unexpected, but still worth showing something for.
      setFormError(
        err instanceof ApiError
          ? err.message
          : 'Algo correu mal. Por favor, tenta novamente.',
      )
    } finally {
      // Runs whether we succeeded or failed, so the button never stays stuck.
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[420px]">

        {/* Logo lockup above the card */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <LogoMark />
          <span className="font-display text-3xl font-semibold text-ink">daka</span>
        </div>

        <div className="bg-surface border border-line rounded-2xl shadow-[0_1px_2px_rgba(21,35,31,0.04),0_12px_32px_rgba(21,35,31,0.08)] p-7">

          {/* --- Tab toggle --- */}
          <div className="flex p-1 bg-paper border border-line rounded-xl mb-6">
            <button
              type="button"
              onClick={() => switchTab('signin')}
              className={
                'flex-1 py-2 rounded-lg text-sm font-medium transition-colors ' +
                (!isSignup ? 'bg-surface text-ink shadow-sm' : 'text-label')
              }
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => switchTab('signup')}
              className={
                'flex-1 py-2 rounded-lg text-sm font-medium transition-colors ' +
                (isSignup ? 'bg-surface text-ink shadow-sm' : 'text-label')
              }
            >
              Criar conta
            </button>
          </div>

          {/* Form- or OAuth-level error alert */}
          {formError && (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 text-sm text-accent bg-accent/10 border border-accent/30 rounded-lg px-4 py-3 mb-6"
            >
              <span>{formError}</span>
              <button
                type="button"
                onClick={() => setFormError(null)}
                className="text-accent/70 hover:text-accent font-bold p-1 transition-colors leading-none"
                aria-label="Fechar alerta"
              >
                ✕
              </button>
            </div>
          )}

          {/* --- Google button --- */}
          <a
            href={googleLoginUrl}
            className="w-full flex items-center justify-center gap-3 py-3 border border-line rounded-xl text-ink font-medium hover:bg-paper transition-colors"
          >
            <GoogleIcon />
            {isSignup ? 'Registar com a Google' : 'Iniciar sessão com a Google'}
          </a>

          {/* --- divider --- */}
          <div className="flex items-center gap-3 my-6">
            <span className="flex-1 h-px bg-line" />
            <span className="text-xs text-muted">ou</span>
            <span className="flex-1 h-px bg-line" />
          </div>

          {/* --- Form fields --- */}
          {/* noValidate turns off the browser's own bubble messages so ours are
              the only ones shown. onSubmit handles both Enter and the button. */}
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              handleSubmit()
            }}
            className="flex flex-col gap-4"
          >
            {/* Full name: sign-up only. Rendered conditionally, so it appears
                and disappears with the tab, matching the Figma. */}
            {isSignup && (
              <Field
                id="fullName"
                label="Nome completo"
                error={errors.fullName}
              >
                <input
                  id="fullName"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Teu nome"
                  className={inputClass(!!errors.fullName)}
                />
              </Field>
            )}

            <Field id="email" label="Email" error={errors.email}>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                className={inputClass(!!errors.email)}
              />
            </Field>

            <Field id="password" label="Palavra-passe" error={errors.password}>
              {/* The eye button sits inside the field, so the input is wrapped
                  in a relative container and gets right padding to leave room. */}
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={inputClass(!!errors.password) + ' pr-11'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ocultar palavra-passe' : 'Mostrar palavra-passe'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink transition-colors"
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </Field>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 bg-brand text-surface font-semibold rounded-xl hover:opacity-95 transition-opacity mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting
                ? isSignup
                  ? 'A criar conta…'
                  : 'A entrar…'
                : isSignup
                  ? 'Criar conta gratuita'
                  : 'Entrar no Daka'}
            </button>
          </form>
        </div>

        {/* Footer line: flips the tab rather than navigating anywhere. */}
        <p className="text-center text-sm text-muted mt-6">
          {isSignup ? 'Já tens conta? ' : 'Ainda não tens conta? '}
          <button
            type="button"
            onClick={() => switchTab(isSignup ? 'signin' : 'signup')}
            className="text-brand font-semibold hover:underline"
          >
            {isSignup ? 'Entrar' : 'Regista-te grátis'}
          </button>
        </p>
      </div>
    </main>
  )
}

// --- Small building blocks --------------------------------------------------

// One labelled field: the label, the input passed in as children, and the
// error message below. Pulling this out keeps the three fields from repeating
// the same wiring.
function Field({
  id,
  label,
  error,
  children,
}: {
  id: string
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink mb-1.5">
        {label}
      </label>
      {children}
      {/* role="alert" makes a screen reader announce the message when it
          appears. Only rendered when there is an error. */}
      {error && (
        <p role="alert" className="text-sm text-accent mt-1.5">
          {error}
        </p>
      )}
    </div>
  )
}

// The input classes, shared by all fields. The only thing that changes is the
// border colour when the field is in error -- coral instead of the line grey.
function inputClass(hasError: boolean): string {
  return (
    'w-full px-4 py-3 bg-surface border rounded-xl text-ink placeholder:text-muted focus:outline-none transition-colors ' +
    (hasError ? 'border-accent focus:border-accent' : 'border-line focus:border-brand')
  )
}

// --- Icons ------------------------------------------------------------------

function LogoMark() {
  return (
    <span className="inline-flex items-center justify-center w-11 h-11 bg-brand rounded-xl">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 9 H17" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M14 6 L17 9 L14 12" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M20 15 H7" stroke="#DF3D31" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M10 12 L7 15 L10 18" stroke="#DF3D31" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62z" fill="#4285F4" />
      <path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 0 0 9 18z" fill="#34A853" />
      <path d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.96H.96a9 9 0 0 0 0 8.1l3.02-2.34z" fill="#FBBC05" />
      <path d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.96l3.02 2.32C4.68 5.16 6.66 3.58 9 3.58z" fill="#EA4335" />
    </svg>
  )
}

// Open eye = "click to show". Simple two-path outline, no icon library needed.
function EyeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

// Eye with a slash = "click to hide".
function EyeOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M10.6 5.2A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a13.4 13.4 0 0 1-2.4 3.1M6.5 6.5A13.3 13.3 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.1-.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
