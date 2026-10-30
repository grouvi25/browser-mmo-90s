import { useQuery } from '@tanstack/react-query'
import { api } from '../../shared/api/client'
import { charactersApi } from '../../shared/api/characters.api'
import { WEAPON_TYPE_LABELS, type WeaponSkill } from '../../shared/types/api.types'
import { BarChart2, BookOpen } from 'lucide-react'

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

/** Строка навыка: таблицей, как профессии на странице Работы (правка
 *  заказчика 20.10). Плюсиков нет — навык растёт только в бою. */
function SkillRow({ skill }: { skill: WeaponSkill }) {
  const pct = getExpPct(skill.skillExp, skill.skillLevel)
  const label = WEAPON_TYPE_LABELS[skill.weaponType] ?? skill.weaponType
  const toNext = Math.max(0, (WSK_THRESHOLDS[skill.skillLevel] ?? 0) - skill.skillExp)
  return (
    <tr>
      <td><b>{label}</b></td>
      <td className="num">{skill.skillLevel}</td>
      <td>
        <div className="wskill-bar-row">
          <div className="wskill-bar" style={{ flex: 1 }}><div className="wskill-fill" style={{ width: `${pct}%` }} /></div>
          <span className="wskill-level">{pct.toFixed(0)}%</span>
        </div>
      </td>
      <td className="num text-mono">{toNext.toFixed(0)}</td>
      <td className="num">{skill.antiSkillLevel > 0 ? skill.antiSkillLevel : '—'}</td>
    </tr>
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
          <span className="panel-title">
            <BarChart2 size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            Навыки владения оружием
          </span>
          <span className="panel-subtitle">Опыт начисляется за нанесённый урон в бою</span>
        </div>
        <div className="panel-body">
          <div className="alert alert-info mb8">
            Навык усиливает урон оружия этого типа.
            После 20 уровня начинается антимастерство — защита от этого типа оружия.
          </div>

          {skills.length === 0 ? (
            <div className="text-dim" style={{ textAlign: 'center', padding: 20 }}>
              Навыков нет. Проведи бои с оружием, чтобы прокачать навыки.
            </div>
          ) : (
            <table className="data-table">
              <thead><tr><th>Оружие</th><th className="num">Уровень</th><th>Прогресс</th><th className="num">До следующего</th><th className="num">Защита</th></tr></thead>
              <tbody>{skills.map(s => <SkillRow key={s.id} skill={s} />)}</tbody>
            </table>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">
            <BookOpen size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            Таблица прогресса навыка
          </span>
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
                  <td style={{ fontSize: 13.65, color: 'var(--text-dim)' }}>
                    {lv === 1  && 'Базовый урон 100% — новичок наносит полный урон'}
                    {lv === 5  && 'Урон 112.5%'}
                    {lv === 10 && 'Урон 125%'}
                    {lv === 15 && 'Урон 137.5%'}
                    {lv === 20 && 'Урон 150%, максимум → дальше растёт антимастерство'}
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
