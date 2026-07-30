// =============================================================
// Начало боя с ботом.
//
// Раньше этот блок жил на старой странице профиля. При переходе
// на макет профиль стал «личным делом» — документом, а не пультом
// управления, поэтому запуск боя переехал сюда, на арену.
// =============================================================
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Swords, Heart, Backpack } from 'lucide-react'

import { battlesApi } from '../../shared/api/battles.api'
import { charactersApi } from '../../shared/api/characters.api'
import { inventoryApi } from '../../shared/api/inventory.api'
import { ApiError } from '../../shared/api/client'

const LOADOUT_KEY = 'mmo_battle_loadout'

const BOTS = [
  { code: 'training_bandit', label: 'Тренировочный хулиган', level: 1, reward: '20–50 ₽', tone: 'ok' },
  { code: 'basic_gangster', label: 'Гопник', level: 2, reward: '50–120 ₽', tone: 'warn' },
  { code: 'armed_thug', label: 'Вооружённый бандит', level: 4, reward: '100–300 ₽', tone: 'danger' },
] as const

function readLoadout(): string[] {
  try { return JSON.parse(localStorage.getItem(LOADOUT_KEY) ?? '[]') } catch { return [] }
}

export function PveStart() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [bot, setBot] = useState<string>(BOTS[0].code)
  const [error, setError] = useState('')

  const { data: char } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
  })
  const { data: items = [] } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => inventoryApi.getItems(),
    enabled: !!char,
  })

  const start = useMutation({
    mutationFn: () => battlesApi.startPve(bot),
    onSuccess: data => {
      qc.invalidateQueries({ queryKey: ['character'] })
      localStorage.setItem('mmo_current_battle', data.battleId)
      navigate(`/battle/${data.battleId}`)
    },
    onError: err => setError(err instanceof ApiError ? err.message : 'Не удалось начать бой'),
  })

  const inBattle = char?.status === 'IN_BATTLE'
  const currentBattle = localStorage.getItem('mmo_current_battle')
  const hasWeapon = items.some(i => i.isEquipped && i.template.type === 'WEAPON')
  const loadout = readLoadout()
  const hpLow = char ? char.hpCurrent / char.hpMax < 0.3 : false

  return (
    <div className="panel arena-pve">
      <div className="panel-header">
        <span className="panel-title"><Swords size={13} /> Бой с ботом</span>
        {char && (
          <span className="arena-pve__hp">
            <Heart size={11} /> {char.hpCurrent} / {char.hpMax}
          </span>
        )}
      </div>

      <div className="panel-body">
        <div className="arena-pve__bots">
          {BOTS.map(b => {
            const tooStrong = char ? b.level > char.battleLevel + 3 : false
            return (
              <button
                key={b.code}
                type="button"
                className={'arena-bot arena-bot--' + b.tone + (bot === b.code ? ' is-active' : '')}
                onClick={() => setBot(b.code)}
                title={tooStrong ? 'Заметно сильнее вас — опыт срежется' : undefined}
              >
                <span className="arena-bot__name">{b.label}</span>
                <span className="arena-bot__meta">ур. {b.level} · {b.reward}</span>
                {tooStrong && <span className="arena-bot__warn">рискованно</span>}
              </button>
            )
          })}
        </div>

        <div className="arena-pve__row">
          <span className="arena-pve__loadout">
            <Backpack size={11} /> В карманах: {loadout.length} из 4
            {loadout.length === 0 && (
              <button type="button" className="linklike" onClick={() => navigate('/inventory')}>
                набрать
              </button>
            )}
          </span>
        </div>

        {!hasWeapon && (
          <div className="alert alert-warning">
            Оружие не надето — драться будете кулаками.{' '}
            <button type="button" className="linklike" onClick={() => navigate('/inventory')}>
              открыть снаряжение
            </button>
          </div>
        )}
        {hpLow && !inBattle && (
          <div className="alert alert-warning">
            Мало здоровья ({char?.hpCurrent} из {char?.hpMax}). Оно восстанавливается со временем.
          </div>
        )}
        {error && <div className="alert alert-error">{error}</div>}

        {inBattle && currentBattle ? (
          <button type="button" className="btn btn-primary arena-pve__go"
            onClick={() => navigate(`/battle/${currentBattle}`)}>
            Вернуться в текущий бой →
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary arena-pve__go"
            disabled={start.isPending || !char || inBattle}
            onClick={() => { setError(''); start.mutate() }}
          >
            {start.isPending ? 'Начинаем…' : 'В бой'}
          </button>
        )}
      </div>
    </div>
  )
}
