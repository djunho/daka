import { createRef } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import Button, { buttonClasses } from './Button'

describe('Button', () => {
  it('passes a ref to the native button, so a page can move the focus to it', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<Button ref={ref}>Criar proposta</Button>)

    expect(ref.current).toBe(screen.getByRole('button', { name: 'Criar proposta' }))
    ref.current!.focus()
    expect(screen.getByRole('button', { name: 'Criar proposta' })).toHaveFocus()
  })

  it('never submits a form unless asked to', () => {
    render(<Button>Limpar</Button>)

    expect(screen.getByRole('button', { name: 'Limpar' })).toHaveAttribute('type', 'button')
  })

  it('draws the link variant without a box, so it fits inside a sentence', () => {
    const classes = buttonClasses({ variant: 'link', size: 'sm' }).split(' ')

    expect(classes).toContain('text-brand')
    expect(classes).toContain('text-xs')
    expect(classes.some((c) => /^(px|py)-/.test(c) || c.startsWith('rounded'))).toBe(false)
  })
})
