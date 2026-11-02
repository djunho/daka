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
  hideLabel?: boolean
  className?: string
  inputClassName?: string
  ariaInvalid?: boolean
  ariaDescribedBy?: string
  // Fired when the committed location value changes (selected from the list or cleared).
  onChange: (value: string) => void
  // Fired when the user explicitly picks or auto-completes a suggestion.
  onSelect?: (value: string) => void
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
let loadingLocationsPromise: Promise<IndexedLocationItem[] | null> | null = null

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

// Relevance tier for sorting: exact name > exact label > name prefix > name substring > label substring
function getMatchRank(item: IndexedLocationItem, normQuery: string): number {
  if (item._normalizedName === normQuery) return 0
  if (item._normalizedLabel === normQuery) return 1
  if (item._normalizedName.startsWith(normQuery)) return 2
  if (item._normalizedName.includes(normQuery)) return 3
  return 4
}

function getTopSuggestions(query: string, data: IndexedLocationItem[]): IndexedLocationItem[] {
  const trimmed = query.trim()
  if (trimmed.length < MIN_SEARCH_LENGTH) return []

  const norm = normalizeText(trimmed)
  if (!norm) return []

  const matches = data.filter(
    (item) => item._normalizedLabel.includes(norm) || item._normalizedName.includes(norm),
  )

  matches.sort((a, b) => {
    const rankDiff = getMatchRank(a, norm) - getMatchRank(b, norm)
    if (rankDiff !== 0) return rankDiff
    if (a.type !== b.type) return a.type === 'concelho' ? -1 : 1
    return a.name.localeCompare(b.name, 'pt')
  })

  return matches.slice(0, MAX_SUGGESTIONS)
}

// Returns an unambiguous canonical item only when the typed text matches an exact
// label, an exact municipality name (all 308 are unique), or a unique parish name.
function findAutoMatch(query: string, data: IndexedLocationItem[]): IndexedLocationItem | null {
  const trimmed = query.trim()
  if (!trimmed) return null

  const norm = normalizeText(trimmed)
  if (!norm) return null

  const exactLabel = data.find((item) => item._normalizedLabel === norm)
  if (exactLabel) return exactLabel

  const exactConcelho = data.find(
    (item) => item.type === 'concelho' && item._normalizedName === norm,
  )
  if (exactConcelho) return exactConcelho

  const exactFreguesias = data.filter(
    (item) => item.type === 'freguesia' && item._normalizedName === norm,
  )
  if (exactFreguesias.length === 1) return exactFreguesias[0]

  return null
}

export default function LocationAutocomplete({
  id,
  label,
  value,
  placeholder,
  readOnly = false,
  disabled = false,
  hideLabel = false,
  className = '',
  inputClassName = '',
  ariaInvalid = false,
  ariaDescribedBy,
  onChange,
  onSelect,
}: LocationAutocompleteProps) {
  const [inputValue, setInputValue] = useState(value)
  const [suggestions, setSuggestions] = useState<LocationItem[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const isMouseDownInsideRef = useRef(false)
  const latestQueryRef = useRef(value)
  const lastEmittedValueRef = useRef(value)

  const emitChange = useCallback(
    (nextCommitted: string) => {
      if (lastEmittedValueRef.current !== nextCommitted) {
        lastEmittedValueRef.current = nextCommitted
        onChange(nextCommitted)
      }
    },
    [onChange],
  )

  // Synchronize internal state only when `value` changes externally (e.g. "Limpar filtros",
  // "Cancelar", browser Back/Forward) or when returning to readOnly mode.
  useEffect(() => {
    if (value !== lastEmittedValueRef.current) {
      lastEmittedValueRef.current = value
      latestQueryRef.current = value
      setInputValue(value)
    } else if (readOnly) {
      latestQueryRef.current = value
      setInputValue(value)
    }
  }, [value, readOnly])

  // Lazy-load the Portugal locations dataset on first interaction
  const ensureLocationsLoaded = useCallback(async (): Promise<IndexedLocationItem[] | null> => {
    if (cachedLocations) {
      setLoadError(false)
      return cachedLocations
    }
    setIsLoading(true)
    try {
      if (!loadingLocationsPromise) {
        // Dynamic import (lazy loading): Vite code-splits portugalLocations.json (~64 KB gzipped) into a separate chunk.
        loadingLocationsPromise = import('../data/portugalLocations.json')
          .then((mod) => {
            const raw = mod.default as LocationItem[]
            cachedLocations = raw.map((item) => ({
              ...item,
              _normalizedName: normalizeText(item.name),
              _normalizedLabel: normalizeText(item.label),
            }))
            return cachedLocations
          })
          .catch(() => null)
          .finally(() => {
            loadingLocationsPromise = null
          })
      }
      const result = await loadingLocationsPromise
      setLoadError(result === null)
      return result
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Filter suggestions and keep committed parent value synced with unambiguous matches
  const updateSuggestionsForQuery = useCallback(
    async (query: string, syncCommitted: boolean) => {
      latestQueryRef.current = query
      const trimmed = query.trim()

      if (trimmed === '') {
        if (syncCommitted) emitChange('')
        setSuggestions([])
        setIsOpen(false)
        setHighlightedIndex(-1)
        return
      }

      // Fast synchronous path when dataset is already in memory
      if (cachedLocations) {
        if (syncCommitted) {
          const autoMatch = findAutoMatch(query, cachedLocations)
          emitChange(autoMatch ? autoMatch.label : '')
        }
        if (trimmed.length < MIN_SEARCH_LENGTH) {
          setSuggestions([])
          setIsOpen(false)
          setHighlightedIndex(-1)
          return
        }
        setSuggestions(getTopSuggestions(query, cachedLocations))
        if (document.activeElement === inputRef.current) {
          setIsOpen(true)
        }
        setHighlightedIndex(-1)
        return
      }

      const data = await ensureLocationsLoaded()

      // Discard stale async resolutions if the input changed while loading
      if (latestQueryRef.current !== query) {
        return
      }

      if (!data) {
        setSuggestions([])
        if (trimmed.length >= MIN_SEARCH_LENGTH && document.activeElement === inputRef.current) {
          setIsOpen(true)
        }
        setHighlightedIndex(-1)
        return
      }

      if (syncCommitted) {
        const autoMatch = findAutoMatch(query, data)
        emitChange(autoMatch ? autoMatch.label : '')
      }

      if (trimmed.length < MIN_SEARCH_LENGTH) {
        setSuggestions([])
        setIsOpen(false)
        setHighlightedIndex(-1)
        return
      }

      // Do not reopen dropdown if the input already lost focus while loading
      if (document.activeElement !== inputRef.current) {
        return
      }

      setSuggestions(getTopSuggestions(query, data))
      setIsOpen(true)
      setHighlightedIndex(-1)
    },
    [emitChange, ensureLocationsLoaded],
  )

  // Resolve uncommitted free text on blur into an exact canonical label or clear it
  const commitOrResetInput = useCallback(() => {
    setIsOpen(false)
    setHighlightedIndex(-1)

    const currentQuery = inputValue
    if (currentQuery.trim() === '') {
      setInputValue('')
      emitChange('')
      return
    }

    if (currentQuery === value) {
      return
    }

    if (cachedLocations) {
      const autoMatch = findAutoMatch(currentQuery, cachedLocations)
      if (autoMatch) {
        setInputValue(autoMatch.label)
        emitChange(autoMatch.label)
      } else {
        setInputValue('')
        emitChange('')
      }
      return
    }

    // Dataset is still loading (or failed): wait for it before deciding so we never wipe valid text prematurely
    void ensureLocationsLoaded().then((data) => {
      if (document.activeElement === inputRef.current) return
      if (latestQueryRef.current !== currentQuery) return
      if (!data) {
        // Preserve last valid committed value if dataset chunk could not be loaded
        setInputValue(lastEmittedValueRef.current)
        return
      }
      const autoMatch = findAutoMatch(currentQuery, data)
      if (autoMatch) {
        setInputValue(autoMatch.label)
        emitChange(autoMatch.label)
      } else {
        setInputValue('')
        emitChange('')
      }
    })
  }, [emitChange, ensureLocationsLoaded, inputValue, value])

  // Close dropdown on click outside or Escape key
  useEffect(() => {
    if (!isOpen) {
      isMouseDownInsideRef.current = false
      return
    }

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        isMouseDownInsideRef.current = false
        // When the input still has focus, its own onBlur will run immediately after mousedown
        if (document.activeElement !== inputRef.current) {
          commitOrResetInput()
        }
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
      isMouseDownInsideRef.current = false
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('keydown', handleGlobalKeyDown, true)
    }
  }, [commitOrResetInput, isOpen])

  // Handle typing in the input
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVal = e.target.value
    setInputValue(nextVal)
    void updateSuggestionsForQuery(nextVal, true)
  }

  // Handle focusing on input
  const handleFocus = () => {
    if (readOnly || disabled) return
    void ensureLocationsLoaded()
    if (inputValue.trim().length >= MIN_SEARCH_LENGTH) {
      void updateSuggestionsForQuery(inputValue, false)
    }
  }

  // Handle blurring out of input (e.g. Esc in Vimium, tabbing, clicking outside)
  const handleBlur = () => {
    // If the blur was caused by clicking or scrolling inside the dropdown list, keep open
    if (isMouseDownInsideRef.current) {
      return
    }
    commitOrResetInput()
  }

  // Handle clicking inside input (reopens suggestions if closed and valid)
  const handleClick = () => {
    if (readOnly || disabled) return
    if (!isOpen && inputValue.trim().length >= MIN_SEARCH_LENGTH) {
      void updateSuggestionsForQuery(inputValue, false)
    }
  }

  // Handle selecting a suggested location
  const handleSelectLocation = (location: LocationItem) => {
    latestQueryRef.current = location.label
    setInputValue(location.label)
    emitChange(location.label)
    onSelect?.(location.label)
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

    // Tab key: onBlur will commit or reset the input when focus leaves
    if (e.key === 'Tab') {
      return
    }

    if (e.key === 'Enter') {
      if (isOpen && highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
        e.preventDefault()
        handleSelectLocation(suggestions[highlightedIndex])
        return
      }

      if (inputValue.trim() === '') {
        setInputValue('')
        emitChange('')
        setIsOpen(false)
        setHighlightedIndex(-1)
        return
      }

      if (!cachedLocations) {
        e.preventDefault()
        const queryAtEnter = inputValue
        void ensureLocationsLoaded().then((data) => {
          if (!data || latestQueryRef.current !== queryAtEnter) return
          const autoMatch = findAutoMatch(queryAtEnter, data)
          if (autoMatch) {
            handleSelectLocation(autoMatch)
          }
        })
        return
      }

      const autoMatch = findAutoMatch(inputValue, cachedLocations)
      if (autoMatch) {
        if (inputValue !== autoMatch.label || isOpen) {
          e.preventDefault()
          handleSelectLocation(autoMatch)
        }
        return
      }

      // Ambiguous or unmatched text: prevent form submission; keep list open if suggestions exist so user can pick one
      e.preventDefault()
      if (!isOpen || suggestions.length === 0) {
        setInputValue('')
        emitChange('')
        setIsOpen(false)
        setHighlightedIndex(-1)
      }
      return
    }

    if (!isOpen || suggestions.length === 0) {
      if (e.key === 'ArrowDown' && inputValue.trim().length >= MIN_SEARCH_LENGTH) {
        e.preventDefault()
        void updateSuggestionsForQuery(inputValue, false)
      }
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1))
    }
  }

  const customTokens = inputClassName.trim() ? inputClassName.trim().split(/\s+/) : []
  const hasCustomRounded = customTokens.some((token) => token.startsWith('rounded-'))
  const hasCustomBg = customTokens.some((token) => token.startsWith('bg-'))

  const inputClass =
    'w-full px-4 py-2.5 border text-ink text-sm placeholder:text-muted ' +
    (hasCustomRounded ? '' : 'rounded-xl ') +
    'hover:bg-paper focus:outline-none transition-colors ' +
    (ariaInvalid
      ? 'border-accent focus:border-accent '
      : 'border-line hover:border-brand/50 focus:border-brand ') +
    (readOnly
      ? 'bg-paper/60 cursor-default caret-transparent selection:bg-transparent '
      : `cursor-text ${hasCustomBg ? '' : 'bg-surface '}`) +
    (disabled ? 'opacity-60 cursor-not-allowed ' : '') +
    inputClassName

  return (
    <div
      ref={containerRef}
      className={`relative${className ? ` ${className}` : ''}`}
    >
      <label
        htmlFor={id}
        className={hideLabel ? 'sr-only' : 'block text-xs font-medium text-muted mb-1.5'}
      >
        {label}
      </label>

      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          name="daka_location_query"
          type="text"
          maxLength={200}
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
          onMouseDown={() => {
            isMouseDownInsideRef.current = true
          }}
          onMouseLeave={() => setHighlightedIndex(-1)}
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
          ) : loadError ? (
            <li className="px-4 py-3 text-xs text-accent">
              Não foi possível carregar as localidades. Verifica a ligação e tenta novamente.
            </li>
          ) : (
            <li className="px-4 py-3 text-xs text-muted italic">
              Nenhuma localidade encontrada.
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
