import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import Icon, { ICON_NAMES } from './Icon'

describe('Icon', () => {
  it('is decorative by default: hidden from screen readers', () => {
    const { container } = render(<Icon name="close" />)
    const svg = container.querySelector('svg')!

    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).not.toHaveAttribute('role')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('is announced as an image when it has a label', () => {
    render(<Icon name="warning" label="Erro" />)

    expect(screen.getByRole('img', { name: 'Erro' })).not.toHaveAttribute('aria-hidden')
  })

  it('takes the text color and the requested size', () => {
    const { container } = render(<Icon name="swap" size={16} className="text-accent" />)
    const svg = container.querySelector('svg')!

    expect(svg).toHaveAttribute('stroke', 'currentColor')
    expect(svg).toHaveAttribute('width', '16')
    expect(svg).toHaveAttribute('height', '16')
    expect(svg).toHaveClass('shrink-0', 'text-accent')
  })

  it('draws every icon of the set', () => {
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />)
      expect(container.querySelector('svg')!.childElementCount, name).toBeGreaterThan(0)
      unmount()
    }
  })
})
