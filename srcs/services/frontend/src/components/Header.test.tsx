import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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

  it('links to the favorites from the account menu', async () => {
    renderHeader(ME)

    await userEvent.click(screen.getByRole('button', { name: 'Menu da conta' }))

    expect(screen.getByRole('menuitem', { name: 'Favoritos' })).toHaveAttribute('href', '/favorites')
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

  it('loads the avatar without a Referer and shows the person icon when it fails', () => {
    const avatar = 'https://lh3.googleusercontent.com/a/photo=s96-c'
    const { container } = renderHeader({ ...ME, avatar } as unknown as typeof ME)
    const img = container.querySelector('img')

    expect(img).toHaveAttribute('src', avatar)
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer')

    fireEvent.error(img!)
    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Menu da conta' }).querySelector('svg')).toBeInTheDocument()
  })
})
