import { useQuery } from '@tanstack/react-query'
import { api } from '../../shared/api/client'
import { charactersApi } from '../../shared/api/characters.api'
import { WEAPON_TYPE_LABELS, type WeaponSkill } from '../../shared/types/api.types'
import { BalanceConfigFE } from '../../shared/constants/balance'

// Порог опыта для каждого уровня навыка (из ТЗ)
const WSK_THRESHOLDS = [
  0, 4, 8, 13, 23, 36, 56, 84, 123, 176, 248,
  344, 471, 637, 852, 1128, 1480, 1926, 2489, 3193, 4070,
  5500, 7140, 9270, 12050, 15600, 20000, 26300, 34200, 45000, 58000,
]

function getExpPct(exp: number, level: number): number {
  const curr = WSK_THRESHOLDS[level - 1] ?? 0
  const next = WSK_THRESHOLDS[level]     ?? exp + 100
  return Math.min(100, ((exp - curr) / Math.max(next - curr, 1)) * 100)
}

function SkillCard({ skill }: { skill: WeaponSkill }) {
  const pct = getExpPct(skill.skillExp, skill.skillLevel)
  const label = WEAPON_TYPE_LABELS[skill.weaponType] ?? skill.weaponType

  return (
    <div className="panel" style={{ marginBottom: 0 }}>
      <div className="panel-body" style={{ padding: '8px 10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 'bold', color: 'var(--text-bright)' }}>{label}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--gold)', fontWeight: 'bold' }}>
            Ур. {skill.skillLevel}
          </span>
        </div>

        <div className="wskill-bar-row" style={{ width: '100%' }}>
          <div className="wskill-bar" style={{ flex: 1 }}>
            <div className="wskill-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="wskill-level">{pct.toFixed(0)}%</span>
        </div>

        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 3, display: 'flex', justifyContent: 'space-between' }}>
          <span>Опыт: <span style={{ fontFamily: 'var(--font-mono)' }}>{skill.skillExp.toFixed(1)}</span></span>
          {skill.antiSkillLevel > 0 && (
            <span style={{ color: 'var(--accent)' }}>Защита: {skill.antiSkillLevel}</span>
          )}
          <span>До ур.{skill.skillLevel + 1}: {((WSK_THRESHOLDS[skill.skillLevel] ?? 0) - skill.skillExp).toFixed(0)} exp</span>
        </div>
      </div>
    </div>
  )
}

export function SkillsPage() {
  const { data: char } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
  })

  const { data: skills = [], isLoading } = useQuery<WeaponSkill[]>({
    queryKey: ['weapon-skills'],
    queryFn: () => api.get<WeaponSkill[]>('/api/characters/me/skills'),
    enabled: !!char,
  })

  if (isLoading) return <div className="loading"><span className="spinner" />Загрузка навыков...</div>

  return (
    <div>
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">📊 Навыки владения оружием</span>
          <span className="panel-subtitle">Опыт начисляется за нанесённый урон в бою</span>
        </div>
        <div className="panel-body">
          <div className="alert alert-info mb8">
            Навык влияет на урон, точность и критические удары.
            После 20 уровня начинается антимастерство — защита от этого типа оружия.
          </div>

          {skills.length === 0 ? (
            <div className="text-dim" style={{ textAlign: 'center', padding: 20 }}>
              Навыков нет. Проведи бои с оружием, чтобы прокачать навыки.
            </div>
          ) : (
            <div className="skills-grid">
              {skills.map(s => (
                <SkillCard key={s.id} skill={s} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">📖 Таблица прогресса навыка</span>
        </div>
        <div className="panel-body">
          <table className="data-table">
            <thead>
              <tr>
                <th>Уровень</th>
                <th className="num">Опыт</th>
                <th>Эффект</th>
              </tr>
            </thead>
            <tbody>
              {[1,5,10,15,20].map(lv => (
                <tr key={lv}>
                  <td style={{ color: 'var(--gold)' }}>{lv}</td>
                  <td className="num text-mono">{WSK_THRESHOLDS[lv - 1]?.toLocaleString('ru') ?? '—'}</td>
                  <td style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                    {lv === 1  && 'Базовый урон 35%'}
                    {lv === 5  && 'Урон 52.5%, +крит'}
                    {lv === 10 && 'Урон 70%, стабильность'}
                    {lv === 15 && 'Урон 87.5%, точность'}
                    {lv === 20 && 'Урон 105%, макс. владение → антимастерство'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
