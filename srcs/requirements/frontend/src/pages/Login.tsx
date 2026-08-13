export default function AuthPage() {
  // "signin" | "signup". Fixed to "signin" for this static pass; the explicit
  // union type (rather than letting TypeScript infer the literal "signin")
  // keeps the "signup" branches valid now and turns into real state next step.
  const tab: 'signin' | 'signup' = 'signin' as 'signin' | 'signup'

  return (
    // Full-height area below the header, centering the card both ways.
    <main className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[420px]">

        {/* Logo lockup above the card: teal rounded square with the swap
            arrows, next to the Fraunces wordmark. */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <LogoMark />
          <span className="font-display text-3xl font-semibold text-ink">daka</span>
        </div>

        {/* The card. */}
        <div className="bg-surface border border-line rounded-2xl shadow-[0_1px_2px_rgba(21,35,31,0.04),0_12px_32px_rgba(21,35,31,0.08)] p-7">

          {/* --- Tab toggle: Sign in / Create account --- */}
          {/* A single pill track; the active half is white and raised, the
              inactive half is transparent with muted-label text. */}
          <div className="flex p-1 bg-paper border border-line rounded-xl mb-6">
            <button
              type="button"
              className={
                'flex-1 py-2 rounded-lg text-sm font-medium transition-colors ' +
                (tab === 'signin'
                  ? 'bg-surface text-ink shadow-sm'
                  : 'text-label')
              }
            >
              Sign in
            </button>
            <button
              type="button"
              className={
                'flex-1 py-2 rounded-lg text-sm font-medium transition-colors ' +
                (tab === 'signup'
                  ? 'bg-surface text-ink shadow-sm'
                  : 'text-label')
              }
            >
              Create account
            </button>
          </div>

          {/* --- Google button --- */}
          <button
            type="button"
            className="w-full flex items-center justify-center gap-3 py-3 border border-line rounded-xl text-ink font-medium hover:bg-paper transition-colors"
          >
            <GoogleIcon />
            {tab === 'signin' ? 'Sign in with Google' : 'Sign up with Google'}
          </button>

          {/* --- "or" divider --- */}
          <div className="flex items-center gap-3 my-6">
            <span className="flex-1 h-px bg-line" />
            <span className="text-xs text-muted">or</span>
            <span className="flex-1 h-px bg-line" />
          </div>

          {/* --- Email + password fields --- */}
          {/* Static markup: labels tied to inputs by id, placeholder text in
              muted green. The "Create account" tab will add a name field on
              top -- omitted here to match the Sign in view in the Figma. */}
          <div className="flex flex-col gap-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-ink mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                placeholder="you@email.com"
                className="w-full px-4 py-3 bg-surface border border-line rounded-xl text-ink placeholder:text-muted focus:border-brand focus:outline-none transition-colors"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="password" className="block text-sm font-medium text-ink">
                  Password
                </label>
                <button type="button" className="text-sm text-brand hover:underline">
                  Forgot?
                </button>
              </div>
              <input
                id="password"
                type="password"
                placeholder="••••••••"
                className="w-full px-4 py-3 bg-surface border border-line rounded-xl text-ink placeholder:text-muted focus:border-brand focus:outline-none transition-colors"
              />
            </div>

            {/* Primary action. The label names the exact outcome, per the
                writing guidance: it says where you land, not just "Submit". */}
            <button
              type="button"
              className="w-full py-3 bg-brand text-surface font-semibold rounded-xl hover:opacity-95 transition-opacity mt-2"
            >
              Sign in to Daka
            </button>
          </div>
        </div>

        {/* --- Footer line under the card --- */}
        <p className="text-center text-sm text-muted mt-6">
          Don't have an account?{' '}
          <button type="button" className="text-brand font-semibold hover:underline">
            Sign up free
          </button>
        </p>
      </div>
    </main>
  )
}

// --- Small presentational helpers -------------------------------------------

// The logo mark: a teal rounded square holding the two swap arrows (teal
// pointing right = "has", coral pointing left = "wants"). Inline SVG so it
// stays sharp at any size and reads the palette from currentColor where useful.
function LogoMark() {
  return (
    <span className="inline-flex items-center justify-center w-11 h-11 bg-brand rounded-xl">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {/* top arrow: right-pointing, white */}
        <path d="M4 9 H17" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M14 6 L17 9 L14 12" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        {/* bottom arrow: left-pointing, coral */}
        <path d="M20 15 H7" stroke="#DF3D31" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M10 12 L7 15 L10 18" stroke="#DF3D31" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

// Google's "G" in its four brand colours. Kept as a literal asset because it is
// a third-party logo, not part of our palette -- these hex values are meant to
// be exact and must not be tokenised.
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