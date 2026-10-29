import { api } from './client'

/** Окно при входе в игру (правка 29.10); текст правится в админке. */
export interface Welcome { enabled: boolean; title: string; text: string; version: number }

export const siteApi = {
  welcome: () => api.get<{ welcome: Welcome | null }>('/api/site/welcome', { noAuth: true }),
}
