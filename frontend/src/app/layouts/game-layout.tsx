import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../providers/auth-provider'
import { charactersApi } from '../../shared/api/characters.api'
import { authApi } from '../../shared/api/auth.api'
import { STAT_LABELS, STATUS_LABELS } from '../../shared/types/api.types'

export function GameLayout() {
  const { login, signOut } = useAuth()
  const navigate = useNavigate()

  const { data: char } = useQuery({
    queryKey: ['character', 'me'],
    queryFn:  () => charactersApi.getMe(),
    retry: false,
  })

  const handleLogout = async () => {
    try { await authApi.logout() } catch { /* ignore */ }
    signOut()
    navigate('/login')
  }

  const hpPct  = char ? Math.round((char.hpCurrent / char.hpMax) * 100) : 0
  const status = char ? (STATUS_LABELS[char.status] ?? char.status) : '...'

  return (
    <div className="layout-game">
      {/* Topbar */}
      <div className="layout-topbar">
        <span className="site-name">вљЎ Р‘Р РђРўР’Рђ 90-РҐ</span>

        {char && (
          <div className="char-info">
            <span className="text-gold">{char.nickname}</span>
            <span className="text-dim">|</span>
            <span>РЈСЂ.<span style={{ color: 'var(--accent)' }}>{char.battleLevel}</span></span>
            <span className="text-dim">|</span>
            <span>
              вќ¤пёЏ <span style={{ color: hpPct < 30 ? 'var(--danger)' : 'var(--text)' }}>
                {char.hpCurrent}/{char.hpMax}
              </span>
            </span>
            <span className="text-dim">|</span>
            <span className="money">{char.money.toLocaleString('ru')}</span>
            <span className="text-dim">|</span>
            <span style={{ color: char.status === 'IN_BATTLE' ? 'var(--danger)' : 'var(--text-dim)' }}>
              {status}
            </span>
          </div>
        )}

        <div className="topbar-nav">
          <span className="text-dim" style={{ fontSize: 11 }}>{login}</span>
          <button className="btn btn-sm" onClick={handleLogout} style={{ marginLeft: 8 }}>
            Р’С‹С…РѕРґ
          </button>
        </div>
      </div>

      <div className="layout-main">
        {/* Sidebar */}
        <nav className="layout-sidebar">
          <div className="sidebar-section">
            <div className="sidebar-section-title">РџРµСЂСЃРѕРЅР°Р¶</div>
            <NavLink className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')} to="/profile">
              рџ“‹ РџСЂРѕС„РёР»СЊ
            </NavLink>
            <NavLink className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')} to="/inventory">
              рџЋ’ РРЅРІРµРЅС‚Р°СЂСЊ
            </NavLink>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-section-title">Р”РµР№СЃС‚РІРёСЏ</div>
            <NavLink className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')} to="/shop">
              рџЏЄ РњР°РіР°Р·РёРЅ
            </NavLink>
            <NavLink className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')} to="/repair">
              рџ”§ РњР°СЃС‚РµСЂСЃРєР°СЏ
            </NavLink>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-section-title">Р‘РѕР№</div>
            <NavLink className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')}
              to={char?.status === 'IN_BATTLE' ? ('/battle/' + (localStorage.getItem('mmo_current_battle') ?? 'none')) : '#'}
              onClick={(e) => {
                if (char?.status !== 'IN_BATTLE') e.preventDefault()
              }}
              style={char?.status !== 'IN_BATTLE' ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
            >
              вљ”пёЏ РўРµРєСѓС‰РёР№ Р±РѕР№
            </NavLink>
          </div>

          {char && (
            <div style={{ padding: '8px 10px', marginTop: 4 }}>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6 }}>РҐРђР РђРљРўР•Р РРЎРўРРљР</div>
              {char.stats && Object.entries(STAT_LABELS).map(([key, label]) => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
                  <span style={{ color: 'var(--text-dim)' }}>{label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-bright)' }}>
                    {(char.stats as unknown as Record<string, number>)[key]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </nav>

        {/* Main content */}
        <main className="layout-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
