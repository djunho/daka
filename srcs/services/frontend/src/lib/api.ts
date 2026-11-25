import { type ApiChatMessagePage } from '../types/chat'

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
    throw new ApiError(0, NETWORK_ERROR_MESSAGE)
  }

  // 204 No Content (our logout) has no body to parse. Return early.
  if (res.status === 204) {
    return undefined as T
  }

  // Parse the body once. If it is not JSON for some reason, fall back to null
  // rather than throwing a second, confusing error.
  const data = await res.json().catch(() => null)

  if (!res.ok) {
    throw errorFromResponse(res.status, data)
  }

  return data as T
}

const NETWORK_ERROR_MESSAGE = 'Could not reach the server. Check your connection.'

// FastAPI puts the message in "detail". Fall back to a generic line if the
// shape is unexpected, so the user never sees "[object Object]".
function errorFromResponse(status: number, data: unknown): ApiError {
  const detail =
    data && typeof (data as { detail?: unknown }).detail === 'string'
      ? (data as { detail: string }).detail
      : 'Something went wrong. Please try again.'
  return new ApiError(status, detail)
}

export type UploadOptions = {
  // Called with the share of the file sent so far, from 0 to 1. It reaches 1
  // when the last byte left the browser: the server may still be working
  // (checking, re-encoding) for a moment after that.
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

// Sends one file as multipart/form-data, in a field named "file", reporting
// the upload progress. fetch cannot report upload progress, so this uses
// XMLHttpRequest, and answers exactly like request() does: the same /api
// prefix, the session cookie, ApiError(0) when the server cannot be reached,
// ApiError(status, detail) on a non-2xx, an AbortError when cancelled.
export function uploadWithProgress<T>(
  path: string,
  method: 'POST' | 'PUT',
  file: File,
  { onProgress, signal }: UploadOptions = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abortError = () => new DOMException('The upload was cancelled.', 'AbortError')
    if (signal?.aborted) {
      reject(abortError())
      return
    }

    const xhr = new XMLHttpRequest()
    xhr.open(method, API_BASE + path)
    // Same origin already sends the cookie; this keeps the intent explicit,
    // like credentials: 'include' in request().
    xhr.withCredentials = true

    const onAbortSignal = () => xhr.abort()
    signal?.addEventListener('abort', onAbortSignal)
    const done = () => signal?.removeEventListener('abort', onAbortSignal)

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total)
      }
    }

    xhr.onload = () => {
      done()
      // 204 No Content has no body to parse.
      if (xhr.status === 204) {
        resolve(undefined as T)
        return
      }
      let data: unknown = null
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        // Not JSON: fall back to null, as request() does.
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(errorFromResponse(xhr.status, data))
        return
      }
      resolve(data as T)
    }
    xhr.onerror = () => {
      done()
      reject(new ApiError(0, NETWORK_ERROR_MESSAGE))
    }
    xhr.ontimeout = xhr.onerror
    xhr.onabort = () => {
      done()
      reject(abortError())
    }

    const form = new FormData()
    form.append('file', file)
    xhr.send(form)
  })
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
  // Last activity within the backend's presence window (see app/presence.py).
  is_online: boolean
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

// A PDF attached to a listing. Anyone sees this description; opening the
// file needs a session (listingDocumentUrl).
export type ApiDocument = {
  id: number
  original_name: string
  size_bytes: number
  page_count: number
  created_at: string
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
  documents: ApiDocument[]
  // Always false for now: GET /listings/:id is public and the backend does not
  // look at the session there. FavoritesContext is what knows the user's favorites.
  is_favorited: boolean
}

export type ApiListingPage = {
  items: ApiListingSummary[]
  total: number
  limit: number
  offset: number
}

// Presence, as the backend reports it on profiles and friends (#142):
// online means an authenticated request in the last 3 minutes. last_seen is
// null for someone who was never seen.
export type ApiPresence = {
  is_online: boolean
  last_seen: string | null
}

export type ApiPublicProfile = ApiPublicUser & ApiPresence & {
  created_at: string
  listings: ApiListingSummary[]
}

export type ApiFriend = ApiPublicUser & ApiPresence

export type ApiFriendStatus = {
  is_friend: boolean
}

export type ApiFriendPage = {
  items: ApiFriend[]
  total: number
  limit: number
  offset: number
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

// Used on page load and by the presence heartbeat. Unlike /auth/me, no
// session is not an error: the answer is 200 with user null, so neither a
// visitor nor a session that ended with the site open shows a 401 in the
// browser console.
export function apiSession() {
  return request<{ user: ApiUser | null }>('/auth/session')
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
export function apiUploadAvatar(file: File, options?: UploadOptions) {
  return uploadWithProgress<ApiUser>('/auth/me/avatar', 'PUT', file, options)
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

export function apiUploadListingImage(id: number, file: File, options?: UploadOptions) {
  return uploadWithProgress<ApiListingDetail>(`/listings/${id}/images`, 'POST', file, options)
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

export function apiUploadListingDocument(id: number, file: File, options?: UploadOptions) {
  return uploadWithProgress<ApiListingDetail>(`/listings/${id}/documents`, 'POST', file, options)
}

export function apiDeleteListingDocument(id: number, documentId: number) {
  return request<ApiListingDetail>(`/listings/${id}/documents/${documentId}`, {
    method: 'DELETE'
  })
}

// --- Favorites (#89). Every call needs a session. ---

export type ListFavoritesParams = {
  limit?: number
  offset?: number
}

// Only available listings, newest first. `limit` goes up to 100.
export function apiGetFavorites(params: ListFavoritesParams = {}, signal?: AbortSignal) {
  const query = new URLSearchParams()
  // Compare with undefined, because 0 is a valid offset.
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.offset !== undefined) query.set('offset', String(params.offset))

  const qs = query.toString()
  return request<ApiListingPage>(qs ? `/listings/favorites?${qs}` : '/listings/favorites', { signal })
}

// 409 when it is already a favorite or is the user's own listing, 404 when
// the listing is not available.
export function apiAddFavorite(listingId: number): Promise<void> {
  return request<void>(`/listings/${listingId}/favorite`, { method: 'POST' })
}

// 404 when the listing is not among the user's favorites.
export function apiRemoveFavorite(listingId: number): Promise<void> {
  return request<void>(`/listings/${listingId}/favorite`, { method: 'DELETE' })
}

// Where a logged-in user opens a document. Never link to it without a
// session: the backend answers 401, which shows up in the browser console.
export function listingDocumentUrl(listingId: number, documentId: number) {
  return `${API_BASE}/listings/${listingId}/documents/${documentId}/file`
}

// Requires a session: the backend answers 401 without one.
export function apiGetPublicProfile(id: number, signal?: AbortSignal) {
  return request<ApiPublicProfile>(`/users/${id}`, { signal })
}

// --- Friends (#143). A friendship is mutual and needs no approval: adding
// or removing it changes it for both users at once. ---

export type ListFriendsParams = {
  limit?: number
  offset?: number
}

// Active friendships only, online friends first. `signal` lets the page
// cancel a request it no longer needs.
export function apiGetFriends(params: ListFriendsParams = {}, signal?: AbortSignal) {
  const query = new URLSearchParams()
  // Compare with undefined, because 0 is a valid offset.
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.offset !== undefined) query.set('offset', String(params.offset))

  const qs = query.toString()
  return request<ApiFriendPage>(qs ? `/friends?${qs}` : '/friends', { signal })
}

// Only an active friendship counts: a removed one answers false, as does
// asking about yourself.
export function apiGetFriendStatus(userId: number, signal?: AbortSignal) {
  return request<ApiFriendStatus>(`/friends/${userId}/status`, { signal })
}

// 409 when already friends, 404 when the user does not exist or deleted
// their account. Adding a removed friendship again reactivates it.
export function apiAddFriend(userId: number) {
  return request<ApiFriend>(`/friends/${userId}`, { method: 'POST' })
}

// 404 when there is no active friendship (the other user may have removed it).
export function apiRemoveFriend(userId: number): Promise<void> {
  return request<void>(`/friends/${userId}`, { method: 'DELETE' })
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

// offeredListingId is required on purpose: null means "offering no listing",
// which the backend accepts, while leaving the field out is a 422.
export function apiCreateProposal(negotiationId: number, offeredListingId: number | null) {
  return request<ApiProposal>(`/negotiations/${negotiationId}/proposals`, {
    method: 'POST',
    body: { offered_listing_id: offeredListingId },
  })
}

// These three answer with the proposal alone. Other parts of the negotiation
// change with them, so callers load the negotiation again afterwards.
export function apiAcceptProposal(id: number) {
  return request<ApiProposal>(`/proposals/${id}/accept`, { method: 'PATCH' })
}

export function apiRejectProposal(id: number) {
  return request<ApiProposal>(`/proposals/${id}/reject`, { method: 'PATCH' })
}

export function apiWithdrawProposal(id: number) {
  return request<ApiProposal>(`/proposals/${id}/withdraw`, { method: 'PATCH' })
}

// Puts a proposal the interested user withdrew back to Pending (ADR-0003).
export function apiReopenProposal(id: number) {
  return request<ApiProposal>(`/proposals/${id}/reopen`, { method: 'PATCH' })
}

export function apiCancelNegotiation(id: number) {
  return request<ApiNegotiationDetail>(`/negotiations/${id}/cancel`, { method: 'PATCH' })
}

export function apiCompleteNegotiation(id: number) {
  return request<ApiNegotiationDetail>(`/negotiations/${id}/complete`, { method: 'PATCH' })
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

/**
 * Fetch paginated chat messages for a negotiation.
 * GET /api/negotiations/{negotiation_id}/messages?limit=50&before_id=...
 */
export function apiListNegotiationMessages(
  negotiationId: number,
  options: { limit?: number; before_id?: number | null; signal?: AbortSignal } = {},
) {
  const params = new URLSearchParams()
  if (options.limit !== undefined)
    params.set('limit', String(options.limit))
  if (options.before_id != null)
    params.set('before_id', String(options.before_id))

  const query = params.toString()
  const path = `/negotiations/${negotiationId}/messages${query ? `?${query}` : ''}`
  return request<ApiChatMessagePage>(path, { signal: options.signal })
}
