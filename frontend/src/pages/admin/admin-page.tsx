import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../../shared/api/client'
import { ApiError } from '../../shared/api/client'
import { useState } from 'react'

interface AdminStats {
  users: number
  characters: number
  battles: number
  items: number
}

export function AdminPage() {
  const [tab, setTab] = useState<'stats' | 'users' | 'battles'>('stats')

  const { data: stats } = useQuery<AdminStats>({
    queryKey: ['admin', 'stats'],
    queryFn: () => api.get('/api/admin/stats'),
    retry: false,
  })

  // Если нет доступа — показать заглушку
  if (!stats && false) {
    return (
      <div className="alert alert-error">
        Доступ запрещён. Эта страница только для администраторов.
      </div>
    )
  }

  return (
    <div>
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">⚙️ АДМИНИСТРИРОВАНИЕ</span>
          <span className="admin-badge">ADMIN</span>
        </div>
        <div className="panel-body">
          <div className="alert alert-warning mb12">
            Это базовая административная панель Этапа 1. Полная версия — в Этапе 5.
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {(['stats', 'users', 'battles'] as const).map(t => (
              <button
                key={t}
                className={`btn btn-sm${tab === t ? ' btn-gold' : ''}`}
                onClick={() => setTab(t)}
              >
                {t === 'stats' ? '📊 Статистика' : t === 'users' ? '👥 Пользователи' : '⚔️ Бои'}
              </button>
            ))}
          </div>

          {tab === 'stats' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {[
                { label: 'Пользователи', val: '—', icon: '👤' },
                { label: 'Персонажи',    val: '—', icon: '⚔️' },
                { label: 'Бои',          val: '—', icon: '🏟️' },
                { label: 'Предметы',     val: '—', icon: '🎒' },
              ].map(item => (
                <div key={item.label} className="panel" style={{ margin: 0, textAlign: 'center', padding: '12px 8px' }}>
                  <div style={{ fontSize: 24 }}>{item.icon}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>{item.label}</div>
                  <div style={{ fontSize: 20, color: 'var(--gold)', fontFamily: 'var(--font-mono)', fontWeight: 'bold' }}>
                    {item.val}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'users' && (
            <div className="text-dim" style={{ textAlign: 'center', padding: 20 }}>
              Управление пользователями — Этап 5 (полная админка).
            </div>
          )}

          {tab === 'battles' && (
            <div className="text-dim" style={{ textAlign: 'center', padding: 20 }}>
              История боёв — Этап 5 (полная админка).
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
