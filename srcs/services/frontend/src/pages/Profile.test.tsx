import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Profile from './Profile'
import { ApiError } from '../lib/api'
import { useAuth } from '../context/AuthContext'

vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }))

const USER = {
  id: 1,
  user_name: 'Ana',
  email: 'ana@example.com',
  avatar: null,
  user_location: 'Lisboa',
  created_at: '2026-09-01T10:00:00Z',
}

const updateProfile = vi.fn()
const uploadAvatar = vi.fn()
const removeAvatar = vi.fn()
const deleteAccount = vi.fn()
const logout = vi.fn()

function renderProfile() {
  vi.mocked(useAuth).mockReturnValue({
    user: USER,
    loading: false,
    updateProfile,
    uploadAvatar,
    removeAvatar,
    deleteAccount,
    logout,
  } as unknown as ReturnType<typeof useAuth>)
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Profile />
    </MemoryRouter>,
  )
}

async function startEditing() {
  await userEvent.click(screen.getByRole('button', { name: 'Editar perfil' }))
}

async function changeName(name: string) {
  const input = screen.getByLabelText('Nome de utilizador')
  await userEvent.clear(input)
  await userEvent.type(input, name)
}

async function pickPhoto() {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
  await userEvent.upload(input, new File(['png'], 'foto.png', { type: 'image/png' }))
}

async function save() {
  await userEvent.click(screen.getByRole('button', { name: 'Guardar alterações' }))
}

describe('Profile errors', () => {
  // jsdom has neither the native dialog methods nor object URLs (the photo preview).
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = function showModal() { this.open = true }
    HTMLDialogElement.prototype.close = function close() { this.open = false }
    URL.createObjectURL = vi.fn(() => 'blob:preview')
    URL.revokeObjectURL = vi.fn()
  })

  beforeEach(() => {
    for (const fn of [updateProfile, uploadAvatar, removeAvatar, deleteAccount, logout]) fn.mockReset()
    updateProfile.mockResolvedValue(undefined)
    uploadAvatar.mockResolvedValue(undefined)
    logout.mockResolvedValue(undefined)
  })

  it('explains a photo over the size limit in Portuguese', async () => {
    uploadAvatar.mockRejectedValue(new ApiError(413, 'Image is too large. The maximum size is 2 MB.'))
    renderProfile()

    await startEditing()
    await pickPhoto()
    await save()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('O ficheiro é demasiado grande.')
    expect(alert).not.toHaveTextContent('Image is too large')
  })

  it('explains a photo in a format the server refuses', async () => {
    uploadAvatar.mockRejectedValue(new ApiError(415, 'The file must be a JPEG, PNG or WebP image.'))
    renderProfile()

    await startEditing()
    await pickPhoto()
    await save()

    expect(await screen.findByRole('alert')).toHaveTextContent('Formato de imagem não suportado.')
  })

  it('asks to save again when another change conflicted with the profile', async () => {
    updateProfile.mockRejectedValue(
      new ApiError(409, 'The operation conflicted with another concurrent change. Please try again.'),
    )
    renderProfile()

    await startEditing()
    await changeName('Ana Sousa')
    await save()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('O teu perfil foi alterado noutro sítio ao mesmo tempo. Tenta guardar outra vez.')
    expect(alert).not.toHaveTextContent('conflicted')
  })

  it('says the name was saved when only the photo failed', async () => {
    uploadAvatar.mockRejectedValue(new ApiError(415, 'The file must be a JPEG, PNG or WebP image.'))
    renderProfile()

    await startEditing()
    await changeName('Ana Sousa')
    await pickPhoto()
    await save()

    expect(updateProfile).toHaveBeenCalledWith({ user_name: 'Ana Sousa', user_location: 'Lisboa' })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('O nome e a localização foram guardados, mas a foto não foi alterada.')
    expect(alert).toHaveTextContent('Formato de imagem não suportado.')
  })

  it('shows its own message and closes the dialog when deleting the account conflicts', async () => {
    deleteAccount.mockRejectedValue(
      new ApiError(409, 'Account deactivation could not be completed due to a database conflict.'),
    )
    renderProfile()

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar conta' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sim, eliminar conta' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Não foi possível eliminar a conta agora. Tenta outra vez dentro de momentos.')
    expect(alert).not.toHaveTextContent('deactivation')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('ends the session on 401 instead of showing a message', async () => {
    updateProfile.mockRejectedValue(new ApiError(401, 'Not authenticated.'))
    renderProfile()

    await startEditing()
    await changeName('Ana Sousa')
    await save()

    expect(logout).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('ends the session and closes the dialog on 401 when deleting the account', async () => {
    deleteAccount.mockRejectedValue(new ApiError(401, 'Not authenticated.'))
    renderProfile()

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar conta' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sim, eliminar conta' }))

    expect(logout).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('explains a failed connection in Portuguese', async () => {
    updateProfile.mockRejectedValue(new ApiError(0, 'Could not reach the server. Check your connection.'))
    renderProfile()

    await startEditing()
    await changeName('Ana Sousa')
    await save()

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível contactar o servidor.')
  })
})
