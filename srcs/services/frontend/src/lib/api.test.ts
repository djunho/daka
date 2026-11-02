import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiCreateNegotiation } from './api'

describe('apiCreateNegotiation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([201, 200])('posts the listing id and returns the body of a %i', async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 20 }), { status }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiCreateNegotiation(5)).resolves.toEqual({ id: 20 })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/negotiations$/)
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(JSON.parse(init.body)).toEqual({ listing_id: 5 })
  })
})
