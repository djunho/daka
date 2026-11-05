import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Login from './Login'
import { ApiError } from '../lib/api'
import { useAuth } from '../context/AuthContext'

vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }))

const login = vi.fn()
const register = vi.fn()

function renderLogin() {
  vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, login, register } as unknown as ReturnType<typeof useAuth>)
  return render(
    <MemoryRouter initialEntries={['/login']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Login />
    </MemoryRouter>,
  )
}

async function fillAndSubmit(submitName: string) {
  await userEvent.type(screen.getByLabelText('Email'), 'ana@example.com')
  await userEvent.type(screen.getByLabelText('Palavra-passe'), 'correct-horse-battery')
  await userEvent.click(screen.getByRole('button', { name: submitName }))
}

describe('Login errors', () => {
  beforeEach(() => {
    login.mockReset()
    register.mockReset()
  })

  it('says the email or the password is wrong, without telling which, on a 401', async () => {
    login.mockRejectedValue(new ApiError(401, 'Incorrect email or password.'))
    renderLogin()

    await fillAndSubmit('Entrar no Daka')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('O email ou a palavra-passe estão incorretos.')
    expect(alert).not.toHaveTextContent('Incorrect')
  })

  it('says the email is taken on a 409 when creating an account', async () => {
    register.mockRejectedValue(new ApiError(409, 'An account with this email already exists.'))
    renderLogin()

    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    await userEvent.type(screen.getByLabelText('Nome completo'), 'Ana')
    await fillAndSubmit('Criar conta gratuita')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Já existe uma conta com este email.')
    expect(alert).not.toHaveTextContent('already exists')
  })

  it('explains a failed connection in Portuguese', async () => {
    login.mockRejectedValue(new ApiError(0, 'Could not reach the server. Check your connection.'))
    renderLogin()

    await fillAndSubmit('Entrar no Daka')

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível contactar o servidor.')
  })
})
