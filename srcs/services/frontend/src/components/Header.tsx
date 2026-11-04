import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { useAuth } from '../context/AuthContext'

// Site header. Now aware of the session: logged-out shows "Sign in" + "Post";
// logged-in swaps "Sign in" for an avatar that opens a small menu with logout.
// "Post" stays in both states.
export default function Header() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('q') ?? '')

  // Keep the input in sync with the URL, e.g. clearing it when the logo is clicked.
  useEffect(() => {
    setQuery(searchParams.get('q') ?? '')
  }, [searchParams])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    // Only the search text changes: the category and location filters
    // already in the URL stay.
    const next = new URLSearchParams(searchParams)
    if (q) {
      next.set('q', q)
    } else {
      next.delete('q')
    }
    const qs = next.toString()
    navigate(qs ? `/?${qs}` : '/')
  }

  return (
    <header className="sticky top-0 z-10 flex items-center gap-4 px-6 py-3 bg-surface/90 backdrop-blur-md border-b border-line">

      {/* --- Brand --- */}
      <Link to="/" aria-label="Daka — home" className="flex items-center gap-2.5 shrink-0">
        <LogoMark />
        <span className="font-display text-2xl font-semibold text-ink">daka</span>
      </Link>

      {/* --- Search --- */}
      <form role="search" onSubmit={handleSearch} className="flex-1 max-w-[440px] mx-auto">
        <input
          type="search"
          placeholder="Pesquisar trocas…"
          aria-label="Pesquisar trocas disponíveis"
          className="w-full px-4 py-2.5 bg-paper border border-line rounded-full text-ink placeholder:text-muted focus:border-brand focus:outline-none transition-colors"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={150}
        />
      </form>

      {/* --- Right side --- */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* The one branch that changes with the session: a "Sign in" link when
            logged out, the avatar menu when logged in. */}
        {user === null ? (
          <Link
            to="/login"
            className="px-4 py-2 rounded-full font-medium text-ink hover:bg-paper transition-colors"
          >
            Iniciar sessão
          </Link>
        ) : (
          <UserMenu id={user.id} name={user.user_name} avatar={user.avatar} onLogout={logout} />
        )}

        <Link
          to="/publish"
          className="flex items-center gap-1 px-4 py-2 rounded-full font-semibold bg-brand text-surface hover:opacity-95 transition-opacity"
        >
          <span aria-hidden="true" className="text-lg leading-none">+</span>
          Publicar
        </Link>
      </div>
    </header>
  )
}

// The avatar button plus its dropdown menu.
function UserMenu({
  id,
  name,
  avatar,
  onLogout,
}: {
  id: number
  name: string
  avatar: string | null
  onLogout: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  // Close the menu when the user clicks anywhere outside it. Without this the
  // dropdown would stay open until you clicked the avatar again, which feels
  // broken. We attach the listener only while the menu is open.
  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  async function handleLogout() {
    setOpen(false)
    await onLogout()
    // Send the now-logged-out user to the home page.
    navigate('/')
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Menu da conta"
        aria-expanded={open}
        className="flex items-center justify-center w-9 h-9 rounded-full bg-paper border border-line hover:border-brand transition-colors overflow-hidden"
      >
        {avatar ? (
          // A real profile picture, once uploads exist. alt is empty because
          // the button already has an aria-label naming its purpose.
          <img src={avatar} alt="" className="w-full h-full object-cover" />
        ) : (
          // No photo yet (the common case at first): a generic person icon.
          <PersonIcon />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-52 bg-surface border border-line rounded-xl shadow-lg py-1"
        >
          {/* The name lives inside the menu rather than in the header bar, so
              the bar stays compact. */}
          <div className="px-4 py-2 border-b border-line">
            <p className="text-sm font-medium text-ink truncate">{name}</p>
          </div>
          <Link
            to="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 text-sm text-ink hover:bg-paper transition-colors"
          >
            Perfil
          </Link>

          <Link
            to={`/users/${id}`}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 text-sm text-ink hover:bg-paper transition-colors"
          >
            Meus anúncios
          </Link>
          <Link
            to="/negotiations"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 text-sm text-ink hover:bg-paper transition-colors"
          >
            Negociações
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            className="block w-full text-left px-4 py-2.5 text-sm text-accent hover:bg-paper transition-colors"
          >
            Encerrar sessão
          </button>
        </div>
      )}
    </div>
  )
}

// --- Icons ------------------------------------------------------------------

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

// Generic person silhouette, shown when a user has no avatar uploaded.
function PersonIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="4" stroke="var(--color-muted)" strokeWidth="1.8" />
      <path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" stroke="var(--color-muted)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
