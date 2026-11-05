import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CategoryChips from './CategoryChips'
import type { ApiCategory } from '../lib/api'

const CATEGORIES: ApiCategory[] = [
  { id: 1, category_name: 'Books' },
  { id: 2, category_name: 'Clothing' },
  { id: 3, category_name: 'Games' },
  { id: 4, category_name: 'Music' },
  { id: 5, category_name: 'Toys' },
]

// jsdom has no layout, so the rows are faked: each chip reports the row it is
// on from its position in the list, as if `perRow` chips fit in a row.
function fakeRows(perRow: number) {
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
    if (!this.dataset.categoryId) return 0
    const chips = [...(this.parentElement?.children ?? [])]
    return Math.floor(chips.indexOf(this) / perRow) * 40
  })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(38)
}

function chip(name: string) {
  return screen.getByRole('button', { name, hidden: true })
}

describe('CategoryChips', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('has no toggle when every chip fits in one row', () => {
    fakeRows(10)
    render(<CategoryChips categories={CATEGORIES} active={null} onToggle={vi.fn()} />)

    expect(screen.queryByRole('button', { name: /Ver todas/ })).not.toBeInTheDocument()
    expect(chip('Brinquedos')).not.toHaveAttribute('inert')
  })

  it('has no toggle when the chips take only two rows', () => {
    fakeRows(3)
    render(<CategoryChips categories={CATEGORIES} active={null} onToggle={vi.fn()} />)

    expect(screen.queryByRole('button', { name: /Ver todas/ })).not.toBeInTheDocument()
    expect(chip('Brinquedos')).not.toHaveAttribute('inert')
  })

  it('shows only the first row until "Ver todas" is pressed, then hides it again with "Ver menos"', async () => {
    fakeRows(2)
    render(<CategoryChips categories={CATEGORIES} active={null} onToggle={vi.fn()} />)

    const toggle = screen.getByRole('button', { name: 'Ver todas as categorias (5)' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAttribute('aria-controls', screen.getByRole('navigation').id)
    expect(chip('Livros')).not.toHaveAttribute('inert')
    expect(chip('Roupas & Acessórios')).not.toHaveAttribute('inert')
    expect(chip('Jogos')).toHaveAttribute('inert')
    expect(chip('Brinquedos')).toHaveAttribute('inert')

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAccessibleName('Ver menos categorias')
    expect(chip('Brinquedos')).not.toHaveAttribute('inert')

    await userEvent.click(toggle)
    expect(toggle).toHaveAccessibleName('Ver todas as categorias (5)')
    expect(chip('Brinquedos')).toHaveAttribute('inert')
  })

  it('puts the selected category first while collapsed, and keeps the order while expanded', async () => {
    fakeRows(2)
    render(<CategoryChips categories={CATEGORIES} active={5} onToggle={vi.fn()} />)

    const names = () => screen.getAllByRole('button', { hidden: true })
      .filter((b) => b.dataset.categoryId)
      .map((b) => b.textContent)
    expect(names()[0]).toBe('Brinquedos')
    expect(chip('Brinquedos')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('Brinquedos')).not.toHaveAttribute('inert')

    await userEvent.click(screen.getByRole('button', { name: /Ver todas/ }))
    expect(names()).toEqual(['Livros', 'Roupas & Acessórios', 'Jogos', 'Música', 'Brinquedos'])
  })

  it('reports the chip that was pressed', async () => {
    fakeRows(10)
    const onToggle = vi.fn()
    render(<CategoryChips categories={CATEGORIES} active={null} onToggle={onToggle} />)

    await userEvent.click(chip('Jogos'))
    expect(onToggle).toHaveBeenCalledWith(3)
  })
})
