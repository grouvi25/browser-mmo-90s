import { useQuery } from '@tanstack/react-query'
import { api } from '../../shared/api/client'
import { useState } from 'react'
import { Settings, BarChart2, Users, Swords, Backpack, User } from 'lucide-react'

interface AdminStats {
  users: number
  characters: number
  battles: number
  items: number
}

export function AdminPage() {
  const [tab, setTab] = useState<'stats' | 'users' | 'battles'>('stats')

  const { data: stats, isError } = useQuery<AdminStats>({
    queryKey: ['admin', 'stats'],
    queryFn: () => api.get('/api/admin/stats'),
    retry: false,
  })

  // Если статистика не пришла — доступа нет либо админка недоступна
  if (isError) {
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
          <span className="panel-title">
            <Settings size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            АДМИНИСТРИРОВАНИЕ
          </span>
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
                {t === 'stats' ? (
                  <><BarChart2 size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Статистика</>
                ) : t === 'users' ? (
                  <><Users size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Пользователи</>
                ) : (
                  <><Swords size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Бои</>
                )}
              </button>
            ))}
          </div>

          {tab === 'stats' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {[
                { label: 'Пользователи', val: stats?.users, Icon: User },
                { label: 'Персонажи',    val: stats?.characters, Icon: Swords },
                { label: 'Бои',          val: stats?.battles, Icon: BarChart2 },
                { label: 'Предметы',     val: stats?.items, Icon: Backpack },
              ].map(item => (
                <div key={item.label} className="panel" style={{ margin: 0, textAlign: 'center', padding: '12px 8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4, color: 'var(--text-dim)' }}>
                    <item.Icon size={24} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>{item.label}</div>
                  <div style={{ fontSize: 20, color: 'var(--gold)', fontFamily: 'var(--font-mono)', fontWeight: 'bold' }}>
                    {item.val === undefined ? '—' : item.val.toLocaleString('ru')}
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
