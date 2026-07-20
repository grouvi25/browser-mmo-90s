import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../providers/auth-provider'
import { charactersApi } from '../../shared/api/characters.api'
import { authApi } from '../../shared/api/auth.api'
import { STATUS_LABELS } from '../../shared/types/api.types'

// ── Карта города 90-х ─────────────────────────────────────────
const CITY_ZONES = [
  { id: 'market',   label: '🏪 Рынок',    href: '/shop',    desc: 'Госмагазин, торговля' },
  { id: 'arena',    label: '⚔️ Арена',    href: '/pvp',     desc: 'Дуэли, PvP', hot: true },
  { id: 'workshop', label: '🔧 Мастерск.', href: '/repair',  desc: 'Ремонт, улучшения' },
  { id: 'factory',  label: '🏭 Промзона',  href: '#',        desc: 'Заводы (Этап 2)', locked: true },
  { id: 'bar',      label: '🍺 Бар',       href: '#',        desc: 'Баффы, еда (Этап 3)', locked: true },
  { id: 'farm',     label: '🌿 Колхоз',    href: '#',        desc: 'Ферма (Этап 3)', locked: true },
]

const STATUS_ICONS: Record<string, string> = {
  ACTIVE: '●', IN_BATTLE: '⚔', WORKING: '⚙', RECOVERING: '⊕', OFFLINE: '○',
}

export function GameLayout() {
  const { login, signOut } = useAuth()
  const navigate = useNavigate()

  const { data: char } = useQuery({
    queryKey: ['character', 'me'],
    queryFn:  () => charactersApi.getMe(),
    retry: false,
    refetchInterval: 30_000,
  })

  const handleLogout = async () => {
    try { await authApi.logout() } catch { /* ignore */ }
    signOut()
    navigate('/login')
  }

  const hp     = char?.hpCurrent ?? 0
  const hpMax  = char?.hpMax     ?? 1
  const hpPct  = Math.max(0, Math.min(100, (hp / hpMax) * 100))
  const status = char?.status ?? 'OFFLINE'
  const hpColor = hpPct > 60 ? 'var(--green)' : hpPct > 25 ? 'var(--warning)' : 'var(--red)'

  return (
    <div className="layout-game">
      {/* ═══ TOPBAR ════════════════════════════════════════════ */}
      <div className="layout-topbar">
        <div className="topbar-logo">⚡ БРАТВА 90-Х</div>

        {char ? (
          <div className="topbar-char">
            <div className="topbar-stat">
              <span className="label">Игрок:</span>
              <span className="val gold">{char.nickname}</span>
            </div>
            <div className="topbar-stat">
              <span className="label">Ур.</span>
              <span className="val gold">{char.battleLevel}</span>
            </div>
            <div className="topbar-stat">
              <span className="label">HP</span>
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
            <div className="topbar-stat">
              <span style={{ color: status === 'IN_BATTLE' ? 'var(--danger)' : status === 'ACTIVE' ? 'var(--success)' : 'var(--text-dim)', fontSize: 11 }}>
                {STATUS_ICONS[status]} {STATUS_LABELS[status] ?? status}
              </span>
            </div>
            {char.stats && char.stats.pointsAvailable > 0 && (
              <div className="topbar-stat" style={{ color: 'var(--gold)' }}>
                ✨ +{char.stats.pointsAvailable} очк.
              </div>
            )}
          </div>
        ) : (
          <div className="topbar-char"><div className="topbar-stat"><span className="label">Загрузка...</span></div></div>
        )}

        <div className="topbar-right">
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{login}</span>
          <button className="btn btn-sm" onClick={handleLogout}>Выход</button>
        </div>
      </div>

      <div className="layout-main">
        {/* ═══ ЛЕВЫЙ САЙДБАР ════════════════════════════════════ */}
        <nav className="layout-sidebar">
          <div className="sidebar-section">
            <div className="sidebar-section-title">Персонаж</div>
            <NavLink className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')} to="/profile">
              👤 Профиль
            </NavLink>
            <NavLink className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')} to="/inventory">
              🛡️ Снаряжение
            </NavLink>
            <NavLink className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')} to="/stats">
              📊 Характеристики
              {(char?.stats?.pointsAvailable ?? 0) > 0 && (
                <span style={{ color: 'var(--gold)', marginLeft: 4 }}>●</span>
              )}
            </NavLink>
            <NavLink className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')} to="/skills">
              🗡️ Навыки
            </NavLink>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-section-title">Город</div>
            <NavLink className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')} to="/shop">
              🏪 Магазин
            </NavLink>
            <NavLink className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')} to="/repair">
              🔧 Мастерская
            </NavLink>
            <span className="sidebar-link" style={{ opacity: 0.35, cursor: 'not-allowed', fontSize: 11 }}>
              🏭 Заводы
            </span>
            <span className="sidebar-link" style={{ opacity: 0.35, cursor: 'not-allowed', fontSize: 11 }}>
              🍺 Бар
            </span>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-section-title">Бой</div>
            {char?.status === 'IN_BATTLE' ? (
              <NavLink
                className={({ isActive }) => 'sidebar-link active-battle' + (isActive ? ' active' : '')}
                to={'/battle/' + (localStorage.getItem('mmo_current_battle') ?? 'none')}
              >
                ⚔️ Текущий бой
              </NavLink>
            ) : (
              <NavLink className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')} to="/profile">
                ⚔️ В бой (PvE)
              </NavLink>
            )}
            <NavLink className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')} to="/pvp">
              🥊 PvP дуэль
            </NavLink>
          </div>

          <div className="sidebar-section" style={{ marginTop: 'auto' }}>
            <div className="sidebar-section-title" style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 8 }}>
              Рейтинги (Этап 2+)
            </div>
            <span className="sidebar-link" style={{ opacity: 0.3, cursor: 'not-allowed' }}>🏆 Рейтинг</span>
            <span className="sidebar-link" style={{ opacity: 0.3, cursor: 'not-allowed' }}>👥 Кланы</span>
            <span className="sidebar-link" style={{ opacity: 0.3, cursor: 'not-allowed' }}>🗺️ Территории</span>
          </div>
        </nav>

        {/* ═══ КОНТЕНТ ══════════════════════════════════════════ */}
        <main className="layout-content">
          <Outlet />
        </main>

        {/* ═══ ПРАВАЯ КОЛОНКА — КАРТА ГОРОДА ═══════════════════ */}
        <aside className="layout-rightbar">
          {/* Карта города */}
          <div className="city-map-panel">
            <div className="city-map-title">🗺️ Карта города</div>
            <div className="city-map-grid">
              {CITY_ZONES.map(zone => (
                <a
                  key={zone.id}
                  href={zone.locked ? undefined : zone.href}
                  className={`city-zone ${zone.locked ? 'locked' : ''} ${zone.hot ? 'hot' : ''}`}
                  title={zone.desc}
                  onClick={zone.locked ? (e) => e.preventDefault() : undefined}
                >
                  <span className="zone-label">{zone.label}</span>
                  {zone.locked && <span className="zone-lock">🔒</span>}
                </a>
              ))}
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-dim)', padding: '4px 6px', borderTop: '1px solid var(--border)' }}>
              🔒 — Откроется в Этапе 2–3
            </div>
          </div>

          {/* Онлайн-статистика */}
          <div className="panel mt8" style={{ fontSize: 10 }}>
            <div className="panel-header" style={{ padding: '4px 8px' }}>
              <span className="panel-title" style={{ fontSize: 10 }}>📡 Сервер</span>
            </div>
            <div className="panel-body" style={{ padding: '6px 8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--text-dim)' }}>Статус:</span>
                <span style={{ color: 'var(--success)' }}>● Онлайн</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-dim)' }}>game.grouvi.online</span>
              </div>
            </div>
          </div>

          {/* Быстрые действия */}
          {char && (
            <div className="panel mt8">
              <div className="panel-header" style={{ padding: '4px 8px' }}>
                <span className="panel-title" style={{ fontSize: 10 }}>⚡ Быстро</span>
              </div>
              <div className="panel-body" style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <NavLink to="/profile" className="btn btn-sm btn-danger" style={{ textAlign: 'center', textDecoration: 'none' }}>
                  ⚔️ В бой
                </NavLink>
                <NavLink to="/shop" className="btn btn-sm" style={{ textAlign: 'center', textDecoration: 'none' }}>
                  🏪 Магазин
                </NavLink>
                <NavLink to="/repair" className="btn btn-sm" style={{ textAlign: 'center', textDecoration: 'none' }}>
                  🔧 Починить
                </NavLink>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
