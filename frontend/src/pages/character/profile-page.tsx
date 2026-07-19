import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { charactersApi } from '../../shared/api/characters.api'
import { battlesApi } from '../../shared/api/battles.api'
import { inventoryApi } from '../../shared/api/inventory.api'
import {
  ARCHETYPE_LABELS, STAT_LABELS, STATUS_LABELS,
  QUALITY_LABELS, WEAPON_TYPE_LABELS, ARMOR_SLOT_LABELS,
  type ItemInstance
} from '../../shared/types/api.types'
import { ApiError } from '../../shared/api/client'

// Иконки для архетипов
const ARCH_ICONS: Record<string, string> = {
  ATHLETE: '🏋️', WORKER: '⚙️', SHUTTLE: '🧳', VETERAN: '🎖️',
  STREET: '🥊', MERCHANT: '💼', STUDENT: '📖', RESOLVER: '🤝',
}

// Слоты экипировки для визуализации
const EQUIP_SLOTS = [
  { key: 'weapon_main', label: 'Оружие', icon: '⚔️', types: ['WEAPON'] },
  { key: 'HEAD',        label: 'Голова',  icon: '⛑️', slot: 'HEAD' },
  { key: 'CHEST',       label: 'Тело',    icon: '🛡️', slot: 'CHEST' },
  { key: 'LEGS',        label: 'Ноги',    icon: '🩲', slot: 'LEGS' },
  { key: 'FEET',        label: 'Обувь',   icon: '👟', slot: 'FEET' },
  { key: 'HANDS',       label: 'Руки',    icon: '🧤', slot: 'HANDS' },
] as const

function EquipSlotCard({ label, icon, item }: {
  label: string; icon: string; item: ItemInstance | null
}) {
  const durPct = item ? (item.durabilityCurrent / item.durabilityMax) * 100 : 0
  return (
    <div className={`equip-slot${item ? ' filled' : ''}${item?.template.type === 'WEAPON' ? ' weapon' : ''}`}>
      <div className="equip-slot-label">{icon} {label}</div>
      {item ? (
        <>
          <div className={`equip-slot-item q-${item.quality}`}>
            {item.template.name}
          </div>
          <div className="equip-slot-dur">
            <div className="equip-slot-dur-fill" style={{ width: `${durPct}%`, background: durPct > 60 ? 'var(--green)' : durPct > 25 ? 'var(--warning)' : 'var(--danger)' }} />
          </div>
        </>
      ) : (
        <div className="equip-slot-empty">— пусто —</div>
      )}
    </div>
  )
}

const BOTS = [
  { code: 'training_bandit', label: 'Тренировочный хулиган', level: 1, danger: '🟢 Лёгкий' },
  { code: 'basic_gangster',  label: 'Гопник',                level: 2, danger: '🟡 Средний' },
  { code: 'armed_thug',     label: 'Вооружённый бандит',     level: 4, danger: '🔴 Сложный' },
]

export function ProfilePage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [battleError, setBattleError] = useState('')
  const [selectedBot, setSelectedBot] = useState('training_bandit')

  const { data: char, isLoading } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
  })
  const { data: items = [] } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => inventoryApi.getItems(),
    enabled: !!char,
  })

  const battleMut = useMutation({
    mutationFn: () => battlesApi.startPve(selectedBot),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['character'] })
      localStorage.setItem('mmo_current_battle', data.battleId)
      navigate(`/battle/${data.battleId}`)
    },
    onError: (err) => {
      if (err instanceof ApiError) setBattleError(err.message)
    },
  })

  if (isLoading) return <div className="loading"><span className="spinner" />Загрузка...</div>

  if (!char) {
    return (
      <div className="alert alert-warning">
        Персонаж не найден.{' '}
        <a href="#" onClick={e => { e.preventDefault(); navigate('/character/create') }}>
          Создать персонажа →
        </a>
      </div>
    )
  }

  const equipped = items.filter(i => i.isEquipped)
  const hpPct = (char.hpCurrent / char.hpMax) * 100
  const hpClass = hpPct > 60 ? 'hp' : hpPct > 25 ? 'hp mid' : 'hp'

  // Собираем экипировку по слотам
  const getEquippedItem = (slotType: string | null, weaponSlot?: boolean): ItemInstance | null => {
    if (weaponSlot) return equipped.find(i => i.template.type === 'WEAPON') ?? null
    if (slotType) return equipped.find(i => i.armorSlot === slotType) ?? null
    return null
  }

  const s = char.stats
  const expCurr = char.battleExp
  // Примерный порог следующего уровня
  const expThresholds = [0, 5, 15, 37, 76, 143, 240, 370, 535, 740, 1000]
  const levelExp = expThresholds[char.battleLevel - 1] ?? 0
  const nextExp  = expThresholds[char.battleLevel]     ?? expCurr + 100
  const expPct   = Math.min(100, ((expCurr - levelExp) / Math.max(nextExp - levelExp, 1)) * 100)

  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      {/* ─── Левая колонка: персонаж ──────────── */}
      <div style={{ width: 280, flexShrink: 0 }}>
        {/* Карточка персонажа */}
        <div className="panel panel-gold">
          <div className="panel-header">
            <span className="panel-title">👤 Персонаж</span>
            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
              {STATUS_LABELS[char.status] ?? char.status}
            </span>
          </div>
          <div className="panel-body">
            <div className="char-card">
              {/* Аватар */}
              <div className="char-avatar">
                <div className="avatar-figure">
                  <span style={{ fontSize: 40, position: 'relative', zIndex: 1 }}>
                    {ARCH_ICONS[char.archetype] ?? '👤'}
                  </span>
                </div>
                <div className="avatar-level">
                  Ур.<span>{char.battleLevel}</span>
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-dim)', textAlign: 'center' }}>
                  {ARCHETYPE_LABELS[char.archetype]}
                </div>
              </div>

              {/* Инфо */}
              <div className="char-info">
                <div style={{ fontSize: 14, fontWeight: 'bold', color: 'var(--text-title)', marginBottom: 6 }}>
                  {char.nickname}
                </div>

                <div style={{ marginBottom: 8 }}>
                  <div className="stat-bar-row">
                    <div className="stat-bar-label">❤️ HP</div>
                    <div className="stat-bar">
                      <div className={`stat-bar-fill ${hpClass}`}
                        style={{ width: `${hpPct}%`, background: hpPct > 60 ? 'var(--green)' : hpPct > 25 ? 'var(--warning)' : 'var(--red)' }} />
                    </div>
                    <div className="stat-bar-val">{char.hpCurrent}/{char.hpMax}</div>
                  </div>
                  <div className="stat-bar-row">
                    <div className="stat-bar-label">⭐ Опыт</div>
                    <div className="stat-bar">
                      <div className="stat-bar-fill xp" style={{ width: `${expPct}%` }} />
                    </div>
                    <div className="stat-bar-val">{expPct.toFixed(0)}%</div>
                  </div>
                </div>

                <table style={{ width: '100%', fontSize: 11 }}>
                  <tbody>
                    <tr>
                      <td style={{ color: 'var(--text-dim)' }}>Деньги</td>
                      <td className="money">{char.money.toLocaleString('ru')}</td>
                    </tr>
                    <tr>
                      <td style={{ color: 'var(--text-dim)' }}>Боевой опыт</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{char.battleExp}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Характеристики */}
        {s && (
          <div className="panel mt8">
            <div className="panel-header">
              <span className="panel-title">📊 Характеристики</span>
              {s.pointsAvailable > 0 && (
                <span className="text-gold" style={{ fontSize: 10 }}>+{s.pointsAvailable} очков</span>
              )}
            </div>
            <div className="panel-body">
              <div className="stat-grid">
                {Object.entries(STAT_LABELS).map(([key, label]) => (
                  <div key={key} className="stat-cell">
                    <div className="abbr">{label}</div>
                    <div className="val">{(s as unknown as Record<string, number>)[key]}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── Правая колонка: экипировка + бой ── */}
      <div className="col">
        {/* Экипировка — слоты */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">🛡️ Экипировка</span>
            <a href="#" onClick={e => { e.preventDefault(); navigate('/inventory') }}
              style={{ fontSize: 10 }}>Инвентарь →</a>
          </div>
          <div className="panel-body">
            <div className="equip-slots">
              <EquipSlotCard label="Оружие" icon="⚔️" item={getEquippedItem(null, true)} />
              <EquipSlotCard label="Голова" icon="⛑️" item={getEquippedItem('HEAD')} />
              <EquipSlotCard label="Тело"   icon="🛡️" item={getEquippedItem('CHEST')} />
              <EquipSlotCard label="Ноги"   icon="🩲" item={getEquippedItem('LEGS')} />
              <EquipSlotCard label="Обувь"  icon="👟" item={getEquippedItem('FEET')} />
              <EquipSlotCard label="Руки"   icon="🧤" item={getEquippedItem('HANDS')} />
            </div>
            {equipped.length === 0 && (
              <div className="text-dim mt8" style={{ fontSize: 11, textAlign: 'center' }}>
                Ничего не надето. <a href="#" onClick={e => { e.preventDefault(); navigate('/shop') }}>Зайди в магазин →</a>
              </div>
            )}
          </div>
        </div>

        {/* Начать бой */}
        <div className="panel panel-red">
          <div className="panel-header">
            <span className="panel-title">⚔️ Начать PvE бой</span>
          </div>
          <div className="panel-body">
            {battleError && <div className="alert alert-error mb8">{battleError}</div>}
            {char.status === 'IN_BATTLE' && (
              <div className="alert alert-warning mb8">
                ⚔️ Вы уже в бою!{' '}
                <a href="#" onClick={e => {
                  e.preventDefault()
                  const id = localStorage.getItem('mmo_current_battle')
                  if (id) navigate(`/battle/${id}`)
                }}>
                  Вернуться →
                </a>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 10 }}>
              {BOTS.map(bot => (
                <div
                  key={bot.code}
                  onClick={() => setSelectedBot(bot.code)}
                  style={{
                    background: selectedBot === bot.code ? 'var(--bg-panel3)' : 'var(--bg-panel2)',
                    border: `1px solid ${selectedBot === bot.code ? 'var(--gold-dim)' : 'var(--border)'}`,
                    padding: '8px 6px',
                    cursor: 'pointer',
                    textAlign: 'center',
                    transition: 'all 0.1s',
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 'bold', color: 'var(--text-bright)', marginBottom: 4 }}>
                    {bot.label}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Ур. {bot.level}</div>
                  <div style={{ fontSize: 10, marginTop: 2 }}>{bot.danger}</div>
                </div>
              ))}
            </div>

            <button
              className="btn btn-danger btn-block btn-lg"
              onClick={() => battleMut.mutate()}
              disabled={battleMut.isPending || char.status === 'IN_BATTLE'}
            >
              {battleMut.isPending
                ? <><span className="spinner" />Начинаем...</>
                : '⚔️ В БОЙ!'}
            </button>
          </div>
        </div>

        {/* PvP */}
        <div className="panel" style={{ borderColor: 'var(--gold-dim)' }}>
          <div className="panel-header">
            <span className="panel-title">🥊 PvP Дуэль</span>
          </div>
          <div className="panel-body">
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>
              Вызов другого игрока на дуэль. Победа даёт больше опыта чем PvE.
            </div>
            <button
              className="btn btn-gold btn-block"
              onClick={() => navigate('/pvp')}
              disabled={char.status === 'IN_BATTLE'}
            >
              🥊 Открыть дуэльный зал
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
