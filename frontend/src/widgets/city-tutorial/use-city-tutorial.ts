import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../app/providers/auth-provider'
import { api } from '../../shared/api/client'

export interface TutorialProgress {
  active: boolean
  completed: boolean
  letterPending: boolean
  lesson?: 'buy' | 'equip' | 'allocate' | 'stats' | 'fight' | 'finish' | 'unavailable'
  weapon?: {
    id: string
    itemId?: string
    name: string
    weaponType: string | null
    price?: number
    canAfford?: boolean
  }
  reward: { rubles: number; dollars: number }
}

export const tutorialKey = (userId: string | null) => ['character', 'tutorial', userId] as const
const route = '/api/characters/tutorial'
const ranged = new Set(['PISTOL', 'SHOTGUN', 'SMG', 'RIFLE', 'SNIPER', 'HEAVY', 'THROWN'])
export const tutorialWeaponTab = (type?: string | null) => ranged.has(type ?? '') ? 'ranged' : 'melee'
export const updateTutorial = (action: 'complete' | 'dismiss-letter') => api.post<TutorialProgress>(route, { action })

export function useCityTutorial() {
  const { userId } = useAuth()
  return useQuery({
    queryKey: tutorialKey(userId), queryFn: () => api.get<TutorialProgress>(route),
    enabled: !!userId, retry: false, staleTime: 10_000,
  })
}
