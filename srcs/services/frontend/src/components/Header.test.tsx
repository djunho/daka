import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Header from './Header'
import { useAuth } from '../context/AuthContext'

vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }))

const ME = { id: 1, user_name: 'Ana', avatar: null, user_location: null, is_online: false, email: 'ana@x.io', created_at: '' }

function renderHeader(user: typeof ME | null) {
  vi.mocked(useAuth).mockReturnValue({ user, loading: false, logout: vi.fn() } as unknown as ReturnType<typeof useAuth>)
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Header />
      <p>Fora do menu</p>
    </MemoryRouter>,
  )
}

describe('Header', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReset()
  })

  it('keeps the name of the publish link when the word is hidden on small screens', () => {
    renderHeader(null)
    expect(screen.getByRole('link', { name: 'Publicar' })).toHaveAttribute('href', '/publish')
  })

  it('closes the account menu with Escape and gives the focus back to the avatar', async () => {
    renderHeader(ME)
    const button = screen.getByRole('button', { name: 'Menu da conta' })

    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    screen.getByRole('menuitem', { name: 'Perfil' }).focus()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveFocus()
  })

  it('closes the account menu when tapping outside it', async () => {
    renderHeader(ME)

    await userEvent.click(screen.getByRole('button', { name: 'Menu da conta' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await userEvent.click(screen.getByText('Fora do menu'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('keeps the account menu open when tapping inside it', async () => {
    renderHeader(ME)

    await userEvent.click(screen.getByRole('button', { name: 'Menu da conta' }))
    await userEvent.click(screen.getByText('Ana'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })
})
