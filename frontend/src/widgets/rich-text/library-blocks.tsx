// Живые части разделов Библиотеки (19.11): таблицы и числа приходят из игры, а
// текст вокруг них Дима правит в админке. В тексте таблица — строка [[название]],
// число — {{название}}. Поменяется баланс — в тексте сразу новое значение.
import type { ReactNode } from 'react'
import type { LibraryTables } from '../../shared/api/library.api'
import { LOCATION_LEVELS } from '../../shared/lib/location-levels'
import { NewcomerLetterPage } from '../welcome/newcomer-letter-page'

const n = (value: number) => value.toLocaleString('ru-RU')
const dec = (value: number) => String(value).replace('.', ',')
const lvl = (key: string) => LOCATION_LEVELS[key]?.level ?? 1

type T = LibraryTables | undefined

/** Таблицы и вставки, которые нельзя написать текстом: данные живые. */
export const LIBRARY_BLOCKS: Record<string, { label: string; render: (t: T) => ReactNode; playerOnly?: boolean }> = {
  // Письмо берёт данные игрока: в предпросмотре админки вместо него название.
  'письмо новичку': { label: 'Письмо Бывалого новичку', playerOnly: true, render: () => <NewcomerLetterPage /> },
  'боевые уровни': {
    label: 'Таблица боевых уровней',
    render: t => t && <div className="library__scroll"><table className="library__table library__table--fit">
      <thead><tr><th>Уровень</th><th>Опыт</th><th>Премия</th></tr></thead>
      <tbody>{t.battle.map(row => <tr key={row.level}><td>{row.level}</td><td>{n(row.exp)}</td><td>{row.level === 1 ? `старт ${n(row.money)} ₽` : `${n(row.money)} ₽`}</td></tr>)}</tbody>
    </table></div>,
  },
  'экономические уровни': {
    label: 'Таблица экономических уровней',
    render: t => t && <div className="library__scroll"><table className="library__table library__table--fit">
      <thead><tr><th>Уровень</th><th>Опыт</th><th>Премия</th><th>Сила</th></tr></thead>
      <tbody>{t.economic.filter(row => row.level > 0).map(row => <tr key={row.level}><td>{row.level}</td><td>{n(row.exp)}</td><td>{n(row.money)} ₽</td><td>+{row.str}</td></tr>)}</tbody>
    </table></div>,
  },
  'производственные уровни': {
    label: 'Таблица производственных уровней',
    render: t => t?.production && <div className="library__scroll"><table className="library__table library__table--fit">
      <thead><tr><th>Уровень</th><th>Опыт</th><th>Премия</th><th>Выносливость</th><th>Смен сверху</th></tr></thead>
      <tbody>{t.production.filter(row => row.level > 0).map(row => <tr key={row.level}><td>{row.level}</td><td>{n(row.exp)}</td><td>{n(row.money)} ₽</td><td>+{row.end}</td><td>{row.shifts ? `+${row.shifts}` : '0'}</td></tr>)}</tbody>
    </table></div>,
  },
  'уровни профессий': {
    label: 'Таблица уровней профессий',
    render: t => t && <div className="library__scroll"><table className="library__table library__table--fit">
      <thead><tr><th>Уровень профессии</th><th>Опыт всего</th><th>Выработка</th></tr></thead>
      <tbody>{t.professionLevels.map(row => <tr key={row.level}><td>{row.level}</td><td>{n(row.exp)}</td><td>+{row.efficiencyPct}%</td></tr>)}</tbody>
    </table></div>,
  },
  'цепочки профессий': {
    label: 'Профессии по направлениям, где работать',
    render: t => t && <>{t.professions.map(chain => <section key={chain.chain} className="library__chain">
      <h3>{chain.chain}</h3>
      {chain.steps.map(step => <div key={step.code} className="library__step">
        <b>{step.name}</b>{step.after && <span className="library__muted"> — после «{step.after}»</span>}
        {step.objects.length > 0 && <div className="library__scroll"><table className="library__table library__table--fit">
          <thead><tr><th>Где работать</th><th>Что даёт</th><th>Смена</th><th>Оплата</th><th>Инструмент</th><th>Опыт</th><th>Допуск</th></tr></thead>
          <tbody>{step.objects.map(o => <tr key={o.name}>
            <td>{o.name}{o.forSaleUsd ? <span className="library__muted"> · госцех</span> : null}</td>
            <td className="library__wrap">{o.gives ?? '—'}</td>
            <td>{o.minutes} мин</td><td>{o.salary > 0 ? `${n(o.salary)} ₽` : 'сырьём'}</td>
            <td>{o.tool ?? '—'}</td><td>+{o.exp}</td>
            <td>{o.admission ? `${o.admission.profession}, ур. ${o.admission.level}` : 'сразу'}</td>
          </tr>)}</tbody>
        </table></div>}
      </div>)}
    </section>)}</>,
  },
  'настойки и свитки': {
    label: 'Таблица настоек, аптечек и свитков',
    render: t => t && <div className="library__scroll"><table className="library__table library__table--fit">
      <thead><tr><th>Вещь</th><th>Что делает</th><th>Где применять</th><th>Где делают</th></tr></thead>
      <tbody>{(t.consumables ?? []).map(row => <tr key={row.name}>
        <td>{row.name}</td><td className="library__wrap">{row.does}</td><td>{row.where}</td><td>{row.madeAt ?? '—'}</td>
      </tr>)}</tbody>
    </table></div>,
  },
}

/** Числа из настроек игры. undefined — данные ещё грузятся или их нет. */
export const LIBRARY_VARS: Record<string, { label: string; value: (t: T) => string | undefined }> = {
  'очки_за_уровень': { label: 'Очков характеристик за уровень', value: t => t && String(t.statPointsPerLevel) },
  'боты_штраф': { label: 'Насколько меньше опыта за повтор бота, %', value: t => t?.botExpPenalty != null ? String(Math.round(t.botExpPenalty * 100)) : undefined },
  'боты_минимум': { label: 'Минимум опыта за бота, %', value: t => t?.botExpMin != null ? String(Math.round(t.botExpMin * 100)) : undefined },
  'перевес_оберега': { label: 'Перевес оберега без рандома, %', value: t => t?.rules && String(t.rules.charmGapPct) },
  'перевес_статов': { label: 'Перевес характеристики без рандома', value: t => t?.rules && String(t.rules.statGap) },
  'крит_по_ловкачу': { label: 'Шанс крита пробить ловкача, %', value: t => t?.rules && String(t.rules.dodgeCritPct ?? 33) },
  'удачный_по_ловкачу': { label: 'Шанс удачного пробить ловкача, %', value: t => t?.rules && String(t.rules.dodgeLuckPct ?? 25) },
  'множитель_крита': { label: 'Во сколько раз сильнее крит', value: t => t?.rules && dec(t.rules.critMult) },
  'антифарт': { label: 'Антифарт за очко, %', value: t => t?.rules && String(t.rules.antiFartPct) },
  'антифарт_потолок': { label: 'Антифарт не больше, %', value: t => t?.rules && String(t.rules.antiFartCapPct) },
  'сила_целиком': { label: 'Сила работает целиком с мастерства, %', value: t => t?.rules && String(t.rules.strengthFullPct) },
  'сила_без_мастерства': { label: 'Сила без мастерства считается как', value: t => t?.rules && `${t.rules.strengthFloor[0]}..${t.rules.strengthFloor[1]}` },
  'броня_за_очко': { label: 'HP защиты за очко брони на вещи', value: t => t?.rules && dec(t.rules.armorPerPoint) },
  'защита_целиком': { label: 'Мастерство защиты, при котором урон 0, %', value: t => t?.rules && String(t.rules.defenseFullPct) },
  'выносливость_броня_hp': { label: 'HP защиты за единицу выносливости', value: t => t?.rules && dec(t.rules.endArmor) },
  'сила_урон_hp': { label: 'HP атаки за единицу силы', value: t => t?.rules && dec(t.rules.damagePerStrength) },
  'разброс': { label: 'Разброс урона, ±%', value: t => t?.rules && String(t.rules.spreadPct ?? 10) },
  'налог_продажи': { label: 'Налог с продажи на рынке, %', value: t => t?.rules && String(t.rules.saleTaxPct) },
  'выставление': { label: 'Выставить лот (бесплатно или стоит сбор)', value: t => t?.rules && (t.rules.listingFree ? 'бесплатно' : 'стоит сбор') },
  'вилка_от': { label: 'Цена сырья: от затрат +%', value: t => t?.rules && String(t.rules.craftMinPct) },
  'вилка_до': { label: 'Цена сырья: до затрат +%', value: t => t?.rules && String(t.rules.craftMaxPct) },
  'цена_цеха': { label: 'Цена цеха, $', value: t => t && n(t.objectPriceUsd ?? 15000) },
  'уровень_ферм': { label: 'С какого уровня Фермы, Промзона, Училище', value: () => String(lvl('farm')) },
  'уровень_гаражей': { label: 'С какого уровня Гаражи, Бары, Зоомагазин', value: () => String(lvl('garages')) },
  'уровень_территорий': { label: 'С какого уровня Территории, Дома бригад, Мэрия', value: () => String(lvl('territories')) },
}
