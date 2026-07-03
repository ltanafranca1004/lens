const TOKEN_KEY = 'lens.token'

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

type ApiInit = Omit<RequestInit, 'body'> & { body?: unknown }

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')

  const token = tokenStore.get()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let body: BodyInit | undefined
  if (init.body !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(init.body)
  }

  const res = await fetch(path, { ...init, headers, body })

  if (res.status === 204) return undefined as T

  const text = await res.text()
  const data = text ? JSON.parse(text) : null

  if (!res.ok) {
    const detail = data?.detail
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
