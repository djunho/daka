import { useId, useLayoutEffect, useRef, useState } from 'react'
import { categoryLabel } from '../types/listing'
import type { ApiCategory } from '../lib/api'

type CategoryChipsProps = {
  categories: ApiCategory[]
  active: number | null
  onToggle: (id: number) => void
}

// The focus ring (index.css) draws 4px outside each chip. The clipped row gets
// this much room on every side so the ring is not cut off.
const RING_ROOM_PX = 4

// Collapsing two rows to one plus the toggle's own line saves almost nothing
// (about 10px), so the chips are only collapsed from three rows up.
const MIN_ROWS_TO_COLLAPSE = 3

// The category filter of the home page. When the chips need three rows or more
// (on a phone they take four or five), only the first row is shown, with a
// button to see the rest. The rows are measured, not guessed from a
// breakpoint, so on a wide screen where they fit there is no button at all.
export default function CategoryChips({ categories, active, onToggle }: CategoryChipsProps) {
  const [expanded, setExpanded] = useState<boolean>(false)
  // Ids of the chips that wrap past the first row, how many rows there are,
  // and the first row's height.
  const [overflowIds, setOverflowIds] = useState<number[]>([])
  const [rows, setRows] = useState<number>(1)
  const [rowHeight, setRowHeight] = useState<number>(0)
  const navRef = useRef<HTMLElement>(null)
  const navId = useId()

  // While collapsed, the selected category comes first, so the filter in use is
  // never hidden. While expanded the order stays put, so chips do not jump
  // under the finger.
  const ordered =
    !expanded && active !== null
      ? [...categories].sort((a, b) => Number(b.id === active) - Number(a.id === active))
      : categories
  const orderKey = ordered.map((c) => c.id).join(',')

  // Measures which chips wrap. The chips keep wrapping when the row is
  // clipped, so the measure is the same whether it is expanded or not.
  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    function measure() {
      if (!nav) return
      const chips = [...nav.querySelectorAll<HTMLElement>('[data-category-id]')]
      const firstTop = chips[0]?.offsetTop ?? 0
      const ids = chips.filter((chip) => chip.offsetTop > firstTop).map((chip) => Number(chip.dataset.categoryId))
      setOverflowIds((prev) => (prev.join(',') === ids.join(',') ? prev : ids))
      setRows(new Set(chips.map((chip) => chip.offsetTop)).size || 1)
      setRowHeight(chips[0]?.offsetHeight ?? 0)
    }
    measure()
    // Measured again when the width changes, e.g. when the phone is rotated.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(nav)
    return () => observer.disconnect()
  }, [orderKey])

  const canCollapse = rows >= MIN_ROWS_TO_COLLAPSE
  const collapsed = canCollapse && !expanded

  // A chip clipped out of sight must not take the keyboard focus or be read by
  // screen readers. React 18 does not know the inert attribute, so it is set here.
  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    for (const chip of nav.querySelectorAll<HTMLElement>('[data-category-id]')) {
      chip.toggleAttribute('inert', collapsed && overflowIds.includes(Number(chip.dataset.categoryId)))
    }
  }, [collapsed, overflowIds, orderKey])

  return (
    // The toggle sits under the chips rather than beside them: beside them it
    // would take a third of a phone's width and leave room for a single chip.
    <div className="px-4 sm:px-6 pt-5 pb-2">
      <nav
        ref={navRef}
        id={navId}
        aria-label="Filtrar por categoria"
        className="relative flex flex-wrap gap-2 -m-1 p-1 overflow-hidden"
        style={collapsed ? { maxHeight: rowHeight + 2 * RING_ROOM_PX } : undefined}
      >
        {ordered.map((cat) => (
          <button
            key={cat.id}
            type="button"
            data-category-id={cat.id}
            className="px-3.5 py-2 rounded-full border border-line bg-surface text-muted capitalize font-semibold text-sm transition-colors hover:border-brand aria-pressed:bg-brand-soft aria-pressed:border-brand-soft aria-pressed:text-brand"
            aria-pressed={active === cat.id}
            onClick={() => onToggle(cat.id)}
          >
            {categoryLabel(cat)}
          </button>
        ))}
      </nav>

      {canCollapse && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={navId}
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 min-h-9 mt-1 text-sm font-semibold text-brand hover:underline"
        >
          {/* The hidden words keep the name clear out of context, e.g. in a
              screen reader's list of buttons. */}
          {expanded ? (
            <>Ver menos<span className="sr-only"> categorias</span><span aria-hidden="true">▴</span></>
          ) : (
            <>Ver todas<span className="sr-only"> as categorias</span> ({categories.length})<span aria-hidden="true">▾</span></>
          )}
        </button>
      )}
    </div>
  )
}
