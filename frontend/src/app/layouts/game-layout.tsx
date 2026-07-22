import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  User, Shield, BarChart2, Sword, Swords, Store, Wrench, Factory,
  Beer, Lock, Zap, Radio, Heart, Star, Map,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../providers/auth-provider'
import { charactersApi } from '../../shared/api/characters.api'
import { authApi } from '../../shared/api/auth.api'
import { STATUS_LABELS } from '../../shared/types/api.types'

// ── Карта города ───────────────────────────────────────────────
const CITY_ZONES = [
  { id: 'market',   label: 'Рынок',     href: '/shop',   Icon: Store,   hot: false, locked: false },
  { id: 'arena',    label: 'Арена',     href: '/pvp',    Icon: Swords,  hot: true,  locked: false },
  { id: 'workshop', label: 'Мастерс.',  href: '/repair', Icon: Wrench,  hot: false, locked: false },
  { id: 'factory',  label: 'Промзона',  href: '#',       Icon: Factory, hot: false, locked: true  },
  { id: 'bar',      label: 'Бар',       href: '#',       Icon: Beer,    hot: false, locked: true  },
]

const STATUS_DOT: Record<string, string> = {
  ACTIVE: 'var(--success)', IN_BATTLE: 'var(--danger)',
  WORKING: 'var(--warning)', RECOVERING: 'var(--gold-dim)', OFFLINE: 'var(--text-dim)',
}

// ── Таббар: одна ссылка ────────────────────────────────────────
function TLink({ to, Icon: I, label }: { to: string; Icon: LucideIcon; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => 'tabbar-link' + (isActive ? ' active' : '')}
    >
      <I size={12} />
      <span>{label}</span>
    </NavLink>
  )
}

// ── Таббар: специальная ссылка «В бой» ────────────────────────
function BattleLink({ inBattle, battleId }: { inBattle: boolean; battleId: string | null }) {
  const to = inBattle && battleId ? `/battle/${battleId}` : '/profile'
  return (
    <NavLink to={to} className={({ isActive }) => 'tabbar-link tabbar-battle' + (isActive ? ' active' : '')}>
      <Swords size={12} />
      <span>{inBattle ? 'Текущий бой' : 'В бой!'}</span>
    </NavLink>
  )
}

export function GameLayout() {
  const { login, signOut } = useAuth()
  const navigate = useNavigate()

  const { data: char } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
    retry: false,
    refetchInterval: 30_000,
  })

  const handleLogout = async () => {
    try { await authApi.logout() } catch { /* ignore */ }
    signOut()
    navigate('/login')
  }

  const hp     = char?.hpCurrent ?? 0
  const hpMax  = char?.hpMax ?? 1
  const hpPct  = Math.max(0, Math.min(100, (hp / hpMax) * 100))
  const status = char?.status ?? 'OFFLINE'
  const hpColor = hpPct > 60 ? 'var(--green)' : hpPct > 25 ? 'var(--warning)' : 'var(--red)'
  const inBattle = status === 'IN_BATTLE'
  const battleId = localStorage.getItem('mmo_current_battle')
  const points   = char?.stats?.pointsAvailable ?? 0

  return (
    <div className="layout-game">

      {/* ═══ TOPBAR ═══════════════════════════════════════════ */}
      <div className="layout-topbar">
        <div className="topbar-logo">
          <Zap size={13} style={{ marginRight: 5, verticalAlign: 'middle' }} />
          КООПЕРАТИВ
        </div>

        {char ? (
          <div className="topbar-char">
            <div className="topbar-stat">
              <span className="label">
                <span style={{
                  display: 'inline-block', width: 7, height: 7,
                  borderRadius: '50%', background: STATUS_DOT[status] ?? 'var(--text-dim)',
                  marginRight: 4, verticalAlign: 'middle',
                }} />
                {char.nickname}
              </span>
            </div>
            <div className="topbar-stat">
              <span className="label">Ур.</span>
              <span className="val gold">{char.battleLevel}</span>
            </div>
            <div className="topbar-stat">
              <Heart size={10} style={{ color: hpColor, marginRight: 2, verticalAlign: 'middle' }} />
              <div className="hp-mini">
                <div className="hp-mini-bar">
                  <div className="hp-mini-fill" style={{ width: `${hpPct}%`, background: hpColor }} />
                </div>
                <span className="val" style={{ color: hpColor }}>{hp}/{hpMax}</span>
              </div>
            </div>
            <div className="topbar-stat">
              <span className="label">₽</span>
              <span className="val gold">{char.money.toLocaleString('ru')}</span>
            </div>
            {points > 0 && (
              <div className="topbar-stat" style={{ color: 'var(--gold)' }}>
                <Star size={10} style={{ marginRight: 3, verticalAlign: 'middle' }} />
                +{points} очк.
              </div>
            )}
            <div className="topbar-stat" style={{ fontSize: 10, color: 'var(--text-dim)' }}>
              {STATUS_LABELS[status] ?? status}
            </div>
          </div>
        ) : (
          <div className="topbar-char">
            <div className="topbar-stat"><span className="label">Загрузка...</span></div>
          </div>
        )}

        <div className="topbar-right">
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{login}</span>
          <button className="btn btn-sm" onClick={handleLogout}>Выход</button>
        </div>
      </div>

      {/* ═══ ТАББАР НАВИГАЦИИ ══════════════════════════════════ */}
      <nav className="layout-tabbar">
        {/* Группа: Персонаж */}
        <div className="tabbar-group">
          <span className="tabbar-group-label">Персонаж</span>
          <TLink to="/profile"   Icon={User}     label="Профиль" />
          <TLink to="/inventory" Icon={Shield}   label="Снаряжение" />
          <TLink to="/stats"     Icon={BarChart2} label={points > 0 ? `Статы +${points}` : 'Статы'} />
          <TLink to="/skills"    Icon={Sword}    label="Навыки" />
        </div>

        <div className="tabbar-sep" />

        {/* Группа: Город */}
        <div className="tabbar-group">
          <span className="tabbar-group-label">Город</span>
          <TLink to="/shop"   Icon={Store}  label="Магазин" />
          <TLink to="/repair" Icon={Wrench} label="Мастерская" />
        </div>

        <div className="tabbar-sep" />

        {/* Группа: Бой */}
        <div className="tabbar-group">
          <span className="tabbar-group-label">Бой</span>
          <BattleLink inBattle={inBattle} battleId={battleId} />
          <TLink to="/pvp" Icon={Swords} label="PvP" />
        </div>

        {/* Рейтинги — заблокированы */}
        <div className="tabbar-sep" />
        <div className="tabbar-group tabbar-locked" title="Откроется в Этапе 2+">
          <span className="tabbar-group-label">Рейтинги</span>
          <span className="tabbar-link disabled">Клан</span>
          <span className="tabbar-link disabled">Топ</span>
        </div>
      </nav>

      {/* ═══ ОСНОВНОЙ КОНТЕНТ ══════════════════════════════════ */}
      <div className="layout-main">
        <main className="layout-content">
          <Outlet />
        </main>

        {/* ═══ ПРАВАЯ ПАНЕЛЬ — только карта ════════════════════ */}
        <aside className="layout-rightbar">
          <div className="city-map-panel">
            <div className="city-map-title">
              <Map size={10} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              Карта города
            </div>
            <div className="city-map-grid">
              {CITY_ZONES.map(zone => (
                <a
                  key={zone.id}
                  href={zone.locked ? undefined : zone.href}
                  className={`city-zone ${zone.locked ? 'locked' : ''} ${zone.hot ? 'hot' : ''}`}
                  title={zone.locked ? 'Откроется в Этапе 2–3' : undefined}
                  onClick={zone.locked ? e => e.preventDefault() : undefined}
                >
                  <zone.Icon size={10} style={{ marginRight: 3, verticalAlign: 'middle' }} />
                  <span className="zone-label">{zone.label}</span>
                  {zone.locked && <Lock size={8} style={{ marginLeft: 2, opacity: 0.5, verticalAlign: 'middle' }} />}
                </a>
              ))}
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-dim)', padding: '3px 6px', borderTop: '1px solid var(--border)', display: 'flex', gap: 3, alignItems: 'center' }}>
              <Lock size={8} /> Откроется в Этапе 2–3
            </div>
          </div>

          {/* Статус сервера */}
          <div className="panel mt8" style={{ fontSize: 10 }}>
            <div className="panel-header" style={{ padding: '3px 8px' }}>
              <span className="panel-title" style={{ fontSize: 9 }}>
                <Radio size={9} style={{ marginRight: 3, verticalAlign: 'middle' }} />
                Сервер
              </span>
              <span style={{ color: 'var(--success)', fontSize: 9 }}>● Онлайн</span>
            </div>
            <div className="panel-body" style={{ padding: '4px 8px', fontSize: 9, color: 'var(--text-dim)' }}>
              game.grouvi.online
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
