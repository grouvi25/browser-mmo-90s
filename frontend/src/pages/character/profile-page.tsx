import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import {
  Shield, Swords, Heart, Star, Lightbulb, HardHat, Hand,
  Layers, PersonStanding, Wrench, Shirt, Footprints,
  Dumbbell, Zap, Activity, Target, Droplet, Clover, Flame, Crown,
  Briefcase, Award, BookOpen, Settings, Pill, X,
} from 'lucide-react'

const LOADOUT_KEY = 'mmo_battle_loadout'
function getLoadout(): string[] {
  try { return JSON.parse(localStorage.getItem(LOADOUT_KEY) ?? '[]') } catch { return [] }
}
import { charactersApi } from '../../shared/api/characters.api'
import { battlesApi } from '../../shared/api/battles.api'
import { inventoryApi } from '../../shared/api/inventory.api'
import {
  ARCHETYPE_LABELS, STAT_LABELS, STAT_DESCRIPTIONS, STATUS_LABELS,
  QUALITY_LABELS, WEAPON_TYPE_LABELS, ARMOR_SLOT_LABELS,
  type ItemInstance,
} from '../../shared/types/api.types'
import { ApiError } from '../../shared/api/client'

// ── Иконки архетипов (Lucide) ─────────────────────────────────
const ARCH_ICON_MAP: Record<string, React.ReactNode> = {
  ATHLETE:  <Dumbbell  size={14} />,
  WORKER:   <Settings  size={14} />,
  SHUTTLE:  <Briefcase size={14} />,
  VETERAN:  <Award     size={14} />,
  STREET:   <Zap       size={14} />,
  MERCHANT: <Briefcase size={14} />,
  STUDENT:  <BookOpen  size={14} />,
  RESOLVER: <Award     size={14} />,
}

// ── Описания статов для прогресс-баров ────────────────────────
const STAT_COLOR: Record<string, string> = {
  str: '#c43030', agi: '#3a70c0', rea: '#d4a017',
  acc: '#9a40b0', end: '#4a8a35', luck: '#4a9a80',
  agr: '#c4802a', auth: '#6a8a3a',
}

// ── Иконка опасности бота (без эмодзи) ───────────────────────
function DangerBadge({ level }: { level: 'easy' | 'medium' | 'hard' }) {
  const cfg = {
    easy:   { color: 'var(--success)', label: 'Лёгкий' },
    medium: { color: 'var(--warning)', label: 'Средний' },
    hard:   { color: 'var(--danger)',  label: 'Сложный' },
  }[level]
  return (
    <span style={{ color: cfg.color, fontWeight: 'bold', fontSize: 10 }}>
      ● {cfg.label}
    </span>
  )
}

// ── Компонент: один слот снаряжения ───────────────────────────
function EquipSlot({
  label, icon, item, slot, onEquip, onUnequip, inBattle,
  pockets = 0, rings = 0,
}: {
  label: string
  icon: React.ReactNode
  item: ItemInstance | null
  slot?: string
  onEquip?: (id: string) => void
  onUnequip?: (id: string) => void
  inBattle?: boolean
  pockets?: number
  rings?: number
  equippedItems?: ItemInstance[]
}) {
  const durPct = item ? (item.durabilityCurrent / item.durabilityMax) * 100 : 0
  const isBroken = item?.status === 'BROKEN' || (item && item.durabilityCurrent <= 0)

  return (
    <div className={`equip-slot-new ${item ? 'filled' : 'empty'} ${isBroken ? 'broken' : ''}`}>
      <div className="equip-slot-header">
        <span className="equip-slot-icon">{icon}</span>
        <span className="equip-slot-label">{label}</span>
      </div>

      {item ? (
        <>
          <div className={`equip-slot-item q-${item.quality}`} title={`${QUALITY_LABELS[item.quality]} — ${item.template.description ?? ''}`}>
            {item.template.name}
          </div>
          {/* Stats */}
          <div className="equip-slot-stats">
            {item.template.minDamage != null && (
              <span className="equip-stat dmg">
                <Swords size={9} style={{ marginRight: 2, verticalAlign: 'middle' }} />
                {item.template.minDamage}–{item.template.maxDamage}
              </span>
            )}
            {(item.template.armor ?? 0) > 0 && (
              <span className="equip-stat arm">
                <Shield size={9} style={{ marginRight: 2, verticalAlign: 'middle' }} />
                {item.template.armor}
              </span>
            )}
          </div>
          {/* Durability bar */}
          <div className="equip-slot-dur">
            <div className="equip-dur-fill" style={{
              width: `${durPct}%`,
              background: durPct > 60 ? 'var(--green)' : durPct > 25 ? 'var(--warning)' : 'var(--red)',
            }} />
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-dim)', textAlign: 'right' }}>
            {item.durabilityCurrent}/{item.durabilityMax}
          </div>
          {onUnequip && (
            <button className="btn btn-sm" style={{ marginTop: 2, fontSize: 9, padding: '1px 6px' }}
              disabled={inBattle}
              onClick={() => onUnequip(item.id)}>
              Снять
            </button>
          )}
        </>
      ) : (
        <div className="equip-slot-empty-text">— пусто —</div>
      )}

      {/* Кольца под слотом */}
      {rings > 0 && (
        <div className="equip-rings">
          {Array.from({ length: rings }).map((_, i) => (
            <div key={i} className="ring-slot" title="Слот для кольца/оберега (Этап 2)">
              <span>○</span>
            </div>
          ))}
        </div>
      )}

      {/* Карманы */}
      {pockets > 0 && (
        <div className="equip-pockets">
          {Array.from({ length: pockets }).map((_, i) => (
            <div key={i} className="pocket-slot" title="Карман (Этап 2) — сюда ложатся расходники для боя">
              <span>□</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Компонент: стенд брони ────────────────────────────────────
function CharacterStand({
  items,
  onUnequip,
  inBattle = false,
}: {
  items: ItemInstance[]
  onUnequip: (id: string) => void
  inBattle?: boolean
}) {
  const getItem = (type: string, slot?: string): ItemInstance | null => {
    if (type === 'WEAPON') return items.find(i => i.template.type === 'WEAPON' && i.isEquipped) ?? null
    if (slot) return items.find(i => i.armorSlot === slot && i.isEquipped) ?? null
    return null
  }

  return (
    <div className="char-stand">
      {/* ── Голова ── */}
      <div className="stand-row stand-top">
        <EquipSlot label="Голова" icon={<HardHat size={13} />} item={getItem('ARMOR', 'HEAD')} slot="HEAD"
          onUnequip={onUnequip} inBattle={inBattle} />
      </div>

      {/* ── Руки + Тело ── */}
      <div className="stand-row stand-middle">
        {/* Левая рука — оружие */}
        <div className="stand-col-side">
          <EquipSlot label="Оружие" icon={<Swords size={13} />} item={getItem('WEAPON')}
            onUnequip={onUnequip} inBattle={inBattle} />
          <EquipSlot label="Руки Л" icon={<Hand size={13} />} item={getItem('ARMOR', 'HANDS')} slot="HANDS"
            onUnequip={onUnequip} inBattle={inBattle}
            rings={3} />
        </div>

        {/* Силуэт персонажа */}
        <div className="stand-figure">
          <div className="figure-silhouette">
            <PersonStanding size={40} style={{ color: 'var(--text-dim)' }} />
          </div>
          <div className="figure-name">
            {items.length === 0 ? 'Не одето' : `${items.filter(i => i.isEquipped).length} предм.`}
          </div>
        </div>

        {/* Правая рука — доп. слот */}
        <div className="stand-col-side">
          <EquipSlot label="Пояс" icon={<Layers size={13} />} item={getItem('ARMOR', 'BELT')} slot="BELT"
            onUnequip={onUnequip} inBattle={inBattle} />
          <EquipSlot label="Руки П" icon={<Hand size={13} />} item={null}
            rings={3} />
        </div>
      </div>

      {/* ── Торс ── */}
      <div className="stand-row stand-torso">
        <EquipSlot label="Куртка" icon={<Shirt size={13} />} item={getItem('ARMOR', 'CHEST')} slot="CHEST"
          onUnequip={onUnequip} inBattle={inBattle}
          pockets={2} />
      </div>

      {/* ── Ноги ── */}
      <div className="stand-row">
        <EquipSlot label="Джинсы" icon={<Activity size={13} />} item={getItem('ARMOR', 'LEGS')} slot="LEGS"
          onUnequip={onUnequip} inBattle={inBattle}
          pockets={2} />
      </div>

      {/* ── Обувь ── */}
      <div className="stand-row stand-bottom">
        <EquipSlot label="Обувь" icon={<Footprints size={13} />} item={getItem('ARMOR', 'FEET')} slot="FEET"
          onUnequip={onUnequip} inBattle={inBattle} />
      </div>
    </div>
  )
}

// ── Боты ──────────────────────────────────────────────────────
const BOTS = [
  { code: 'training_bandit', label: 'Тренировочный хулиган', level: 1, danger: 'easy'   as const, reward: '20–50₽'   },
  { code: 'basic_gangster',  label: 'Гопник',                level: 2, danger: 'medium' as const, reward: '50–120₽'  },
  { code: 'armed_thug',      label: 'Вооружённый бандит',    level: 4, danger: 'hard'   as const, reward: '100–300₽' },
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
      const next = prev.includes(id)
        ? prev.filter(x => x !== id)
        : prev.length < 4 ? [...prev, id] : prev
      localStorage.setItem(LOADOUT_KEY, JSON.stringify(next))
      return next
    })
  }

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
  const hpPct = (char.hpCurrent / char.hpMax) * 100
  const expThresholds = [0, 5, 15, 37, 76, 143, 240, 370, 535, 740, 1000, 1310, 1680, 2120, 2640, 3250]
  const levelExp = expThresholds[char.battleLevel - 1] ?? 0
  const nextExp  = expThresholds[char.battleLevel]     ?? char.battleExp + 100
  const expPct   = Math.min(100, ((char.battleExp - levelExp) / Math.max(nextExp - levelExp, 1)) * 100)

  return (
    <div className="profile-layout">
      {/* ══ ЛЕВАЯ ЧАСТЬ: персонаж + стенд ══════════════════════ */}
      <div className="profile-left">

        {/* Карточка персонажа */}
        <div className="panel panel-gold" style={{ marginBottom: 8 }}>
          <div className="panel-header">
            <span className="panel-title">
              {ARCH_ICON_MAP[char.archetype] ?? null}
              {' '}{char.nickname}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
              {ARCHETYPE_LABELS[char.archetype]} · {STATUS_LABELS[char.status] ?? char.status}
            </span>
          </div>
          <div className="panel-body" style={{ padding: '8px 10px' }}>
            {/* Уровень + деньги */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 'bold', color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>
                  Ур. {char.battleLevel}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Боевой уровень</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="money" style={{ fontSize: 18 }}>₽{char.money.toLocaleString('ru')}</div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Наличные</div>
              </div>
            </div>

            {/* HP */}
            <div style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--text-dim)' }}>
                  <Heart size={11} /> Здоровье
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', color: hpPct < 25 ? 'var(--red)' : 'var(--text-bright)' }}>
                  {char.hpCurrent} / {char.hpMax}
                </span>
              </div>
              <div style={{ height: 10, background: 'var(--bg)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${hpPct}%`,
                  background: hpPct > 60 ? 'var(--green)' : hpPct > 25 ? 'var(--warning)' : 'var(--red)',
                  transition: 'width 0.5s',
                }} />
              </div>
            </div>

            {/* EXP */}
            <div style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--text-dim)' }}>
                  <Star size={11} /> Опыт
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--xp)' }}>
                  {char.battleExp} / {nextExp}
                </span>
              </div>
              <div style={{ height: 6, background: 'var(--bg)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${expPct}%`, background: 'var(--xp)' }} />
              </div>
            </div>

            {/* Статы */}
            {s && (
              <div>
                <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                  Характеристики
                  {s.pointsAvailable > 0 && (
                    <a href="/stats" style={{ color: 'var(--gold)', marginLeft: 8 }}>
                      +{s.pointsAvailable} →
                    </a>
                  )}
                </div>
                <div className="profile-stats-grid">
                  {Object.entries(STAT_LABELS).map(([key, abbr]) => (
                    <div key={key} className="profile-stat-cell" title={STAT_DESCRIPTIONS[key]}>
                      <div className="profile-stat-bar-bg">
                        <div className="profile-stat-bar-fill" style={{
                          width: `${Math.min(100, ((s as unknown as Record<string,number>)[key] ?? 0) / 20 * 100)}%`,
                          background: STAT_COLOR[key] ?? 'var(--gold-dim)',
                        }} />
                      </div>
                      <span className="profile-stat-label">{abbr}</span>
                      <span className="profile-stat-val">{(s as unknown as Record<string,number>)[key]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Стенд брони */}
        <div className="panel" style={{ marginBottom: 8 }}>
          <div className="panel-header">
            <span className="panel-title">
              <Shield size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              Снаряжение
            </span>
            <a href="#" onClick={e => { e.preventDefault(); navigate('/inventory') }} style={{ fontSize: 10 }}>
              Весь инвентарь →
            </a>
          </div>
          <div className="panel-body" style={{ padding: 8 }}>
            <CharacterStand
              items={items}
              onUnequip={(id) => unequipMut.mutate(id)}
              inBattle={char.status === 'IN_BATTLE'}
            />
            {items.filter(i => i.isEquipped).length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 11, marginTop: 8 }}>
                Ничего не надето. <a href="#" onClick={e => { e.preventDefault(); navigate('/shop') }}>Магазин →</a>
              </div>
            )}
            <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 6, borderTop: '1px solid var(--border)', paddingTop: 4 }}>
              ○ = слот кольца (Этап 2) &nbsp;□ = карман для расходников (Этап 2)
            </div>
          </div>
        </div>
      </div>

      {/* ══ ПРАВАЯ ЧАСТЬ: бой ═══════════════════════════════════ */}
      <div className="profile-right">

        {/* PvE бой */}
        <div className="panel panel-red" style={{ marginBottom: 8 }}>
          <div className="panel-header">
            <span className="panel-title">
              <Swords size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              Начать бой (PvE)
            </span>
          </div>
          <div className="panel-body">
            {battleError && <div className="alert alert-error mb8">{battleError}</div>}
            {char.status === 'IN_BATTLE' && (
              <div className="alert alert-warning mb8">
                <Swords size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                Ты уже в бою!{' '}
                <a href="#" onClick={e => { e.preventDefault(); const id = localStorage.getItem('mmo_current_battle'); if (id) navigate(`/battle/${id}`) }}>
                  Вернуться →
                </a>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
              {BOTS.map(bot => (
                <div
                  key={bot.code}
                  onClick={() => setSelectedBot(bot.code)}
                  className={`bot-card ${selectedBot === bot.code ? 'selected' : ''}`}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 'bold', color: 'var(--text-bright)' }}>{bot.label}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                        Ур. {bot.level} · <DangerBadge level={bot.danger} />
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="money" style={{ fontSize: 11 }}>{bot.reward}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>награда</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Карманы — выбор расходников */}
            {(() => {
              const avail = items.filter(i => i.template.type === 'CONSUMABLE' && i.status !== 'DELETED' && i.status !== 'CONSUMED')
              return (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 9, color: 'var(--gold-dim)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Pill size={9} /> Карманы (взять в бой, макс. 4)
                  </div>
                  {/* 4 слота */}
                  <div className="loadout-slots">
                    {[0, 1, 2, 3].map(i => {
                      const id   = loadoutIds[i]
                      const item = id ? avail.find(x => x.id === id) : null
                      return (
                        <div
                          key={i}
                          className={`loadout-slot ${item ? 'filled' : 'empty'}`}
                          onClick={() => item && toggleLoadout(item.id)}
                          title={item ? 'Нажми чтобы убрать' : 'Пусто'}
                        >
                          <span className="loadout-slot-num">{i + 1}</span>
                          {item ? (
                            <>
                              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.template.name}</span>
                              <X size={9} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                            </>
                          ) : (
                            <span>— пусто —</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {/* Список расходников */}
                  {avail.length > 0 && (
                    <div className="consumable-list">
                      {avail.map(c => {
                        const inL = loadoutIds.includes(c.id)
                        const full = loadoutIds.length >= 4 && !inL
                        return (
                          <div
                            key={c.id}
                            className={`consumable-pick-row ${inL ? 'in-loadout' : ''} ${full ? 'full-loadout' : ''}`}
                            onClick={() => !full && toggleLoadout(c.id)}
                          >
                            <Pill size={10} style={{ color: inL ? 'var(--success)' : 'var(--text-dim)', flexShrink: 0 }} />
                            <span style={{ flex: 1 }}>{c.template.name}</span>
                            <span style={{ color: 'var(--success)', fontFamily: 'var(--font-mono)' }}>+{c.template.hpBonus} HP</span>
                            {inL && <span style={{ color: 'var(--success)', fontSize: 9 }}>✓</span>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {avail.length === 0 && (
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', fontStyle: 'italic' }}>
                      Нет расходников. Купи в магазине.
                    </div>
                  )}
                </div>
              )
            })()}

            <button
              className="btn btn-danger btn-block btn-lg"
              onClick={() => battleMut.mutate()}
              disabled={battleMut.isPending || char.status === 'IN_BATTLE'}
            >
              {battleMut.isPending
                ? <><span className="spinner" />Начинаем...</>
                : <><Swords size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />В БОЙ!</>}
            </button>
          </div>
        </div>

        {/* PvP */}
        <div className="panel" style={{ borderColor: 'var(--gold-dim)', marginBottom: 8 }}>
          <div className="panel-header">
            <span className="panel-title">
              <Swords size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              PvP Дуэль
            </span>
          </div>
          <div className="panel-body">
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>
              Победа в PvP = ×2 опыта. Проигрыш = 20% опыта всё равно.
            </div>
            <button
              className="btn btn-gold btn-block"
              onClick={() => navigate('/pvp')}
              disabled={char.status === 'IN_BATTLE'}
            >
              <Swords size={13} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              Дуэльный зал
            </button>
          </div>
        </div>

        {/* Подсказка — карманы */}
        <div className="panel" style={{ borderColor: 'var(--border-light)' }}>
          <div className="panel-header">
            <span className="panel-title" style={{ fontSize: 10 }}>
              <Lightbulb size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              Карманы (скоро)
            </span>
          </div>
          <div className="panel-body" style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.6 }}>
            Надень <strong style={{ color: 'var(--text-bright)' }}>куртку</strong> и <strong style={{ color: 'var(--text-bright)' }}>джинсы</strong> — получишь 4 кармана.
            В них можно будет положить расходники для использования прямо в бою.
            <br /><br />
            Максимум 4 предмета в бою — никакого безлимитного хила за донат.
          </div>
        </div>
      </div>
    </div>
  )
}
