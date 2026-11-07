import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, uploadWithProgress } from './api'

// A stand-in for XMLHttpRequest: the test decides when bytes go out and what
// the server answers.
class FakeXhr {
  static last: FakeXhr
  method = ''
  url = ''
  withCredentials = false
  status = 0
  responseText = ''
  body: FormData | null = null
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  onabort: (() => void) | null = null

  constructor() {
    FakeXhr.last = this
  }
  open(method: string, url: string) {
    this.method = method
    this.url = url
  }
  send(body: FormData) {
    this.body = body
  }
  abort() {
    this.onabort?.()
  }
  // Test helpers
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total })
  }
  answer(status: number, body: string) {
    this.status = status
    this.responseText = body
    this.onload?.()
  }
}

// The error a promise rejects with (the test fails if it resolves).
async function failure(promise: Promise<unknown>): Promise<Error & { status?: number }> {
  try {
    await promise
  } catch (err) {
    return err as Error & { status?: number }
  }
  throw new Error('expected the upload to fail')
}

const file = new File(['%PDF-1.4'], 'manual.pdf', { type: 'application/pdf' })

describe('uploadWithProgress', () => {
  beforeEach(() => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the file in a "file" field to /api, with the session cookie, and reports progress', async () => {
    const onProgress = vi.fn()
    const result = uploadWithProgress<{ id: number }>('/listings/7/documents', 'POST', file, { onProgress })
    const xhr = FakeXhr.last

    expect(xhr.method).toBe('POST')
    expect(xhr.url).toBe('/api/listings/7/documents')
    expect(xhr.withCredentials).toBe(true)
    expect(xhr.body!.get('file')).toBe(file)

    xhr.progress(50, 200)
    xhr.progress(200, 200)
    xhr.answer(201, '{"id":7}')

    await expect(result).resolves.toEqual({ id: 7 })
    expect(onProgress.mock.calls).toEqual([[0.25], [1]])
  })

  it('turns a non-2xx answer into ApiError with the backend detail', async () => {
    const result = uploadWithProgress('/auth/me/avatar', 'PUT', file)
    FakeXhr.last.answer(413, '{"detail":"Image is too large."}')

    await expect(result).rejects.toEqual(new ApiError(413, 'Image is too large.'))
  })

  it('uses a generic message when the error body is not JSON', async () => {
    const result = uploadWithProgress('/auth/me/avatar', 'PUT', file)
    FakeXhr.last.answer(502, '<html>Bad Gateway</html>')

    const err = await failure(result)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(502)
    expect(err.message).toBe('Something went wrong. Please try again.')
  })

  it('reports a network failure as status 0, like request()', async () => {
    const result = uploadWithProgress('/auth/me/avatar', 'PUT', file)
    FakeXhr.last.onerror!()

    const err = await failure(result)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(0)
  })

  it('resolves with undefined on 204', async () => {
    const result = uploadWithProgress('/x', 'POST', file)
    FakeXhr.last.answer(204, '')

    await expect(result).resolves.toBeUndefined()
  })

  it('cancels with an AbortError, not a network error', async () => {
    const controller = new AbortController()
    const result = uploadWithProgress('/x', 'POST', file, { signal: controller.signal })
    controller.abort()

    const err = await failure(result)
    expect(err).not.toBeInstanceOf(ApiError)
    expect(err.name).toBe('AbortError')
  })

  it('does not even start when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    FakeXhr.last = undefined as unknown as FakeXhr

    const err = await failure(uploadWithProgress('/x', 'POST', file, { signal: controller.signal }))

    expect(err.name).toBe('AbortError')
    expect(FakeXhr.last).toBeUndefined()
  })
})
