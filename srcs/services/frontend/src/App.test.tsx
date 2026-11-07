import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'

describe('App routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    window.history.pushState({}, '', '/')
  })

  it('opens the design system page at /design-system instead of the 404 page', async () => {
    // A visitor: the session check on load answers "no user".
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('{"user":null}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ))
    // Layout scrolls to the top on every route change; jsdom has no scrolling.
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    window.history.pushState({}, '', '/design-system')

    render(<App />)

    // The page is loaded on demand (React.lazy), hence findBy.
    expect(await screen.findByRole('heading', { level: 1, name: 'Design system' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Design system' })).toHaveAttribute('href', '/design-system')
  })
})
