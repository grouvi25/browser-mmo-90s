import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../providers/auth-provider'
import { charactersApi } from '../../shared/api/characters.api'
import { authApi } from '../../shared/api/auth.api'
import { STAT_LABELS, STATUS_LABELS } from '../../shared/types/api.types'

const STATUS_ICONS: Record<string, string> = {
  ACTIVE:     '●',
  IN_BATTLE:  '⚔',
  WORKING:    '⚙',
  RECOVERING: '⊕',
  OFFLINE:    '○',
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
  const statusLabel = STATUS_LABELS[status] ?? status
  const statusIcon  = STATUS_ICONS[status]  ?? '●'

  const hpColor = hpPct > 60 ? 'green' : hpPct > 25 ? 'yellow' : 'red'

  return (
    <div className="layout-game">
      {/* ─── Topbar ─────────────────────────────── */}
      <div className="layout-topbar">
        <div className="topbar-logo">
          ⚡ БРАТВА 90-Х
        </div>

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
                  <div className={`hp-mini-fill hp-${hpColor}`}
                    style={{ width: `${hpPct}%`, background: hpColor === 'green' ? 'var(--green)' : hpColor === 'yellow' ? 'var(--warning)' : 'var(--red)' }} />
                </div>
                <span className="val" style={{ color: hpColor === 'green' ? 'var(--success)' : hpColor === 'yellow' ? 'var(--warning)' : 'var(--danger)' }}>
                  {hp}/{hpMax}
                </span>
              </div>
            </div>
            <div className="topbar-stat">
              <span className="label">Деньги:</span>
              <span className="val gold">₽{char.money.toLocaleString('ru')}</span>
            </div>
            <div className="topbar-stat">
              <span style={{ color: status === 'IN_BATTLE' ? 'var(--danger)' : status === 'ACTIVE' ? 'var(--success)' : 'var(--text-dim)' }}>
                {statusIcon} {statusLabel}
              </span>
            </div>
          </div>
        ) : (
          <div className="topbar-char">
            <div className="topbar-stat">
              <span className="label">Загрузка...</span>
            </div>
          </div>
        )}

        <div className="topbar-right">
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{login}</span>
          <button className="btn btn-sm" onClick={handleLogout}>Выход</button>
        </div>
      </div>

      <div className="layout-main">
        {/* ─── Sidebar ──────────────────────────── */}
        <nav className="layout-sidebar">
          <div className="sidebar-section">
            <div className="sidebar-section-title">Персонаж</div>
            <NavLink className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')} to="/profile">
              📋 Профиль
            </NavLink>
            <NavLink className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')} to="/inventory">
              🎒 Инвентарь
            </NavLink>
            <NavLink className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')} to="/skills">
              📊 Навыки
            </NavLink>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-section-title">Действия</div>
            <NavLink className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')} to="/shop">
              🏪 Магазин
            </NavLink>
            <NavLink className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')} to="/repair">
              🔧 Мастерская
            </NavLink>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-section-title">Бой</div>
            {char?.status === 'IN_BATTLE' ? (
              <NavLink className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')}
                to={'/battle/' + (localStorage.getItem('mmo_current_battle') ?? 'none')}>
                ⚔️ Текущий бой
              </NavLink>
            ) : (
              <span className="sidebar-link" style={{ opacity: 0.4, cursor: 'not-allowed' }}>
                ⚔️ Не в бою
              </span>
            )}
            <NavLink className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')} to="/pvp">
              🥊 PvP Дуэль
            </NavLink>
          </div>

          {/* Характеристики в сайдбаре */}
          {char?.stats && (
            <div className="sidebar-stats">
              <div className="sidebar-stats-title">Статы</div>
              {Object.entries(STAT_LABELS).map(([key, label]) => (
                <div key={key} className="sidebar-stat-row">
                  <span className="s-key">{label}</span>
                  <span className="s-val">
                    {(char.stats as unknown as Record<string, number>)[key]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </nav>

        {/* ─── Content ────────────────────────── */}
        <main className="layout-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
