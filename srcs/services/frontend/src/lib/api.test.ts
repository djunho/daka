import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiCreateNegotiation, apiListNegotiations } from './api'

describe('apiListNegotiations', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubFetch() {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"items":[]}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('sends only the parameters given, including an offset of 0', async () => {
    const fetchMock = stubFetch()

    await apiListNegotiations({ role: 'owner', state: 'Open', limit: 20, offset: 0 })

    expect(fetchMock.mock.calls[0][0]).toMatch(/\/negotiations\?role=owner&state=Open&limit=20&offset=0$/)
  })

  it('has no query string without parameters', async () => {
    const fetchMock = stubFetch()

    await apiListNegotiations()

    expect(fetchMock.mock.calls[0][0]).toMatch(/\/negotiations$/)
  })

  it('passes the signal to fetch, and a cancelled request is not reported as a network failure', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    const pending = apiListNegotiations({}, controller.signal)
    controller.abort()

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})

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
