/// <reference types="vite/client" />
// =============================================================
// API Client вЂ” typed fetch wrapper
// =============================================================

const BASE = (import.meta as ImportMeta & { env: Record<string, string> }).env.VITE_API_BASE_URL || ''

function getToken(): string | null {
  return localStorage.getItem('mmo_token')
}

export function setToken(token: string): void {
  localStorage.setItem('mmo_token', token)
}

export function removeToken(): void {
  localStorage.removeItem('mmo_token')
  localStorage.removeItem('mmo_user')
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  body?: unknown
  noAuth?: boolean
  headers?: Record<string, string>
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, noAuth = false } = options

  const headers: Record<string, string> = { ...(options.headers ?? {}) }

  // Only set Content-Type when there's a body to send
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  if (!noAuth) {
    const token = getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    if (res.status === 401 && !noAuth) {
      removeToken()
      if (window.location.pathname !== '/login') {
        window.location.assign('/login?reason=session-expired')
      }
    }
    let errorData: { code?: string; message?: string; details?: unknown } = {}
    try {
      errorData = await res.json()
    } catch {
      // ignore
    }
    throw new ApiError(
      res.status,
      errorData.code ?? 'UNKNOWN',
      errorData.message ?? `HTTP ${res.status}`,
      errorData.details,
    )
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  get:    <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'GET' }),

  post:   <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method'>) =>
    request<T>(path, { ...opts, method: 'POST', body }),

  put:    <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method'>) =>
    request<T>(path, { ...opts, method: 'PUT', body }),

  patch:  <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method'>) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),

  delete: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'DELETE' }),
}
