import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { charactersApi } from '../../shared/api/characters.api'
import { battlesApi } from '../../shared/api/battles.api'
import { inventoryApi } from '../../shared/api/inventory.api'
import {
  ARCHETYPE_LABELS, STAT_LABELS, STATUS_LABELS, QUALITY_LABELS,
  WEAPON_TYPE_LABELS, ARMOR_SLOT_LABELS, type ItemInstance
} from '../../shared/types/api.types'
import { ApiError } from '../../shared/api/client'

function DurBar({ cur, max }: { cur: number; max: number }) {
  const pct = max > 0 ? (cur / max) * 100 : 0
  const color = pct > 60 ? 'var(--success)' : pct > 25 ? 'var(--warning)' : 'var(--danger)'
  return (
    <div className="dur-bar" style={{ flex: 1, height: 6, background: 'var(--border)' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.3s' }} />
    </div>
  )
}

function ItemRow({ item, onEquip, onUnequip }: {
  item: ItemInstance
  onEquip: (id: string) => void
  onUnequip: (id: string) => void
}) {
  const slotLabel = item.armorSlot ? ARMOR_SLOT_LABELS[item.armorSlot] ?? item.armorSlot : null
  const typeLabel = item.template.weaponType
    ? WEAPON_TYPE_LABELS[item.template.weaponType]
    : item.template.armorSlot
      ? ARMOR_SLOT_LABELS[item.template.armorSlot]
      : item.template.type

  return (
    <tr style={item.status === 'BROKEN' ? { opacity: 0.6 } : {}}>
      <td>
        <span className={`q-${item.quality}`}>{item.template.name}</span>
        {item.isEquipped && <span style={{ color: 'var(--success)', fontSize: 10, marginLeft: 4 }}>▲</span>}
        {item.status === 'BROKEN' && <span style={{ color: 'var(--danger)', fontSize: 10, marginLeft: 4 }}>СЛОМАН</span>}
      </td>
      <td className="text-dim" style={{ fontSize: 11 }}>{typeLabel}</td>
      <td className="text-dim" style={{ fontSize: 11 }}>
        <span className={`q-${item.quality}`}>{QUALITY_LABELS[item.quality]}</span>
      </td>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <DurBar cur={item.durabilityCurrent} max={item.durabilityMax} />
          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
            {item.durabilityCurrent}/{item.durabilityMax}
          </span>
        </div>
      </td>
      <td>
        {item.isEquipped ? (
          <button className="btn btn-sm" onClick={() => onUnequip(item.id)}>Снять</button>
        ) : (
          <button
            className="btn btn-sm btn-primary"
            disabled={item.status === 'BROKEN'}
            onClick={() => onEquip(item.id)}
          >
            Надеть
          </button>
        )}
      </td>
    </tr>
  )
}

export function ProfilePage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [battleError, setBattleError] = useState('')
  const [selectedBot, setSelectedBot] = useState('training_bandit')

  const { data: char, isLoading, error } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
  })

  const { data: items = [] } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => inventoryApi.getItems(),
    enabled: !!char,
  })

  const equipMut  = useMutation({
    mutationFn: (id: string) => inventoryApi.equip(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory'] }); qc.invalidateQueries({ queryKey: ['character'] }) },
  })

  const unequipMut = useMutation({
    mutationFn: (id: string) => inventoryApi.unequip(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory'] }); qc.invalidateQueries({ queryKey: ['character'] }) },
  })

  const battleMut = useMutation({
    mutationFn: () => battlesApi.startPve(selectedBot),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['character'] })
      // Store battleId so we can navigate back to it after page reload
      localStorage.setItem('mmo_current_battle', data.battleId)
      navigate(`/battle/${data.battleId}`)
    },
    onError: (err) => {
      if (err instanceof ApiError) setBattleError(err.message)
    },
  })

  if (isLoading) return <div className="loading"><span className="spinner" />Загрузка...</div>

  if (error || !char) {
    return (
      <div style={{ maxWidth: 500, margin: '0 auto' }}>
        <div className="alert alert-warning">
          У вас нет персонажа.{' '}
          <a href="/character/create" onClick={e => { e.preventDefault(); navigate('/character/create') }}>
            Создать персонажа
          </a>
        </div>
      </div>
    )
  }

  const equipped = items.filter(i => i.isEquipped)
  const inventory = items.filter(i => !i.isEquipped && i.status !== 'DELETED')
  const hpPct = (char.hpCurrent / char.hpMax) * 100

  const bots = [
    { code: 'training_bandit', name: 'Тренировочный хулиган', level: 1 },
    { code: 'basic_gangster',  name: 'Гопник',                level: 2 },
    { code: 'armed_thug',     name: 'Вооружённый бандит',     level: 4 },
  ]

  return (
    <div>
      <div className="row">
        {/* Left: Character info */}
        <div className="col" style={{ maxWidth: 380 }}>
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">👤 ПЕРСОНАЖ</span>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                {STATUS_LABELS[char.status] ?? char.status}
              </span>
            </div>
            <div className="panel-body">
              <table className="data-table">
                <tbody>
                  <tr>
                    <td>Никнейм</td>
                    <td style={{ color: 'var(--gold)', fontWeight: 'bold' }}>{char.nickname}</td>
                  </tr>
                  <tr>
                    <td>Архетип</td>
                    <td>{ARCHETYPE_LABELS[char.archetype] ?? char.archetype}</td>
                  </tr>
                  <tr>
                    <td>Боевой уровень</td>
                    <td style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontWeight: 'bold' }}>
                      {char.battleLevel}
                    </td>
                  </tr>
                  <tr>
                    <td>Боевой опыт</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{char.battleExp}</td>
                  </tr>
                  <tr>
                    <td>Деньги</td>
                    <td className="money">{char.money.toLocaleString('ru')}</td>
                  </tr>
                </tbody>
              </table>

              <div className="mt8">
                <div className="stat-bar-wrap">
                  <div className="stat-bar-label">❤️ Здоровье</div>
                  <div className="stat-bar">
                    <div className="stat-bar-fill hp" style={{ width: `${hpPct}%` }} />
                  </div>
                  <div className="stat-bar-val">{char.hpCurrent}/{char.hpMax}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Stats */}
          {char.stats && (
            <div className="panel">
              <div className="panel-header"><span className="panel-title">📊 ХАРАКТЕРИСТИКИ</span></div>
              <div className="panel-body">
                <div className="stat-grid">
                  {Object.entries(STAT_LABELS).map(([key, label]) => (
                    <div key={key} className="stat-item">
                      <div className="stat-abbr">{label}</div>
                      <div className="stat-val">{(char.stats as unknown as Record<string, number>)[key]}</div>
                    </div>
                  ))}
                </div>
                {char.stats.pointsAvailable > 0 && (
                  <div className="alert alert-warning mt8">
                    Доступно очков: <strong>{char.stats.pointsAvailable}</strong>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right: Equipment + Battle */}
        <div className="col">
          {/* Equipped items */}
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">🛡️ ЭКИПИРОВКА</span>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{equipped.length} предм.</span>
            </div>
            <div className="panel-body">
              {equipped.length === 0 ? (
                <div className="text-dim" style={{ fontSize: 12, textAlign: 'center', padding: 8 }}>
                  Ничего не надето
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Предмет</th><th>Тип</th><th>Качество</th><th>Прочность</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {equipped.map(item => (
                      <ItemRow key={item.id} item={item}
                        onEquip={equipMut.mutate} onUnequip={unequipMut.mutate} />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Start battle */}
          <div className="panel">
            <div className="panel-header"><span className="panel-title">⚔️ БОЙ</span></div>
            <div className="panel-body">
              {battleError && <div className="alert alert-error mb8">{battleError}</div>}
              {char.status === 'IN_BATTLE' && (
                <div className="alert alert-warning mb8">
                  Вы уже в бою!{' '}
                  <a href="#" onClick={e => { e.preventDefault(); navigate('/battle/current') }}>
                    Перейти в бой
                  </a>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Выбери противника</label>
                <select
                  className="form-select"
                  value={selectedBot}
                  onChange={e => setSelectedBot(e.target.value)}
                >
                  {bots.map(b => (
                    <option key={b.code} value={b.code}>
                      {b.name} (ур. {b.level})
                    </option>
                  ))}
                </select>
              </div>

              <button
                className="btn btn-danger btn-block"
                onClick={() => battleMut.mutate()}
                disabled={battleMut.isPending || char.status === 'IN_BATTLE'}
              >
                {battleMut.isPending
                  ? <><span className="spinner" />Начинаем...</>
                  : '⚔️ Начать PvE бой'}
              </button>
            </div>
          </div>

          {/* Inventory preview */}
          {inventory.length > 0 && (
            <div className="panel">
              <div className="panel-header">
                <span className="panel-title">🎒 ИНВЕНТАРЬ</span>
                <a href="/inventory" style={{ fontSize: 11 }}
                  onClick={e => { e.preventDefault(); navigate('/inventory') }}>
                  Открыть →
                </a>
              </div>
              <div className="panel-body">
                <table className="data-table">
                  <thead>
                    <tr><th>Предмет</th><th>Тип</th><th>Прочность</th><th></th></tr>
                  </thead>
                  <tbody>
                    {inventory.slice(0, 6).map(item => (
                      <ItemRow key={item.id} item={item}
                        onEquip={equipMut.mutate} onUnequip={unequipMut.mutate} />
                    ))}
                    {inventory.length > 6 && (
                      <tr>
                        <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 11 }}>
                          +{inventory.length - 6} предметов...{' '}
                          <a href="/inventory" onClick={e => { e.preventDefault(); navigate('/inventory') }}>
                            Показать все
                          </a>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
