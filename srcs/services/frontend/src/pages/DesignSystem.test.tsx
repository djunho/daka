import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DesignSystem from './DesignSystem'
import { ICON_NAMES } from '../components/Icon'

// The sample cards have a favorites heart, which reads the session and the
// favorites. A visitor with nothing saved: the page itself needs no API.
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false, logout: vi.fn() }),
}))
vi.mock('../context/FavoritesContext', () => ({
  useFavorites: () => ({ ready: true, isFavorite: () => false, isPending: () => false, toggleFavorite: vi.fn() }),
}))

function renderPage() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <DesignSystem />
    </MemoryRouter>,
  )
}

describe('DesignSystem page', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows every section of the style guide', () => {
    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Design system' })).toBeInTheDocument()
    for (const title of ['Marca', 'Cores', 'Tipografia', 'Ícones', 'Componentes']) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument()
    }
  })

  it('shows at least ten reusable components', () => {
    renderPage()

    const components = within(screen.getByRole('region', { name: 'Componentes' }))
    expect(components.getAllByRole('heading', { level: 3 }).length).toBeGreaterThanOrEqual(10)
  })

  it('lists every icon of the set by name', () => {
    renderPage()

    const icons = within(screen.getByRole('region', { name: 'Ícones' }))
    for (const name of ICON_NAMES) {
      expect(icons.getByText(name)).toBeInTheDocument()
    }
  })

  it('never calls the API: everything is sample data', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the sample listing cards out of reach, since their listings do not exist', () => {
    renderPage()

    const card = screen.getByRole('heading', { level: 3, name: 'Coleção de livros de ficção científica' })
    expect(card.closest('[inert]')).not.toBeNull()
  })
})
