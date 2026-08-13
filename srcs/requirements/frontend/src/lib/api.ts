// A thin wrapper around fetch for talking to our backend.
//
// Everything the frontend sends to the API goes through here, for three
// reasons that would otherwise be copy-pasted into every call:
//
//   1. credentials: 'include' -- without this, the browser does NOT send our
//      session cookie back to the server. The cookie is httpOnly (JavaScript
//      cannot read it), so this flag is the ONLY way the session travels. Miss
//      it and every request looks logged-out.
//
//   2. The /api prefix -- nginx routes /api/ to the backend. We set it once
//      here so callers write `request('/auth/login')`, not the full path.
//
//   3. Uniform errors -- the backend reports problems as a JSON body with a
//      "detail" field and an HTTP status. We turn that into one ApiError type
//      the UI can catch and show, instead of each caller parsing responses by
//      hand.

const API_BASE = '/api'

// Thrown on any non-2xx response. Carries the status code and the human message
// the backend put in "detail", so a component can show err.message directly.
export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

// The core request function. `T` is whatever shape the caller expects back.
export async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const { method = 'GET', body } = options

  let res: Response
  try {
    res = await fetch(API_BASE + path, {
      method,
      // Send the session cookie. This is the important line.
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    // fetch only rejects on a network-level failure (server down, no
    // connection) -- not on a 4xx/5xx, which resolve normally. Give the UI a
    // status 0 it can recognise as "could not reach the server".
    throw new ApiError(0, 'Could not reach the server. Check your connection.')
  }

  // 204 No Content (our logout) has no body to parse. Return early.
  if (res.status === 204) {
    return undefined as T
  }

  // Parse the body once. If it is not JSON for some reason, fall back to null
  // rather than throwing a second, confusing error.
  const data = await res.json().catch(() => null)

  if (!res.ok) {
    // FastAPI puts the message in "detail". Fall back to a generic line if the
    // shape is unexpected, so the user never sees "[object Object]".
    const detail =
      data && typeof data.detail === 'string'
        ? data.detail
        : 'Something went wrong. Please try again.'
    throw new ApiError(res.status, detail)
  }

  return data as T
}

// The user shape the backend returns (UserOut). Kept here next to the client so
// the API's contract lives in one place.
export type ApiUser = {
  id: number
  user_name: string
  email: string
  avatar: string | null
  user_location: string | null
  created_at: string
}

// --- The four auth calls, named so components read like prose. ---

export function apiRegister(user_name: string, email: string, password: string) {
  return request<ApiUser>('/auth/register', {
    method: 'POST',
    body: { user_name, email, password },
  })
}

export function apiLogin(email: string, password: string) {
  return request<ApiUser>('/auth/login', {
    method: 'POST',
    body: { email, password },
  })
}

export function apiLogout() {
  return request<void>('/auth/logout', { method: 'POST' })
}

export function apiMe() {
  return request<ApiUser>('/auth/me')
}