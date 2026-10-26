import { useState, useEffect, useRef, useCallback } from 'react'

export interface LocationItem {
  name: string
  type: 'concelho' | 'freguesia'
  concelho: string
  distrito: string
  label: string
}

export interface LocationAutocompleteProps {
  id: string
  label: string
  value: string
  placeholder?: string
  readOnly?: boolean
  disabled?: boolean
  ariaInvalid?: boolean
  ariaDescribedBy?: string
  onChange: (value: string) => void
}

// --- Configuration Constants ---
// Tweak these values to adjust autocomplete behavior across the application
const MAX_SUGGESTIONS = 8     // Maximum number of suggestions displayed in the dropdown
const MIN_SEARCH_LENGTH = 3   // Minimum characters required to trigger autocomplete search

// Pre-indexed location item with pre-normalized strings for high-performance filtering.
// Normalizing 3,400 items on every keystroke takes ~9 ms (up to 40+ ms on slower mobile devices).
// Pre-normalizing once when the dataset is loaded reduces keystroke filtering time to < 1 ms.
interface IndexedLocationItem extends LocationItem {
  _normalizedName: string
  _normalizedLabel: string
}

// Module-level in-memory cache:
// Holds the parsed 3,400 pre-indexed location items in client memory once loaded.
// This prevents redundant dynamic imports, network roundtrips, and repetitive JSON
// parsing across component re-renders, route navigations, or when multiple
// LocationAutocomplete instances are mounted within the current browser session.
let cachedLocations: IndexedLocationItem[] | null = null

// Normalization helper: strips accents and lowercases for accent-insensitive search
function normalizeText(text: string): string {
  return text
    // 1. Decompose accented characters into base letters + separate combining marks (e.g., 'ã' -> 'a' + '\u0303')
    .normalize('NFD')
    // 2. Remove all combining diacritical marks using the Unicode block range U+0300 (\u0300) to U+036F (\u036f).
    //    \u0300 is the first mark (Grave Accent `) and \u036f is the last (Combining Latin Small Letter X).
    //    This regex strips accents, tildes (~), circumflexes (^), and cedillas (e.g., 'ç' becomes 'c').
    .replace(/[\u0300-\u036f]/g, '')
    // 3. Convert to lowercase for case-insensitive matching
    .toLowerCase()
    // 4. Strip leading and trailing whitespace
    .trim()
}

export default function LocationAutocomplete({
  id,
  label,
  value,
  placeholder,
  readOnly = false,
  disabled = false,
  ariaInvalid = false,
  ariaDescribedBy,
  onChange,
}: LocationAutocompleteProps) {
  const [inputValue, setInputValue] = useState(value)
  const [suggestions, setSuggestions] = useState<LocationItem[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [isLoading, setIsLoading] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const isMouseDownInsideRef = useRef(false)
  const latestQueryRef = useRef('')

  // Synchronize internal state with external value changes
  useEffect(() => {
    setInputValue(value)
  }, [value])

  // Lazy-load the Portugal locations dataset on first interaction
  const ensureLocationsLoaded = useCallback(async (): Promise<IndexedLocationItem[]> => {
    // Fast path: if the dataset has already been loaded and cached in memory,
    // return it immediately without initiating any dynamic import or network request.
    if (cachedLocations) {
      return cachedLocations
    }
    setIsLoading(true)
    try {
      // Dynamic import (lazy loading): Vite code-splits portugalLocations.json (~64 KB gzipped) into a separate chunk.
      // It is fetched only when the component is focused/enabled and the user begins typing,
      // preventing bundle bloat on initial page load and improving overall frontend performance.
      const mod = await import('../data/portugalLocations.json')
      // Pre-compute normalized search strings once upon loading so subsequent keystrokes
      // run in < 1 ms without repetitive Unicode decomposition and Regex replaces.
      const raw = mod.default as LocationItem[]
      cachedLocations = raw.map((item) => ({
        ...item,
        _normalizedName: normalizeText(item.name),
        _normalizedLabel: normalizeText(item.label),
      }))
      return cachedLocations
    } catch {
      return []
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Filter suggestions when input changes
  const filterSuggestions = useCallback(async (query: string) => {
    latestQueryRef.current = query
    const trimmed = query.trim()
    // Require at least MIN_SEARCH_LENGTH characters before opening suggestions
    if (trimmed.length < MIN_SEARCH_LENGTH) {
      setSuggestions([])
      setIsOpen(false)
      setHighlightedIndex(-1)
      return
    }

    const data = await ensureLocationsLoaded()

    // Guard against race conditions during async dataset loading (dynamic import).
    // If the user modified or cleared the input while waiting (latestqueryRef changes in this case), discard this stale
    // resolution so we don't reopen suggestions with outdated search results.
    if (latestQueryRef.current !== query) {
      return
    }

    const norm = normalizeText(trimmed)

    const matches = data.filter((item) => {
      return item._normalizedLabel.includes(norm) || item._normalizedName.includes(norm)
    })

    // Sort: prioritize concelhos (municipalities) over freguesias (parishes),
    // then alphabetical by name
    matches.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'concelho' ? -1 : 1
      }
      return a.name.localeCompare(b.name, 'pt')
    })

    // Keep top matches for a clean, compact dropdown
    const topMatches = matches.slice(0, MAX_SUGGESTIONS)
    setSuggestions(topMatches)
    setIsOpen(true)
    setHighlightedIndex(-1)
  }, [ensureLocationsLoaded])

  // Close dropdown on click outside or Escape key
  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setHighlightedIndex(-1)
      }
    }

    function handleGlobalKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' || event.key === 'Esc') {
        event.preventDefault()
        setIsOpen(false)
        setHighlightedIndex(-1)
        inputRef.current?.focus()
      }
    }

    function handleMouseUp() {
      isMouseDownInsideRef.current = false
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('keydown', handleGlobalKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('keydown', handleGlobalKeyDown, true)
    }
  }, [isOpen])

  // Handle typing in the input
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVal = e.target.value
    setInputValue(nextVal)
    onChange(nextVal)
    void filterSuggestions(nextVal)
  }

  // Handle focusing on input
  const handleFocus = () => {
    if (readOnly || disabled) return
    void ensureLocationsLoaded()
    if (inputValue.trim().length >= MIN_SEARCH_LENGTH) {
      void filterSuggestions(inputValue)
    }
  }

  // Handle blurring out of input (e.g. Esc in Vimium, tabbing, clicking outside)
  const handleBlur = () => {
    // If the blur was caused by clicking or scrolling inside the dropdown, keep open
    if (isMouseDownInsideRef.current) {
      return
    }
    setIsOpen(false)
    setHighlightedIndex(-1)
  }

  // Handle clicking inside input (reopens suggestions if closed and valid)
  const handleClick = () => {
    if (readOnly || disabled) return
    if (!isOpen && inputValue.trim().length >= MIN_SEARCH_LENGTH) {
      void filterSuggestions(inputValue)
    }
  }

  // Handle selecting a suggested location
  const handleSelectLocation = (location: LocationItem) => {
    setInputValue(location.label)
    onChange(location.label)
    setIsOpen(false)
    setHighlightedIndex(-1)
    inputRef.current?.focus()
  }

  // Keyboard navigation within suggestions
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Escape key: always close dropdown immediately, prevent default browser blur/clear, and retain input focus
    if (e.key === 'Escape' || e.key === 'Esc') {
      if (isOpen) {
        e.preventDefault()
        e.stopPropagation()
        setIsOpen(false)
        setHighlightedIndex(-1)
        inputRef.current?.focus()
      }
      return
    }

    // Tab key: close dropdown when focus leaves
    if (e.key === 'Tab') {
      setIsOpen(false)
      setHighlightedIndex(-1)
      return
    }

    if (!isOpen || suggestions.length === 0) {
      if (e.key === 'ArrowDown' && inputValue.trim().length >= MIN_SEARCH_LENGTH) {
        e.preventDefault()
        void filterSuggestions(inputValue)
      }
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1))
    } else if (e.key === 'Enter') {
      if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
        e.preventDefault()
        handleSelectLocation(suggestions[highlightedIndex])
      }
    }
  }

  const inputClass =
    'w-full px-4 py-2.5 border rounded-xl text-ink text-sm placeholder:text-muted ' +
    'hover:bg-paper focus:outline-none transition-colors ' +
    (ariaInvalid
      ? 'border-accent focus:border-accent '
      : 'border-line hover:border-brand/50 focus:border-brand ') +
    (readOnly
      ? 'bg-paper/60 cursor-default caret-transparent selection:bg-transparent '
      : 'cursor-text bg-surface ') +
    (disabled ? 'opacity-60 cursor-not-allowed ' : '')

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseDown={() => {
        isMouseDownInsideRef.current = true
      }}
    >
      <label htmlFor={id} className="block text-xs font-medium text-muted mb-1.5">
        {label}
      </label>

      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          name="daka_location_query"
          type="text"
          value={inputValue}
          readOnly={readOnly}
          disabled={disabled}
          placeholder={placeholder}
          className={inputClass}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          role="combobox"
          // Accessible Rich Internet Applications (ARIA)
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          aria-expanded={isOpen}
          aria-autocomplete="list"
          aria-controls={isOpen ? `${id}-suggestions` : undefined}
          aria-activedescendant={
            isOpen && highlightedIndex >= 0 ? `${id}-option-${highlightedIndex}` : undefined
          }
        />

        {isLoading && (
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted text-xs animate-pulse">
            A carregar...
          </div>
        )}
      </div>

      {/* Autocomplete Suggestions Dropdown */}
      {!readOnly && isOpen && (
        <ul
          id={`${id}-suggestions`}
          role="listbox"
          className="absolute z-50 left-0 right-0 mt-1.5 bg-surface border border-line rounded-xl shadow-lg max-h-60 overflow-y-auto py-1 divide-y divide-line/40 focus:outline-none"
        >
          {suggestions.length > 0 ? (
            suggestions.map((item, index) => {
              const isHighlighted = index === highlightedIndex
              return (
                <li
                  key={`${item.type}-${item.label}-${index}`}
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={isHighlighted}
                  onMouseDown={(e) => {
                    // Prevent blur before selection completes
                    e.preventDefault()
                    handleSelectLocation(item)
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={
                    'px-4 py-2.5 text-sm cursor-pointer flex items-center justify-between transition-colors ' +
                    (isHighlighted ? 'bg-paper text-brand font-medium' : 'text-ink hover:bg-paper')
                  }
                >
                  <span className="truncate">{item.label}</span>
                  <span
                    className={
                      'text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-md ml-2 flex-shrink-0 ' +
                      (item.type === 'concelho'
                        ? 'bg-brand/10 text-brand'
                        : 'bg-paper text-muted')
                    }
                  >
                    {item.type === 'concelho' ? 'Concelho' : 'Freguesia'}
                  </span>
                </li>
              )
            })
          ) : (
            <li className="px-4 py-3 text-xs text-muted italic">
              Nenhuma localidade oficial encontrada. Pode manter a entrada manual.
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
