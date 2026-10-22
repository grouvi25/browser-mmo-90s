import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { charactersApi } from '../api/characters.api'

export const POCKET_SLOTS = 4
const KEY = ['battle-loadout'] as const
// Раньше карман жил только в браузере и до сервера не доходил — в бою он был пуст.
const LEGACY_KEY = 'mmo_battle_loadout'

function takeLegacy(): string[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    localStorage.removeItem(LEGACY_KEY)
    const ids: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string').slice(0, POCKET_SLOTS) : []
  } catch {
    return []
  }
}

/** Боевой карман игрока: хранится на сервере, бой берёт его на старте. */
export function useBattleLoadout() {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: KEY, queryFn: () => charactersApi.getBattleLoadout() })
  const ids = query.data?.itemInstanceIds ?? []

  const save = useMutation({
    mutationFn: (next: string[]) => charactersApi.setBattleLoadout(next),
    onSuccess: data => qc.setQueryData(KEY, data),
  })

  const migrated = useRef(false)
  useEffect(() => {
    if (migrated.current || !query.isSuccess) return
    migrated.current = true
    const legacy = takeLegacy()
    // Старый набор мог устареть (вещь продана или съедена) — тогда просто начинаем с пустого.
    if (legacy.length && ids.length === 0) save.mutate(legacy, { onError: () => save.reset() })
  }, [query.isSuccess, ids.length, save])

  const toggle = (id: string) => {
    const next = ids.includes(id) ? ids.filter(x => x !== id) : ids.length < POCKET_SLOTS ? [...ids, id] : ids
    if (next !== ids) save.mutate(next)
  }

  return { ids, toggle, saving: save.isPending, error: save.error }
}
