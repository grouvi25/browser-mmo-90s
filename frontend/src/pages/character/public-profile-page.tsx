import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { User, Trophy, Sword, MapPin, EyeOff, Copy, Check, ArrowLeft } from 'lucide-react'
import { charactersApi } from '../../shared/api/characters.api'
import { ApiError } from '../../shared/api/client'

const ARCHETYPE_LABEL: Record<string, string> = {
  ATHLETE: 'Спортсмен', WORKER: 'Работяга', SHUTTLE: 'Челнок', VETERAN: 'Бывший срочник',
  STREET: 'Уличный', MERCHANT: 'Коммерсант', STUDENT: 'Студент', RESOLVER: 'Решала',
}

export function PublicProfilePage() {
  const { nickname = '' } = useParams<{ nickname: string }>()
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['public-profile', nickname],
    queryFn: () => charactersApi.getByNickname(nickname),
    enabled: !!nickname,
    retry: false,
  })

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard недоступен */ }
  }

  const notFound = error instanceof ApiError && error.status === 404

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: 16 }}>
      <button className="btn btn-sm" onClick={() => navigate(-1)} style={{ marginBottom: 12 }}>
        <ArrowLeft size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Назад
      </button>

      {isLoading && <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>Загрузка…</div>}

      {notFound && (
        <div className="card" style={{ textAlign: 'center', padding: 24, color: 'var(--text-dim)' }}>
          Игрок «{nickname}» не найден.
        </div>
      )}

      {data?.hidden && (
        <div className="card" style={{ textAlign: 'center', padding: 24 }}>
          <EyeOff size={32} style={{ color: 'var(--text-dim)', marginBottom: 8 }} />
          <div style={{ fontWeight: 'bold', fontSize: 16 }}>{data.nickname}</div>
          <div style={{ color: 'var(--text-dim)', marginTop: 6 }}>Профиль скрыт игроком (режим невидимости).</div>
        </div>
      )}

      {data && !data.hidden && (
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--bg-2, #2a2a2a)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border, #444)' }}>
              <User size={28} style={{ color: 'var(--gold, #d4a017)' }} />
            </div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 'bold' }}>{data.nickname}</div>
              <div style={{ fontSize: 13.25, color: 'var(--text-dim)' }}>
                {ARCHETYPE_LABEL[data.archetype ?? ''] ?? data.archetype} · уровень {data.battleLevel}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Stat icon={<Sword size={14} />} label="Боёв" value={String(data.battlesTotal ?? 0)} />
            <Stat icon={<Trophy size={14} />} label="Побед" value={`${data.battlesWon ?? 0} (${winRate(data)}%)`} />
            {data.location && <Stat icon={<MapPin size={14} />} label="Место" value={data.location} />}
          </div>

          <button className="btn btn-sm btn-primary" onClick={copyLink} style={{ marginTop: 16, width: '100%' }}>
            {copied ? <><Check size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />Скопировано</>
                    : <><Copy size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />Скопировать ссылку</>}
          </button>
        </div>
      )}

      <div style={{ marginTop: 12, textAlign: 'center', fontSize: 13.9, color: 'var(--text-dim)' }}>
        <Link to="/profile" style={{ color: 'var(--accent, #6a9ad0)' }}>Мой профиль</Link>
      </div>
    </div>
  )
}

function winRate(d: { battlesTotal?: number; battlesWon?: number }): number {
  const t = d.battlesTotal ?? 0
  if (t === 0) return 0
  return Math.round(((d.battlesWon ?? 0) / t) * 100)
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ background: 'var(--bg-2, #222)', border: '1px solid var(--border, #333)', borderRadius: 6, padding: '8px 10px' }}>
      <div style={{ fontSize: 13.65, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 4 }}>{icon}{label}</div>
      <div style={{ fontSize: 15, fontWeight: 'bold', marginTop: 2 }}>{value}</div>
    </div>
  )
}
