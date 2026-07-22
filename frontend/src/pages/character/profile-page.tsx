import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import {
  Shield, Swords, Heart, Star, Lightbulb, HardHat, Hand,
  Layers, Shirt, Footprints, Dumbbell, Zap, Activity, Target,
  Droplet, Clover, Flame, Crown, Briefcase, Award, BookOpen,
  Settings, Pill, X, User,
  type LucideIcon,
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

const ARCH_ICON: Record<string, React.ReactNode> = {
  ATHLETE: <Dumbbell size={14} />, WORKER:   <Settings  size={14} />,
  SHUTTLE: <Briefcase size={14} />, VETERAN: <Award     size={14} />,
  STREET:  <Zap size={14} />,      MERCHANT: <Briefcase size={14} />,
  STUDENT: <BookOpen size={14} />, RESOLVER: <Award     size={14} />,
}

const STAT_COLOR: Record<string, string> = {
  str:'#c43030', agi:'#3a70c0', rea:'#d4a017', acc:'#9a40b0',
  end:'#4a8a35', luck:'#4a9a80', agr:'#c4802a', auth:'#6a8a3a',
}

// ── Один слот в манекене ──────────────────────────────────────
function EquipSlotCard({
  label, Icon, item, onUnequip, inBattle, pockets = 0, rings = 0,
}: {
  label: string; Icon: LucideIcon
  item: ItemInstance | null
  onUnequip?: (id: string) => void
  inBattle?: boolean
  pockets?: number; rings?: number
}) {
  const durPct = item ? (item.durabilityCurrent / item.durabilityMax) * 100 : 0
  const isBroken = item?.status === 'BROKEN' || (item != null && item.durabilityCurrent <= 0)

  return (
    <div className={`esc-card ${item ? 'esc-filled' : ''} ${isBroken ? 'esc-broken' : ''}`}>
      {/* Заголовок слота */}
      <div className="esc-head">
        <Icon size={10} />
        <span>{label}</span>
        {pockets > 0 && <span className="esc-pockets">{Array(pockets).fill('□').join('')}</span>}
        {rings > 0   && <span className="esc-rings">{Array(rings).fill('○').join('')}</span>}
      </div>

      {item ? (
        <div className="esc-body">
          <div className={`esc-name q-${item.quality}`}
            title={`${QUALITY_LABELS[item.quality]} — ${item.template.name}`}>
            {item.template.name}
            {isBroken && <span className="esc-broken-label"> СЛОМАН</span>}
          </div>
          <div className="esc-stats-row">
            {item.template.minDamage != null &&
              <span className="esc-stat dmg">{item.template.minDamage}–{item.template.maxDamage}</span>}
            {(item.template.armor ?? 0) > 0 &&
              <span className="esc-stat arm">Бр.{item.template.armor}</span>}
          </div>
          <div className="esc-dur-row">
            <div className="esc-dur-bg">
              <div className="esc-dur-fill" style={{
                width: `${durPct}%`,
                background: durPct > 60 ? 'var(--green)' : durPct > 25 ? 'var(--warning)' : 'var(--red)',
              }} />
            </div>
            <span className="esc-dur-num">{item.durabilityCurrent}/{item.durabilityMax}</span>
          </div>
          {onUnequip && (
            <button className="btn btn-sm esc-unequip" disabled={inBattle} onClick={() => onUnequip(item.id)}>
              Снять
            </button>
          )}
        </div>
      ) : (
        <div className="esc-empty">— пусто —</div>
      )}
    </div>
  )
}

// ── Манекен снаряжения ─────────────────────────────────────────
function CharacterDoll({
  items, archetype, nickname, equippedCount,
  onUnequip, inBattle,
}: {
  items: ItemInstance[]; archetype: string; nickname: string; equippedCount: number
  onUnequip: (id: string) => void; inBattle: boolean
}) {
  const get = (type: string, slot?: string) =>
    type === 'WEAPON'
      ? items.find(i => i.template.type === 'WEAPON' && i.isEquipped) ?? null
      : items.find(i => i.armorSlot === slot && i.isEquipped) ?? null

  const slotProps = (label: string, Icon: LucideIcon, type: string, slot?: string, opts?: { pockets?: number; rings?: number }) => ({
    label, Icon,
    item: get(type, slot),
    onUnequip,
    inBattle,
    ...opts,
  })

  return (
    <div className="char-doll">
      {/* ── Верхний ряд: голова по центру ── */}
      <div className="cd-row cd-row-head">
        <div className="cd-spacer" />
        <EquipSlotCard {...slotProps('Голова', HardHat, 'ARMOR', 'HEAD')} />
        <div className="cd-spacer" />
      </div>

      {/* ── Средний ряд: оружие | фигура | пояс ── */}
      <div className="cd-row cd-row-mid">
        <EquipSlotCard {...slotProps('Оружие', Swords, 'WEAPON')} />
        {/* Центральная фигура */}
        <div className="cd-figure">
          <div className="cd-fig-icon">{ARCH_ICON[archetype] ?? <User size={20} />}</div>
          <div className="cd-fig-name">{nickname.slice(0, 8)}</div>
          <div className="cd-fig-count">{equippedCount} пред.</div>
        </div>
        <EquipSlotCard {...slotProps('Пояс', Layers, 'ARMOR', 'BELT')} />
      </div>

      {/* ── Руки ── */}
      <div className="cd-row cd-row-hands">
        <EquipSlotCard {...slotProps('Руки Л', Hand, 'ARMOR', 'HANDS', { rings: 3 })} />
        <div className="cd-spacer" />
        <EquipSlotCard {...slotProps('Руки П', Hand, 'ARMOR', 'HANDS_R')} rings={3} />
      </div>

      {/* ── Нижние слоты (полная ширина) ── */}
      <div className="cd-row cd-row-body">
        <EquipSlotCard {...slotProps('Куртка', Shirt, 'ARMOR', 'CHEST', { pockets: 2 })} />
        <EquipSlotCard {...slotProps('Джинсы', Activity, 'ARMOR', 'LEGS', { pockets: 2 })} />
        <EquipSlotCard {...slotProps('Обувь', Footprints, 'ARMOR', 'FEET')} />
      </div>
    </div>
  )
}

// ── Боты ──────────────────────────────────────────────────────
const BOTS = [
  { code:'training_bandit', label:'Хулиган',  level:1, color:'var(--success)', reward:'20–50₽'   },
  { code:'basic_gangster',  label:'Гопник',   level:2, color:'var(--warning)', reward:'50–120₽'  },
  { code:'armed_thug',      label:'Бандит',   level:4, color:'var(--danger)',  reward:'100–300₽' },
]

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

  const { data: char, isLoading } = useQuery({ queryKey:['character','me'], queryFn:() => charactersApi.getMe() })
  const { data: items = [] } = useQuery({ queryKey:['inventory'], queryFn:() => inventoryApi.getItems(), enabled:!!char })

  const battleMut = useMutation({
    mutationFn: () => battlesApi.startPve(selectedBot),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey:['character'] })
      localStorage.setItem('mmo_current_battle', data.battleId)
      navigate(`/battle/${data.battleId}`)
    },
    onError: (err) => { if (err instanceof ApiError) setBattleError(err.message) },
  })

  const unequipMut = useMutation({
    mutationFn: (id: string) => inventoryApi.unequip(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey:['inventory'] })
      qc.invalidateQueries({ queryKey:['character'] })
    },
  })

  if (isLoading) return <div className="loading"><span className="spinner" />Загрузка...</div>
  if (!char) return (
    <div className="alert alert-warning">
      Персонаж не найден.{' '}
      <a href="#" onClick={e => { e.preventDefault(); navigate('/character/create') }}>Создать →</a>
    </div>
  )

  const s = char.stats
  const hpPct  = Math.max(0, Math.min(100, char.hpCurrent / char.hpMax * 100))
  const expThr = [0,5,15,37,76,143,240,370,535,740,1000,1310,1680,2120,2640,3250]
  const lExp   = expThr[char.battleLevel - 1] ?? 0
  const nExp   = expThr[char.battleLevel]     ?? char.battleExp + 100
  const expPct = Math.min(100, ((char.battleExp - lExp) / Math.max(nExp - lExp, 1)) * 100)
  const inBattle = char.status === 'IN_BATTLE'
  const equippedCount = items.filter(i => i.isEquipped).length
  const consumables = items.filter(i => i.template.type==='CONSUMABLE' && i.status!=='DELETED' && i.status!=='CONSUMED')

  return (
    <div className="profile-page">

      {/* ═══ ТОП: карточка персонажа ════════════════════════════ */}
      <div className="profile-char-header panel panel-gold">
        {/* Левая часть: имя / уровень / деньги */}
        <div className="pch-ident">
          <div className="pch-arch-box">{ARCH_ICON[char.archetype] ?? <User size={14} />}</div>
          <div>
            <div className="pch-name">{char.nickname}</div>
            <div className="pch-sub">
              {ARCHETYPE_LABELS[char.archetype]}
              <span className={`pch-status${inBattle ? ' in-battle' : ''}`}> · {STATUS_LABELS[char.status] ?? char.status}</span>
            </div>
          </div>
          <div className="pch-badge">
            <span className="pch-lvl-num">{char.battleLevel}</span>
            <span className="pch-lvl-lbl">ур.</span>
          </div>
          <div className="pch-badge">
            <span className="money" style={{ fontSize:15 }}>₽{char.money.toLocaleString('ru')}</span>
          </div>
        </div>

        {/* HP + EXP полосы */}
        <div className="pch-bars">
          <div className="pch-bar-row">
            <Heart size={11} style={{ color: hpPct < 25 ? 'var(--red)' : 'var(--text-dim)', flexShrink:0 }} />
            <div className="pch-bar-track">
              <div className="pch-bar-fill" style={{
                width:`${hpPct}%`,
                background: hpPct > 60 ? 'var(--green)' : hpPct > 25 ? 'var(--warning)' : 'var(--red)',
              }} />
            </div>
            <span className="pch-bar-val" style={{ color: hpPct < 25 ? 'var(--red)' : 'inherit' }}>
              {char.hpCurrent}/{char.hpMax}
            </span>
          </div>
          <div className="pch-bar-row">
            <Star size={11} style={{ color:'var(--xp)', flexShrink:0 }} />
            <div className="pch-bar-track">
              <div className="pch-bar-fill" style={{ width:`${expPct}%`, background:'var(--xp)' }} />
            </div>
            <span className="pch-bar-val">{char.battleExp} exp</span>
          </div>
        </div>

        {/* Статы */}
        {s && (
          <div className="pch-stats-grid">
            {Object.entries(STAT_LABELS).map(([key, abbr]) => {
              const val = (s as unknown as Record<string,number>)[key] ?? 0
              return (
                <div key={key} className="pch-stat-row" title={STAT_DESCRIPTIONS[key]}>
                  <span className="pch-stat-abbr">{abbr}</span>
                  <div className="pch-stat-track">
                    <div style={{ height:'100%', width:`${Math.min(100, val/20*100)}%`, background:STAT_COLOR[key] }} />
                  </div>
                  <span className="pch-stat-val">{val}</span>
                </div>
              )
            })}
            {(s.pointsAvailable ?? 0) > 0 && (
              <a href="/stats" className="pch-pts">+{s.pointsAvailable} очк. →</a>
            )}
          </div>
        )}
      </div>

      {/* ═══ СЕТКА: манекен + панель боя ═══════════════════════ */}
      <div className="profile-grid">

        {/* ─── Манекен снаряжения ──────────────────────────────── */}
        <div className="panel profile-equip">
          <div className="panel-header">
            <span className="panel-title">
              <Shield size={12} style={{ marginRight:4, verticalAlign:'middle' }} />
              Снаряжение
            </span>
            <a href="#" onClick={e => { e.preventDefault(); navigate('/inventory') }} style={{ fontSize:10 }}>
              Весь инвентарь →
            </a>
          </div>
          <div className="panel-body" style={{ padding:'8px 10px' }}>
            <CharacterDoll
              items={items}
              archetype={char.archetype}
              nickname={char.nickname}
              equippedCount={equippedCount}
              onUnequip={id => unequipMut.mutate(id)}
              inBattle={inBattle}
            />
            <div style={{ fontSize:9, color:'var(--text-dim)', marginTop:6, paddingTop:4, borderTop:'1px solid var(--border)' }}>
              ○ = кольцо/оберег (Этап 2) · □ = карман (Этап 2)
            </div>
          </div>
        </div>

        {/* ─── Панель боя ─────────────────────────────────────── */}
        <div className="profile-battle">

          {/* PvE */}
          <div className="panel panel-red" style={{ marginBottom:8 }}>
            <div className="panel-header">
              <span className="panel-title">
                <Swords size={12} style={{ marginRight:4, verticalAlign:'middle' }} />
                Начать бой (PvE)
              </span>
            </div>
            <div className="panel-body" style={{ padding:'8px 10px' }}>
              {battleError && <div className="alert alert-error mb8">{battleError}</div>}
              {inBattle && (
                <div className="alert alert-warning mb8" style={{ fontSize:11 }}>
                  Ты уже в бою!{' '}
                  <a href="#" onClick={e => { e.preventDefault(); const id=localStorage.getItem('mmo_current_battle'); if(id) navigate(`/battle/${id}`) }}>
                    Вернуться →
                  </a>
                </div>
              )}

              {/* Выбор бота */}
              <div style={{ display:'flex', flexDirection:'column', gap:3, marginBottom:8 }}>
                {BOTS.map(bot => (
                  <div key={bot.code}
                    onClick={() => setSelectedBot(bot.code)}
                    className={`bot-card ${selectedBot === bot.code ? 'selected' : ''}`}
                    style={{ padding:'6px 8px' }}
                  >
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <div>
                        <span style={{ fontSize:11, fontWeight:'bold', color:'var(--text-bright)' }}>{bot.label}</span>
                        <span style={{ fontSize:9, color:'var(--text-dim)', marginLeft:6 }}>Ур.{bot.level}</span>
                        <span style={{ fontSize:9, color:bot.color, marginLeft:6 }}>● {bot.color === 'var(--success)' ? 'Лёгкий' : bot.color === 'var(--warning)' ? 'Средний' : 'Сложный'}</span>
                      </div>
                      <span className="money" style={{ fontSize:10 }}>{bot.reward}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Карманы */}
              <div style={{ marginBottom:8 }}>
                <div style={{ fontSize:9, color:'var(--gold-dim)', textTransform:'uppercase', letterSpacing:1, marginBottom:4, display:'flex', alignItems:'center', gap:3 }}>
                  <Pill size={9} /> Карманы (макс. 4)
                </div>
                <div className="loadout-slots" style={{ marginBottom: consumables.length ? 4 : 0 }}>
                  {[0,1,2,3].map(i => {
                    const id = loadoutIds[i]
                    const item = id ? consumables.find(x => x.id === id) : null
                    return (
                      <div key={i}
                        className={`loadout-slot ${item ? 'filled' : 'empty'}`}
                        onClick={() => item && toggleLoadout(item.id)}
                        title={item ? 'Убрать' : 'Пусто'}
                      >
                        <span className="loadout-slot-num">{i+1}</span>
                        {item
                          ? <><span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:9 }}>{item.template.name}</span><X size={8} style={{ color:'var(--danger)', flexShrink:0 }} /></>
                          : <span>— пусто —</span>
                        }
                      </div>
                    )
                  })}
                </div>
                {consumables.length > 0 ? (
                  <div className="consumable-list">
                    {consumables.map(c => {
                      const inL = loadoutIds.includes(c.id)
                      const full = loadoutIds.length >= 4 && !inL
                      return (
                        <div key={c.id}
                          className={`consumable-pick-row ${inL?'in-loadout':''} ${full?'full-loadout':''}`}
                          onClick={() => !full && toggleLoadout(c.id)}
                        >
                          <Pill size={9} style={{ color:inL?'var(--success)':'var(--text-dim)', flexShrink:0 }} />
                          <span style={{ flex:1 }}>{c.template.name}</span>
                          <span style={{ color:'var(--success)', fontFamily:'var(--font-mono)', fontSize:10 }}>+{c.template.hpBonus}</span>
                          {inL && <span style={{ color:'var(--success)', fontSize:8 }}>✓</span>}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div style={{ fontSize:9, color:'var(--text-dim)', fontStyle:'italic' }}>
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
          <div className="panel" style={{ borderColor:'var(--gold-dim)' }}>
            <div className="panel-header">
              <span className="panel-title">
                <Swords size={12} style={{ marginRight:4, verticalAlign:'middle' }} />
                PvP Дуэль
              </span>
            </div>
            <div className="panel-body" style={{ padding:'8px 10px' }}>
              <div style={{ fontSize:10, color:'var(--text-dim)', marginBottom:8 }}>
                Победа = ×2 опыта · Поражение = 20% опыта
              </div>
              <button className="btn btn-gold btn-block" onClick={() => navigate('/pvp')} disabled={inBattle}>
                <Swords size={12} style={{ marginRight:5, verticalAlign:'middle' }} />
                Дуэльный зал
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
