import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { useAuth } from '../context/AuthContext'
import Icon from './Icon'
import LogoMark from './Logo'

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
    <header className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap sm:gap-4 sm:px-6 bg-surface/90 backdrop-blur-md border-b border-line">
      {/* --- Brand --- */}
      <Link to="/" aria-label="Daka — home" className="flex items-center gap-2.5 shrink-0">
        <LogoMark />
        <span className="font-display text-2xl font-semibold text-ink">daka</span>
      </Link>

      {/* --- Search --- */}
      <form role="search" onSubmit={handleSearch} className="order-last w-full sm:order-none sm:w-auto sm:flex-1 sm:max-w-[440px] sm:mx-auto">
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
      <div className="flex items-center gap-2.5 shrink-0 ml-auto">
        {/* The one branch that changes with the session: a "Sign in" link when
            logged out, the avatar menu when logged in. */}
        {user === null ? (
          <Link
            to="/login"
            className="px-3 sm:px-4 py-2 rounded-full font-medium text-ink hover:bg-paper transition-colors"
          >
            Iniciar sessão
          </Link>
        ) : (
          <UserMenu id={user.id} name={user.user_name} avatar={user.avatar} onLogout={logout} />
        )}

        <Link
          to="/publish"
          className="flex items-center justify-center gap-1 w-9 h-9 sm:w-auto sm:h-auto sm:px-4 sm:py-2 rounded-full font-semibold bg-brand text-surface hover:opacity-95 transition-opacity"
        >
          <Icon name="plus" size={18} />
          <span className="sr-only sm:not-sr-only">Publicar</span>
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
  const buttonRef = useRef<HTMLButtonElement>(null)
  const navigate = useNavigate()

  // Close the menu when the user clicks or taps anywhere outside it, or presses
  // Escape. Without this the dropdown would stay open until you clicked the
  // avatar again, which feels broken. The listeners exist only while it is open.
  useEffect(() => {
    if (!open) return
    // pointerdown covers mouse, touch and pen.
    function onPointerDownOutside(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        // Focus may be on an item that is about to disappear: give it back
        // to the button, so keyboard users stay where they were.
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDownOutside)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDownOutside)
      document.removeEventListener('keydown', onKeyDown)
    }
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
        ref={buttonRef}
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
          <Icon name="user" className="text-muted" />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-52 max-w-[calc(100vw-2rem)] bg-surface border border-line rounded-xl shadow-lg py-1"
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
            to="/favorites"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 text-sm text-ink hover:bg-paper transition-colors"
          >
            Favoritos
          </Link>
          <Link
            to="/negotiations"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 text-sm text-ink hover:bg-paper transition-colors"
          >
            Negociações
          </Link>
          <Link
            to="/friends"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 text-sm text-ink hover:bg-paper transition-colors"
          >
            Amigos
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
