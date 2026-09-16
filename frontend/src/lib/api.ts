const TOKEN_KEY = 'lens.token'
// Render free tier cold-starts (~30-60s) after 15 min idle, so allow a generous
// window before treating a request as timed out.
const DEFAULT_TIMEOUT_MS = 60_000

// Backend base URL. Empty in local dev (requests fall through the Vite proxy);
// set to the Render URL via VITE_API_URL in production.
const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

type ApiInit = Omit<RequestInit, 'body'> & { body?: unknown; timeoutMs?: number }

// Fetch that aborts after `timeoutMs`. Both a timeout and a network failure are
// re-thrown as ApiError so callers never see a raw AbortError/TypeError.
async function fetchWithTimeout(
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(`${API_BASE}${path}`, { ...init, signal: controller.signal })
  } catch (err) {
    if (controller.signal.aborted) {
      throw new ApiError(`Request timed out after ${timeoutMs} ms`, 0)
    }
    throw new ApiError(err instanceof Error ? err.message : 'Network request failed', 0)
  } finally {
    clearTimeout(timer)
  }
}

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init

  const headers = new Headers(rest.headers)
  headers.set('Accept', 'application/json')

  const token = tokenStore.get()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let body: BodyInit | undefined
  if (rest.body instanceof FormData) {
    // Multipart upload (e.g. a resume file): pass the FormData through untouched and let the
    // browser set Content-Type with the correct multipart boundary. Never JSON-stringify it.
    body = rest.body
  } else if (rest.body !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(rest.body)
  }

  const res = await fetchWithTimeout(path, { ...rest, headers, body }, timeoutMs)

  if (res.status === 204) return undefined as T

  const text = await res.text()

  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      // Non-JSON body (e.g. an HTML 502/504 from a proxy). Never let a raw
      // SyntaxError escape — callers depend on failures being ApiError.
      throw new ApiError(`Request failed (${res.status})`, res.status)
    }
  }

  if (!res.ok) {
    const detail = (data as { detail?: unknown } | null)?.detail
    const message =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: { msg?: string }) => d.msg ?? 'Validation error').join(', ')
          : `Request failed (${res.status})`
    throw new ApiError(message, res.status)
  }

  return data as T
}
