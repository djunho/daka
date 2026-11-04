import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import OnlineBadge from './OnlineBadge'
import Avatar from './Avatar'

describe('OnlineBadge', () => {
  it('shows online state with accessible text', () => {
    render(<OnlineBadge online />)

    expect(screen.getByText('Online')).toHaveClass('sr-only')
  })

  it('shows offline label when showLabel is enabled', () => {
    render(<OnlineBadge online={false} showLabel />)

    expect(screen.getByText('Offline')).toBeVisible()
  })
})

describe('Avatar online badge', () => {
  it('only shows the badge when online is provided', () => {
    const { rerender } = render(<Avatar user_name="Ana" size="sm" />)

    expect(screen.queryByText('Online')).not.toBeInTheDocument()
    expect(screen.queryByText('Offline')).not.toBeInTheDocument()

    rerender(<Avatar user_name="Ana" size="sm" online={false} />)
    expect(screen.getByText('Offline')).toBeInTheDocument()
  })
})