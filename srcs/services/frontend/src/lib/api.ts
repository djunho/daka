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
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const { method = 'GET', body, signal } = options

  // FormData (file uploads) is sent as-is: the browser writes the multipart
  // Content-Type itself, including the "boundary" that separates the parts.
  // Setting the header by hand would leave the boundary out and break it.
  const isForm = body instanceof FormData

  let res: Response
  try {
    res = await fetch(API_BASE + path, {
      method,
      // Send the session cookie. This is the important line.
      credentials: 'include',
      headers: body && !isForm ? { 'Content-Type': 'application/json' } : {},
      body: isForm ? body : body ? JSON.stringify(body) : undefined,
      signal,
    })
  } catch (err) {
    // The caller cancelled the request on purpose: pass that on unchanged,
    // instead of reporting it as a connection problem.
    if (signal?.aborted) throw err
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

// The user shapes the backend returns. Kept here next to the client so the
// API's contract lives in one place.
//
// ApiPublicUser (PublicUserOut) is what anyone may see, e.g. a listing's owner.
// ApiUser (UserOut) is the logged-in user, with the private fields on top.
export type ApiPublicUser = {
  id: number
  user_name: string
  avatar: string | null
  user_location: string | null
}

export type ApiUser = ApiPublicUser & {
  email: string
  created_at: string
}

export type ApiCategory = {
  id: number
  category_name: string
}

export type ApiCondition = {
  id: number
  condition_name: string
}

export type ApiImage = {
  id: number
  image_path: string
  is_primary: boolean
}

export type ApiListingSummary = {
  id: number
  title: string
  category: ApiCategory
  condition: ApiCondition
  listing_location: string | null
  wish: string | null
  owner: ApiPublicUser
  cover_image: string | null
  created_at: string
}

export type ApiListingDetail = ApiListingSummary & {
  listing_dsc: string | null
  images: ApiImage[]
  is_favorited: boolean
}

export type ApiListingPage = {
  items: ApiListingSummary[]
  total: number
  limit: number
  offset: number
}

export type ApiPublicProfile = ApiPublicUser & {
  created_at: string
  listings: ApiListingSummary[]
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

export function apiDeleteAccount(): Promise<void> {
  return request<void>('/auth/me', { method: 'DELETE' })
}

export type UpdateProfileData = {
  user_name?: string
  user_location?: string | null
}

export function apiUpdateProfile(data: UpdateProfileData) {
  return request<ApiUser>('/auth/me', {
    method: 'PATCH',
    body: data,
  })
}

// The avatar has its own endpoints. The file travels as multipart/form-data
// in a field named "file", which is the name the backend's UploadFile expects.
export function apiUploadAvatar(file: File) {
  const form = new FormData()
  form.append('file', file)
  return request<ApiUser>('/auth/me/avatar', { method: 'PUT', body: form })
}

export function apiDeleteAvatar() {
  return request<ApiUser>('/auth/me/avatar', { method: 'DELETE' })
}

export type ListingSort = 'newest' | 'oldest' | 'title_asc' | 'title_desc'

// Every filter is optional. Only the ones given end up in the URL.
export type ListListingsParams = {
  q?: string
  category_id?: number
  user_id?: number
  location?: string
  sort?: ListingSort
  limit?: number
  offset?: number
}

export function apiListListings(params: ListListingsParams = {}) {
  const query = new URLSearchParams()

  // Text filters: trim them, and skip empty ones so "?q=" is never sent.
  const q = params.q?.trim()
  const location = params.location?.trim()
  if (q) query.set('q', q)
  if (location) query.set('location', location)
  if (params.sort) query.set('sort', params.sort)

  // Numbers: compare with undefined, because 0 is a valid offset.
  if (params.category_id !== undefined) query.set('category_id', String(params.category_id))
  if (params.user_id !== undefined) query.set('user_id', String(params.user_id))
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.offset !== undefined) query.set('offset', String(params.offset))

  const qs = query.toString()
  return request<ApiListingPage>(qs ? `/listings?${qs}` : '/listings')
}

export function apiGetListing(id: number) {
  return request<ApiListingDetail>(`/listings/${id}`)
}

export function apiListCategories() {
  return request<ApiCategory[]>('/listings/categories')
}

export function apiListConditions() {
  return request<ApiCondition[]>('/listings/conditions')
}

export type CreateListingData = {
  title: string
  category_id: number
  condition_id: number
  listing_dsc?: string | null
  listing_location?: string | null
  wish?: string | null
}

export function apiCreateListing(data: CreateListingData) {
  return request<ApiListingDetail>('/listings', {
    method: 'POST',
    body: data,
  })
}

// A PATCH sends only what changes, so every field becomes optional. Partial
// keeps each field's type: title, category_id and condition_id still cannot
// be null, matching the backend's ListingUpdateIn.
export type UpdateListingData = Partial<CreateListingData>

export function apiUpdateListing(id: number, data: UpdateListingData) {
  return request<ApiListingDetail>(`/listings/${id}`, {
    method: 'PATCH',
    body: data,
  })
}

export function apiDeleteListing(id: number) {
  return request<void>(`/listings/${id}`, { method: 'DELETE' })
}

export function apiUploadListingImage(id: number, file: File) {
  const form = new FormData()
  form.append('file', file)
  return request<ApiListingDetail>(`/listings/${id}/images`, { method: 'POST', body: form})
}

export function apiSetPrimaryListingImage(id: number, imageId: number) {
  return request<ApiListingDetail>(`/listings/${id}/images/${imageId}/primary`, {
    method: 'PUT'
  })
}

export function apiDeleteListingImage(id: number, imageId: number) {
  return request<ApiListingDetail>(`/listings/${id}/images/${imageId}`, {
    method: 'DELETE'
  })
}

// Requires a session: the backend answers 401 without one.
export function apiGetPublicProfile(id: number) {
  return request<ApiPublicProfile>(`/users/${id}`)
}

export type ApiNegotiationState = {
  id: number
  state_name: 'Open' | 'Agreed' | 'Completed' | 'Cancelled' | 'Unavailable'
}

export type ApiProposalState = {
  id: number
  state_name: 'Pending' | 'Accepted' | 'Rejected' | 'Withdrawn' | 'NotSelected' | 'ItemUnavailable'
}

export type ApiProposal = {
  id: number
  offered_listing: ApiListingSummary | null
  state: ApiProposalState
  created_at: string
  responded_at: string | null
}

export type ApiNegotiationDetail = {
  id: number
  requested_listing: ApiListingDetail
  owner: ApiPublicUser
  interested_user: ApiPublicUser
  state: ApiNegotiationState
  proposals: ApiProposal[]
  cancelled_by: ApiPublicUser | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
}

export type ApiNegotiationSummary = {
  id: number
  requested_listing: ApiListingSummary
  other_participant: ApiPublicUser
  state: ApiNegotiationState
  // The accepted proposal, else the most recent pending one.
  active_proposal: ApiProposal | null
  created_at: string
  updated_at: string
}

export type ApiNegotiationPage = {
  items: ApiNegotiationSummary[]
  total: number
  limit: number
  offset: number
}

export type NegotiationRole = 'owner' | 'interested'

export type ListNegotiationsParams = {
  role?: NegotiationRole
  state?: ApiNegotiationState['state_name']
  limit?: number
  offset?: number
}

// `signal` lets the page cancel a request it no longer needs.
export function apiListNegotiations(params: ListNegotiationsParams = {}, signal?: AbortSignal) {
  const query = new URLSearchParams()
  if (params.role) query.set('role', params.role)
  if (params.state) query.set('state', params.state)
  // Compare with undefined, because 0 is a valid offset.
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.offset !== undefined) query.set('offset', String(params.offset))

  const qs = query.toString()
  return request<ApiNegotiationPage>(qs ? `/negotiations?${qs}` : '/negotiations', { signal })
}

// `signal` lets the page cancel a request it no longer needs.
export function apiGetNegotiation(id: number, signal?: AbortSignal) {
  return request<ApiNegotiationDetail>(`/negotiations/${id}`, { signal })
}

// Creates the negotiation, or returns the one this user already has for this
// listing. The backend answers 201 or 200 with the same body, so callers only
// need the id.
export function apiCreateNegotiation(listingId: number) {
  return request<ApiNegotiationDetail>('/negotiations', {
    method: 'POST',
    body: { listing_id: listingId },
  })
}
