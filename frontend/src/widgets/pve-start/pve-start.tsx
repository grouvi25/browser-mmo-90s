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
import { useBattleLoadout } from '../../shared/lib/battle-loadout'

/** Насколько бот опасен для этого игрока — по разнице уровней. */
function toneOf(botLevel: number, myLevel: number): 'ok' | 'warn' | 'danger' {
  return botLevel <= myLevel ? 'ok' : botLevel <= myLevel + 2 ? 'warn' : 'danger'
}

/** embedded — внутри формы заявок Стрелков: без своей рамки и заголовка. */
export function PveStart({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [picked, setPicked] = useState<string | null>(null)
  const [error, setError] = useState('')
  // Список ботов — с сервера: новый бот появляется здесь сам.
  const bots = useQuery({ queryKey: ['battle', 'bots'], queryFn: battlesApi.bots, staleTime: 300_000 })
  const list = bots.data?.items ?? []

  const { data: char } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
  })
  const { data: items = [] } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => inventoryApi.getItems(),
    enabled: !!char,
  })

  const bot = picked ?? list[0]?.code ?? null
  const start = useMutation({
    mutationFn: () => battlesApi.startPve(bot!),
    onSuccess: data => {
      qc.invalidateQueries({ queryKey: ['character'] })
      localStorage.setItem('mmo_current_battle', data.battleId)
      navigate(`/battle/${data.battleId}`)
    },
    onError: err => setError(err instanceof ApiError ? err.message : 'Не удалось начать бой'),
  })

  // Номер боя спрашиваем у сервера: в localStorage его нет, если игрок
  // зашёл с другого браузера, и тогда кнопка «В бой» гасла, а вернуться
  // было некуда.
  const current = useQuery({ queryKey: ['battle', 'current'], queryFn: battlesApi.current, refetchInterval: 4000 })
  const currentBattle = current.data?.battleId ?? null
  const inBattle = char?.status === 'IN_BATTLE' && !!currentBattle
  const hasWeapon = items.some(i => i.isEquipped && i.template.type === 'WEAPON')
  const loadout = useBattleLoadout().ids
  const hpLow = char ? char.hpCurrent / char.hpMax < 0.3 : false

  return (
    <div className={embedded ? 'arena-pve arena-pve--embedded' : 'panel arena-pve'}>
      {!embedded && <div className="panel-header">
        <span className="panel-title"><Swords size={13} /> Бой с ботом</span>
        {char && (
          <span className="arena-pve__hp">
            <Heart size={11} /> {char.hpCurrent} / {char.hpMax}
          </span>
        )}
      </div>}

      <div className={embedded ? '' : 'panel-body'}>
        <div className="arena-pve__bots">
          {bots.isLoading && <p role="status" className="arena-pve__loading">Загрузка…</p>}
          {bots.isError && <p role="alert">Список не загрузился. <button type="button" className="linklike" onClick={() => void bots.refetch()}>Повторить</button></p>}
          {list.map(b => {
            const myLevel = char?.battleLevel ?? 1
            const tooStrong = b.battleLevel > myLevel + 3
            return (
              <button
                key={b.code}
                type="button"
                className={'arena-bot arena-bot--' + toneOf(b.battleLevel, myLevel) + (bot === b.code ? ' is-active' : '')}
                aria-pressed={bot === b.code}
                onClick={() => setPicked(b.code)}
                title={tooStrong ? 'Заметно сильнее вас — бой рискованный' : undefined}
              >
                <span className="arena-bot__name">{b.name}</span>
                <span className="arena-bot__meta">ур. {b.battleLevel}</span>
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
            disabled={start.isPending || !char || inBattle || !bot}
            onClick={() => { setError(''); start.mutate() }}
          >
            {start.isPending ? 'Начинаем…' : 'В бой'}
          </button>
        )}
      </div>
    </div>
  )
}
