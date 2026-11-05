import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useState } from 'react'
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

// jsdom has no ResizeObserver. This one records what is observed and lets the
// test fire a resize, as the browser would when the web font arrives.
function fakeResizeObserver() {
  const observed: Element[] = []
  let notify = () => {}
  class FakeResizeObserver {
    constructor(callback: () => void) {
      notify = callback
    }
    observe(target: Element) {
      observed.push(target)
    }
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  return { observed, resize: () => act(() => notify()) }
}

// Holds the selected category the way Home does, so a chip can be cleared.
function StatefulChips({ initial }: { initial: number | null }) {
  const [active, setActive] = useState<number | null>(initial)
  return <CategoryChips categories={CATEGORIES} active={active} onToggle={(id) => setActive((a) => (a === id ? null : id))} />
}

describe('CategoryChips', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
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

  it('measures again when a chip changes size, e.g. when the web font arrives', () => {
    const { observed, resize } = fakeResizeObserver()
    let perRow = 2
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      if (!this.dataset.categoryId) return 0
      return Math.floor([...(this.parentElement?.children ?? [])].indexOf(this) / perRow) * 40
    })
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(38)
    render(<CategoryChips categories={CATEGORIES} active={null} onToggle={vi.fn()} />)

    // The row and every chip are watched: while collapsed the row's size is
    // fixed, so only the chips notice the font change.
    expect(observed).toContain(screen.getByRole('navigation'))
    expect(observed).toContain(chip('Livros'))
    expect(chip('Roupas & Acessórios')).not.toHaveAttribute('inert')

    // The wider font leaves room for one chip per row.
    perRow = 1
    resize()
    expect(chip('Livros')).not.toHaveAttribute('inert')
    expect(chip('Roupas & Acessórios')).toHaveAttribute('inert')
  })

  it('moves the focus to the toggle when the cleared category goes back to a hidden row', async () => {
    fakeRows(2)
    render(<StatefulChips initial={5} />)

    // While collapsed, the selected Brinquedos is first and visible.
    const toys = chip('Brinquedos')
    expect(toys).not.toHaveAttribute('inert')

    // Clearing it puts it back in its place, in a hidden row.
    await userEvent.click(toys)
    expect(toys).toHaveAttribute('aria-pressed', 'false')
    expect(toys).toHaveAttribute('inert')
    expect(screen.getByRole('button', { name: /Ver todas/ })).toHaveFocus()
  })

  it('reports the chip that was pressed', async () => {
    fakeRows(10)
    const onToggle = vi.fn()
    render(<CategoryChips categories={CATEGORIES} active={null} onToggle={onToggle} />)

    await userEvent.click(chip('Jogos'))
    expect(onToggle).toHaveBeenCalledWith(3)
  })
})
