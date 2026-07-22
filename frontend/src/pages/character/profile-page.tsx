import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import {
  Shield, Swords, Heart, Star, Lightbulb, HardHat, Hand,
  Layers, Shirt, Footprints, Dumbbell, Zap, Activity, Target,
  Droplet, Clover, Flame, Crown, Briefcase, Award, BookOpen,
  Settings, Pill, X,
} from 'lucide-react'
import { charactersApi } from '../../shared/api/characters.api'
import { battlesApi } from '../../shared/api/battles.api'
import { inventoryApi } from '../../shared/api/inventory.api'
import {
  ARCHETYPE_LABELS, STAT_LABELS, STAT_DESCRIPTIONS, STATUS_LABELS,
  QUALITY_LABELS, type ItemInstance,
} from '../../shared/types/api.types'
import { ApiError } from '../../shared/api/client'

const LOADOUT_KEY = 'mmo_battle_loadout'
function getLoadout(): string[] {
  try { return JSON.parse(localStorage.getItem(LOADOUT_KEY) ?? '[]') } catch { return [] }
}

// ── Иконки архетипов ──────────────────────────────────────────
const ARCH_ICON: Record<string, React.ReactNode> = {
  ATHLETE:  <Dumbbell  size={13} />, WORKER:   <Settings  size={13} />,
  SHUTTLE:  <Briefcase size={13} />, VETERAN:  <Award     size={13} />,
  STREET:   <Zap       size={13} />, MERCHANT: <Briefcase size={13} />,
  STUDENT:  <BookOpen  size={13} />, RESOLVER: <Award     size={13} />,
}

const STAT_COLOR: Record<string, string> = {
  str:'#c43030', agi:'#3a70c0', rea:'#d4a017', acc:'#9a40b0',
  end:'#4a8a35', luck:'#4a9a80', agr:'#c4802a', auth:'#6a8a3a',
}

// ── Определение слотов снаряжения ─────────────────────────────
const EQUIP_SLOTS = [
  { label:'Оружие',    type:'WEAPON', slot: undefined,  Icon: Swords,     pockets: 0, rings: 0 },
  { label:'Голова',    type:'ARMOR',  slot:'HEAD',       Icon: HardHat,    pockets: 0, rings: 0 },
  { label:'Куртка',    type:'ARMOR',  slot:'CHEST',      Icon: Shirt,      pockets: 2, rings: 0 },
  { label:'Руки',      type:'ARMOR',  slot:'HANDS',      Icon: Hand,       pockets: 0, rings: 3 },
  { label:'Пояс',      type:'ARMOR',  slot:'BELT',       Icon: Layers,     pockets: 0, rings: 0 },
  { label:'Джинсы',    type:'ARMOR',  slot:'LEGS',       Icon: Activity,   pockets: 2, rings: 0 },
  { label:'Обувь',     type:'ARMOR',  slot:'FEET',       Icon: Footprints, pockets: 0, rings: 0 },
]

// ── Список слотов снаряжения (таблица) ────────────────────────
function EquipmentList({
  items, onUnequip, inBattle,
}: {
  items: ItemInstance[]; onUnequip: (id: string) => void; inBattle: boolean
}) {
  const getItem = (type: string, slot?: string): ItemInstance | null => {
    if (type === 'WEAPON') return items.find(i => i.template.type === 'WEAPON' && i.isEquipped) ?? null
    if (slot) return items.find(i => i.armorSlot === slot && i.isEquipped) ?? null
    return null
  }

  return (
    <table className="equip-list-table">
      <tbody>
        {EQUIP_SLOTS.map(({ label, type, slot, Icon, pockets, rings }) => {
          const item = getItem(type, slot)
          const durPct = item ? (item.durabilityCurrent / item.durabilityMax) * 100 : 0
          const isBroken = item?.status === 'BROKEN' || (item != null && item.durabilityCurrent <= 0)
          return (
            <tr key={label} className={`equip-list-row ${item ? 'has-item' : 'empty'} ${isBroken ? 'broken' : ''}`}>
              {/* Слот */}
              <td className="elt-slot">
                <Icon size={12} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                <span>{label}</span>
              </td>
              {/* Предмет */}
              <td className="elt-item">
                {item ? (
                  <span className={`q-${item.quality}`} title={QUALITY_LABELS[item.quality]}>
                    {item.template.name}
                    {isBroken && <span style={{ color: 'var(--danger)', fontSize: 9, marginLeft: 4 }}>СЛОМАН</span>}
                  </span>
                ) : (
                  <span className="elt-empty">— пусто —</span>
                )}
              </td>
              {/* Характеристики */}
              <td className="elt-stats">
                {item?.template.minDamage != null && (
                  <span className="equip-stat dmg">{item.template.minDamage}–{item.template.maxDamage}</span>
                )}
                {(item?.template.armor ?? 0) > 0 && (
                  <span className="equip-stat arm">Бр.{item!.template.armor}</span>
                )}
              </td>
              {/* Прочность */}
              <td className="elt-dur">
                {item && !isBroken && (
                  <div className="elt-dur-bar">
                    <div className="elt-dur-fill" style={{
                      width: `${durPct}%`,
                      background: durPct > 60 ? 'var(--green)' : durPct > 25 ? 'var(--warning)' : 'var(--red)',
                    }} />
                  </div>
                )}
                {item && (
                  <span className="elt-dur-num">{item.durabilityCurrent}/{item.durabilityMax}</span>
                )}
              </td>
              {/* Дополнительные слоты */}
              <td className="elt-extras">
                {rings > 0 && Array.from({ length: rings }).map((_, i) => (
                  <span key={i} className="elt-ring" title="Слот кольца (Этап 2)">○</span>
                ))}
                {pockets > 0 && Array.from({ length: pockets }).map((_, i) => (
                  <span key={i} className="elt-pocket" title="Карман (Этап 2)">□</span>
                ))}
              </td>
              {/* Действие */}
              <td className="elt-action">
                {item && (
                  <button
                    className="btn btn-sm"
                    disabled={inBattle}
                    onClick={() => onUnequip(item.id)}
                  >
                    Снять
                  </button>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ── Боты ──────────────────────────────────────────────────────
const BOTS = [
  { code:'training_bandit', label:'Тренировочный хулиган', level:1, danger:'easy'   as const, reward:'20–50₽'   },
  { code:'basic_gangster',  label:'Гопник',                level:2, danger:'medium' as const, reward:'50–120₽'  },
  { code:'armed_thug',      label:'Вооружённый бандит',    level:4, danger:'hard'   as const, reward:'100–300₽' },
]
const DANGER_CFG = { easy:['var(--success)','Лёгкий'], medium:['var(--warning)','Средний'], hard:['var(--danger)','Сложный'] }

// ══════════════════════════════════════════════════════════════
export function ProfilePage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [battleError, setBattleError] = useState('')
  const [selectedBot, setSelectedBot] = useState('training_bandit')
  const [loadoutIds, setLoadoutIds] = useState<string[]>(() => getLoadout())

  const toggleLoadout = (id: string) => {
    setLoadoutIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 4 ? [...prev, id] : prev
      localStorage.setItem(LOADOUT_KEY, JSON.stringify(next))
      return next
    })
  }

  const { data: char, isLoading } = useQuery({ queryKey: ['character','me'], queryFn: () => charactersApi.getMe() })
  const { data: items = [] } = useQuery({ queryKey: ['inventory'], queryFn: () => inventoryApi.getItems(), enabled: !!char })

  const battleMut = useMutation({
    mutationFn: () => battlesApi.startPve(selectedBot),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['character'] })
      localStorage.setItem('mmo_current_battle', data.battleId)
      navigate(`/battle/${data.battleId}`)
    },
    onError: (err) => { if (err instanceof ApiError) setBattleError(err.message) },
  })

  const unequipMut = useMutation({
    mutationFn: (id: string) => inventoryApi.unequip(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['character'] })
    },
  })

  if (isLoading) return <div className="loading"><span className="spinner" />Загрузка...</div>
  if (!char) return (
    <div className="alert alert-warning">
      Персонаж не найден. <a href="#" onClick={e => { e.preventDefault(); navigate('/character/create') }}>Создать →</a>
    </div>
  )

  const s = char.stats
  const hpPct = Math.max(0, Math.min(100, (char.hpCurrent / char.hpMax) * 100))
  const expThr = [0,5,15,37,76,143,240,370,535,740,1000,1310,1680,2120,2640,3250]
  const expPct = Math.min(100, ((char.battleExp - (expThr[char.battleLevel-1]??0)) / Math.max((expThr[char.battleLevel]??char.battleExp+100) - (expThr[char.battleLevel-1]??0), 1)) * 100)
  const consumables = items.filter(i => i.template.type==='CONSUMABLE' && i.status!=='DELETED' && i.status!=='CONSUMED')
  const inBattle = char.status === 'IN_BATTLE'

  return (
    <div className="profile-page">

      {/* ═══ 1. ШАПКА ПЕРСОНАЖА (полная ширина) ═══════════════════ */}
      <div className="profile-char-header panel panel-gold">
        <div className="pch-left">
          <div className="pch-arch">{ARCH_ICON[char.archetype]}</div>
          <div className="pch-name-block">
            <div className="pch-name">{char.nickname}</div>
            <div className="pch-sub">
              {ARCHETYPE_LABELS[char.archetype]}
              <span className={`pch-status ${inBattle ? 'in-battle' : ''}`}>
                · {STATUS_LABELS[char.status] ?? char.status}
              </span>
            </div>
          </div>
          <div className="pch-level">
            <span className="pch-level-num">{char.battleLevel}</span>
            <span className="pch-level-label">уровень</span>
          </div>
          <div className="pch-money">
            <span className="money" style={{ fontSize: 16 }}>₽{char.money.toLocaleString('ru')}</span>
            <span className="pch-level-label">наличные</span>
          </div>
        </div>

        <div className="pch-bars">
          {/* HP */}
          <div className="pch-bar-row">
            <Heart size={10} style={{ color: hpPct < 25 ? 'var(--red)' : 'var(--text-dim)', flexShrink: 0 }} />
            <div className="pch-bar-bg">
              <div className="pch-bar-fill" style={{
                width: `${hpPct}%`,
                background: hpPct > 60 ? 'var(--green)' : hpPct > 25 ? 'var(--warning)' : 'var(--red)',
              }} />
            </div>
            <span className="pch-bar-num" style={{ color: hpPct < 25 ? 'var(--red)' : 'var(--text-dim)' }}>
              {char.hpCurrent}/{char.hpMax}
            </span>
          </div>
          {/* EXP */}
          <div className="pch-bar-row">
            <Star size={10} style={{ color: 'var(--xp)', flexShrink: 0 }} />
            <div className="pch-bar-bg">
              <div className="pch-bar-fill" style={{ width: `${expPct}%`, background: 'var(--xp)' }} />
            </div>
            <span className="pch-bar-num">{char.battleExp} exp</span>
          </div>
        </div>

        {/* Mini stats */}
        {s && (
          <div className="pch-stats">
            {Object.entries(STAT_LABELS).map(([key, abbr]) => {
              const val = (s as unknown as Record<string,number>)[key] ?? 0
              return (
                <div key={key} className="pch-stat-cell" title={STAT_DESCRIPTIONS[key]}>
                  <div className="pch-stat-bar">
                    <div style={{ height:'100%', width:`${Math.min(100, val/20*100)}%`, background: STAT_COLOR[key] }} />
                  </div>
                  <span className="pch-stat-abbr">{abbr}</span>
                  <span className="pch-stat-val">{val}</span>
                </div>
              )
            })}
            {(s.pointsAvailable ?? 0) > 0 && (
              <a href="/stats" className="pch-points-badge">+{s.pointsAvailable}</a>
            )}
          </div>
        )}
      </div>

      {/* ═══ 2. НИЖНЯЯ СЕТКА: снаряжение + бой ════════════════════ */}
      <div className="profile-grid">

        {/* ─── Снаряжение ────────────────────────────────────────── */}
        <div className="panel profile-equip">
          <div className="panel-header">
            <span className="panel-title">
              <Shield size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              Снаряжение
            </span>
            <a href="#" onClick={e => { e.preventDefault(); navigate('/inventory') }} style={{ fontSize: 10 }}>
              Инвентарь →
            </a>
          </div>
          <div className="panel-body" style={{ padding: '4px 0' }}>
            <EquipmentList
              items={items}
              onUnequip={id => unequipMut.mutate(id)}
              inBattle={inBattle}
            />
            <div style={{ fontSize: 9, color: 'var(--text-dim)', padding: '4px 10px', borderTop: '1px solid var(--border)', marginTop: 4 }}>
              ○ = кольцо/оберег (Этап 2) · □ = карман (Этап 2)
            </div>
          </div>
        </div>

        {/* ─── Бой ───────────────────────────────────────────────── */}
        <div className="profile-battle">

          {/* PvE */}
          <div className="panel panel-red" style={{ marginBottom: 8 }}>
            <div className="panel-header">
              <span className="panel-title">
                <Swords size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                Начать бой (PvE)
              </span>
            </div>
            <div className="panel-body" style={{ padding: '8px 10px' }}>
              {battleError && <div className="alert alert-error mb8">{battleError}</div>}
              {inBattle && (
                <div className="alert alert-warning mb8" style={{ fontSize: 11 }}>
                  Ты уже в бою!{' '}
                  <a href="#" onClick={e => { e.preventDefault(); const id = localStorage.getItem('mmo_current_battle'); if (id) navigate(`/battle/${id}`) }}>
                    Вернуться →
                  </a>
                </div>
              )}

              {/* Боты */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                {BOTS.map(bot => {
                  const [dColor, dLabel] = DANGER_CFG[bot.danger]
                  return (
                    <div key={bot.code}
                      onClick={() => setSelectedBot(bot.code)}
                      className={`bot-card ${selectedBot === bot.code ? 'selected' : ''}`}
                    >
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 'bold', color: 'var(--text-bright)' }}>{bot.label}</div>
                          <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 1 }}>
                            Ур.{bot.level} · <span style={{ color: dColor }}>● {dLabel}</span>
                          </div>
                        </div>
                        <div style={{ textAlign:'right' }}>
                          <div className="money" style={{ fontSize: 10 }}>{bot.reward}</div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Карманы */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 9, color: 'var(--gold-dim)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
                  <Pill size={9} /> Карманы (в бой, макс. 4)
                </div>
                <div className="loadout-slots" style={{ marginBottom: consumables.length > 0 ? 4 : 0 }}>
                  {[0,1,2,3].map(i => {
                    const id = loadoutIds[i]
                    const item = id ? consumables.find(x => x.id === id) : null
                    return (
                      <div key={i}
                        className={`loadout-slot ${item ? 'filled' : 'empty'}`}
                        onClick={() => item && toggleLoadout(item.id)}
                        title={item ? 'Нажми чтобы убрать' : 'Пусто'}
                      >
                        <span className="loadout-slot-num">{i+1}</span>
                        {item ? (
                          <>
                            <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize: 9 }}>{item.template.name}</span>
                            <X size={8} style={{ color:'var(--danger)', flexShrink:0 }} />
                          </>
                        ) : <span>— пусто —</span>}
                      </div>
                    )
                  })}
                </div>
                {consumables.length > 0 && (
                  <div className="consumable-list">
                    {consumables.map(c => {
                      const inL = loadoutIds.includes(c.id)
                      const full = loadoutIds.length >= 4 && !inL
                      return (
                        <div key={c.id}
                          className={`consumable-pick-row ${inL?'in-loadout':''} ${full?'full-loadout':''}`}
                          onClick={() => !full && toggleLoadout(c.id)}
                        >
                          <Pill size={9} style={{ color: inL ? 'var(--success)' : 'var(--text-dim)', flexShrink:0 }} />
                          <span style={{ flex:1 }}>{c.template.name}</span>
                          <span style={{ color:'var(--success)', fontFamily:'var(--font-mono)', fontSize: 10 }}>+{c.template.hpBonus}</span>
                          {inL && <span style={{ color:'var(--success)', fontSize:8 }}>✓</span>}
                        </div>
                      )
                    })}
                  </div>
                )}
                {consumables.length === 0 && (
                  <div style={{ fontSize: 9, color: 'var(--text-dim)', fontStyle:'italic' }}>
                    Нет расходников — <a href="/shop">купи в магазине</a>
                  </div>
                )}
              </div>

              <button
                className="btn btn-danger btn-block btn-lg"
                onClick={() => battleMut.mutate()}
                disabled={battleMut.isPending || inBattle}
              >
                {battleMut.isPending
                  ? <><span className="spinner" />Начинаем...</>
                  : <><Swords size={13} style={{ marginRight:5, verticalAlign:'middle' }} />В БОЙ!</>}
              </button>
            </div>
          </div>

          {/* PvP */}
          <div className="panel" style={{ borderColor: 'var(--gold-dim)', marginBottom: 8 }}>
            <div className="panel-header">
              <span className="panel-title">
                <Swords size={12} style={{ marginRight:4, verticalAlign:'middle' }} />
                PvP Дуэль
              </span>
            </div>
            <div className="panel-body" style={{ padding: '8px 10px' }}>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 8 }}>
                Победа = ×2 опыта · Поражение = 20% опыта
              </div>
              <button className="btn btn-gold btn-block" onClick={() => navigate('/pvp')} disabled={inBattle}>
                <Swords size={12} style={{ marginRight:5, verticalAlign:'middle' }} />
                Дуэльный зал
              </button>
            </div>
          </div>

          {/* Подсказка */}
          <div className="panel" style={{ borderColor: 'var(--border-light)' }}>
            <div className="panel-header" style={{ padding: '3px 8px' }}>
              <span className="panel-title" style={{ fontSize: 9 }}>
                <Lightbulb size={10} style={{ marginRight:3, verticalAlign:'middle' }} />
                Карманы (скоро)
              </span>
            </div>
            <div className="panel-body" style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.6, padding: '6px 8px' }}>
              Надень куртку + джинсы → получишь 4 кармана.
              Расходники в карманах доступны прямо в бою.
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
