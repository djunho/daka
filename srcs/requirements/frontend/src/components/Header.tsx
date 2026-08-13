import { Link } from 'react-router-dom'

export default function Header() {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-4 px-6 py-3 bg-surface/90 backdrop-blur-md border-b border-line">

      {/* --- Brand: teal square with the swap arrows + Fraunces wordmark --- */}
      <Link
        to="/"
        aria-label="Daka — home"
        className="flex items-center gap-2.5 shrink-0"
      >
        <LogoMark />
        <span className="font-display text-2xl font-semibold text-ink">daka</span>
      </Link>

      {/* --- Search, centered and flexible (as in the Figma) --- */}
      {/* mx-auto pushes it to the visual center; max-width keeps it from
          stretching edge to edge on wide screens. It is a plain input for now
          -- wiring it to the advanced-search module is a separate feature. */}
      <input
        type="search"
        placeholder="Search trades…"
        aria-label="Search listings"
        className="flex-1 max-w-[440px] mx-auto px-4 py-2.5 bg-paper border border-line rounded-full text-ink placeholder:text-muted focus:border-brand focus:outline-none transition-colors"
      />

      {/* --- Right side actions --- */}
      {/* shrink-0 stops the buttons from being squeezed by the search field. */}
      <div className="flex items-center gap-2.5 shrink-0">

        {/* LOGGED-OUT: a quiet "Entrar" link. When AuthContext lands, this is
            the element that gets swapped for the user's avatar + menu. */}
        <Link
          to="/login"
          className="px-4 py-2 rounded-full font-medium text-ink hover:bg-paper transition-colors"
        >
          Sign in
        </Link>

        {/* "+ Publicar": the primary action, teal pill. Points at /login while
            publishing is gated behind auth; it becomes /publish once that page
            and the auth guard exist. */}
        <Link
          to="/login"
          className="flex items-center gap-1 px-4 py-2 rounded-full font-semibold bg-brand text-surface hover:opacity-95 transition-opacity"
        >
          <span aria-hidden="true" className="text-lg leading-none">+</span>
          Post
        </Link>
      </div>
    </header>
  )
}

// The logo mark: teal rounded square holding the two swap arrows (white
// pointing right = "has", coral pointing left = "wants"). Same mark used on the
// login screen, so the two line up exactly.
function LogoMark() {
  return (
    <span className="inline-flex items-center justify-center w-9 h-9 bg-brand rounded-[10px]">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 9 H17" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M14 6 L17 9 L14 12" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M20 15 H7" stroke="#DF3D31" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M10 12 L7 15 L10 18" stroke="#DF3D31" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}