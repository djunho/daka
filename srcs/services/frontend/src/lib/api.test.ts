import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apiCreateNegotiation,
  apiCreateProposal,
  apiListNegotiationMessages,
  apiListNegotiations,
} from './api'

describe('apiCreateProposal', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([[7], [null]])('always sends offered_listing_id, here %s', async (offered) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"id":1}', { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await apiCreateProposal(20, offered)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/negotiations\/20\/proposals$/)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ offered_listing_id: offered })
  })
})

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

describe('apiListNegotiationMessages', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubFetch() {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [], limit: 50, next_before_id: null, has_more: false }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('sends only the parameters given, including limit or before_id of 0', async () => {
    const fetchMock = stubFetch()

    await apiListNegotiationMessages(42, { limit: 0, before_id: 0 })

    expect(fetchMock.mock.calls[0][0]).toMatch(/\/negotiations\/42\/messages\?limit=0&before_id=0$/)
  })

  it('has no query string without parameters', async () => {
    const fetchMock = stubFetch()

    await apiListNegotiationMessages(42)

    expect(fetchMock.mock.calls[0][0]).toMatch(/\/negotiations\/42\/messages$/)
  })

  it('passes the signal to fetch, and a cancelled request is not reported as a network failure', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    const pending = apiListNegotiationMessages(42, { signal: controller.signal })
    controller.abort()

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
