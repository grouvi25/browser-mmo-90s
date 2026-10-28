import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { charactersApi } from '../../shared/api/characters.api'
import { LOCATION_HINTS, levelGateApplies, requiredLevel } from '../../shared/lib/location-levels'

/** Закрытая по уровню локация открывается по прямой ссылке — показываем,
    с какого уровня она станет доступна, вместо содержимого. */
export function LevelGate({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  const me = useQuery({ queryKey: ['character', 'me'], queryFn: charactersApi.getMe, staleTime: 30_000 })
  const need = requiredLevel(pathname)
  if (!need || !me.data || !levelGateApplies(me.data) || me.data.battleLevel >= need.level) return <>{children}</>
  return <div className="level-gate" role="status">
    <h2>Откроется с {need.level}-го боевого уровня</h2>
    <p>{LOCATION_HINTS[need.key]}</p>
    <p>Сейчас у вас {me.data.battleLevel}-й. Опыт дают бои — начните со Стрелок, кнопка «Боты».</p>
    <Link to="/pvp">В Стрелки →</Link>
  </div>
}
