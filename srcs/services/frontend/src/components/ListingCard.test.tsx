import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ListingCard from './ListingCard'
import { type ApiListingSummary } from '../lib/api'

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 2 }, loading: false, logout: vi.fn() }),
}))
vi.mock('../context/FavoritesContext', () => ({
  useFavorites: () => ({
    ready: true,
    isFavorite: () => false,
    isPending: () => false,
    toggleFavorite: vi.fn(),
    snapshotFavorites: () => 0,
    rememberFavorites: vi.fn(),
  }),
}))

const LISTING: ApiListingSummary = {
  id: 5,
  title: 'Bicicleta',
  category: { id: 1, category_name: 'Books' },
  condition: { id: 1, condition_name: 'Good' },
  listing_location: null,
  wish: null,
  owner: { id: 1, user_name: 'Ana', avatar: null, user_location: null, is_online: false },
  cover_image: null,
  created_at: '2026-01-01T00:00:00',
}

describe('ListingCard', () => {
  it('keeps the favorites heart out of the link: a button inside a link is invalid HTML', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ListingCard listing={LISTING} />
      </MemoryRouter>,
    )

    const link = screen.getByRole('link', { name: /Bicicleta/ })
    const heart = screen.getByRole('button', { name: 'Guardar nos favoritos: Bicicleta' })
    expect(link).toHaveAttribute('href', '/listing/5')
    expect(link).not.toContainElement(heart)
  })
})
