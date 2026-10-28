import { api, setToken, removeToken } from './client'

export const authApi = {
  register: (data: { login: string; email: string; password: string; acceptPolicy?: boolean; website?: string; captchaToken?: string; ref?: string }) =>
    api.post<{ id: string; login: string; email: string }>('/api/auth/register', data, { noAuth: true }),

  login: (data: { login: string; password: string }) =>
    api.post<{ token: string; userId: string; login: string }>('/api/auth/login', data, { noAuth: true }),

  logout: () => api.post<void>('/api/auth/logout'),

  me: () => api.get<{ userId: string }>('/api/auth/me'),

  // Восстановление пароля: заявка по логину или почте, затем новый пароль по ссылке.
  forgotPassword: (login: string, captchaToken?: string) =>
    api.post<{ ok: true }>('/api/auth/password/forgot', { login, captchaToken }, { noAuth: true }),
  resetPassword: (token: string, password: string) =>
    api.post<{ login: string }>('/api/auth/password/reset', { token, password }, { noAuth: true }),
}

export function saveAuthSession(token: string, userId: string, login: string): void {
  setToken(token)
  localStorage.setItem('mmo_user', JSON.stringify({ userId, login }))
}

export function getStoredUser(): { userId: string; login: string } | null {
  const raw = localStorage.getItem('mmo_user')
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export function clearAuthSession(): void {
  removeToken()
}
