import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import Avatar from './Avatar'

const GOOGLE_AVATAR = 'https://lh3.googleusercontent.com/a/photo=s96-c'

describe('Avatar', () => {
  it('loads the photo without sending our page as Referer', () => {
    render(<Avatar avatar={GOOGLE_AVATAR} user_name="Ana" />)

    const img = screen.getByRole('img', { name: 'Ana' })
    expect(img).toHaveAttribute('src', GOOGLE_AVATAR)
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer')
  })

  it('shows the initial when the photo fails to load', () => {
    render(<Avatar avatar={GOOGLE_AVATAR} user_name="ana" />)

    fireEvent.error(screen.getByRole('img', { name: 'ana' }))

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('tries a new photo again after a previous one failed', () => {
    const { rerender } = render(<Avatar avatar={GOOGLE_AVATAR} user_name="Ana" />)
    fireEvent.error(screen.getByRole('img', { name: 'Ana' }))

    rerender(<Avatar avatar="/media/avatars/new.webp" user_name="Ana" />)

    expect(screen.getByRole('img', { name: 'Ana' })).toHaveAttribute('src', '/media/avatars/new.webp')
  })
})
