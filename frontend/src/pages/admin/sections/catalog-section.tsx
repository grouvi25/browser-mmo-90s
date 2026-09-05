// =============================================================
// Справочник игры.
//
// Раздел назывался «Предметы» и показывал 22 шаблона вещей. Всё
// остальное, из чего игра состоит — тридцать ресурсов, тридцать восемь
// рецептов, пять культур на огороде, четырнадцать объектов, госскупка,
// бар и боты, — существовало только в базе.
//
// Главное здесь не списки, а ЦЕПОЧКИ. Про ресурс всегда спрашивают одно:
// откуда он берётся и куда девается. Ресурс, которому некуда деться, —
// мусор в инвентаре; рецепт на ресурсе, который негде взять, — мёртвый
// рецепт. И то и другое видно только из связей, поэтому у каждого
// ресурса они разворачиваются прямо в строке.
// =============================================================
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { adminApi, type Catalog, type CatalogResource } from '../admin-api'
import { Skeleton, Fault } from '../../stage3/stage3-ui'
import { Table, rub } from '../admin-ui'
import { ItemsSection } from './combat-sandbox-section'

type Page = 'items' | 'resources' | 'farm' | 'production' | 'trade' | 'bots'

const PAGES: { key: Page; title: string }[] = [
  { key: 'items', title: 'Вещи' },
  { key: 'resources', title: 'Ресурсы' },
  { key: 'production', title: 'Производство' },
  { key: 'farm', title: 'Огород' },
  { key: 'trade', title: 'Госскупка и бар' },
  { key: 'bots', title: 'Боты' },
]

export function CatalogSection({ role }: { role?: string | null }) {
  const [page, setPage] = useState<Page>('items')
  const catalog = useQuery({ queryKey: ['admin', 'catalog'], queryFn: adminApi.catalog })

  return (
    <>
      <div className="s3-tabs adm-catalog__tabs">
        {PAGES.map(item => (
          <button key={item.key} type="button"
            className={page === item.key ? 'active' : ''}
            onClick={() => setPage(item.key)}>
            {item.title}
          </button>
        ))}
      </div>

      {page === 'items' && <ItemsSection role={role} />}

      {page !== 'items' && catalog.isLoading && <Skeleton rows={5} />}
      {page !== 'items' && catalog.isError && <Fault retry={() => catalog.refetch()} />}
      {page !== 'items' && catalog.data && (
        <>
          {page === 'resources' && <Resources data={catalog.data} />}
          {page === 'production' && <Production data={catalog.data} />}
          {page === 'farm' && <Farm data={catalog.data} />}
          {page === 'trade' && <Trade data={catalog.data} />}
          {page === 'bots' && <Bots data={catalog.data} />}
        </>
      )}
    </>
  )
}

// ── Ресурсы ────────────────────────────────────────────────────

const CATEGORY: Record<string, string> = {
  PRIMARY: 'Сырьё',
  SECONDARY: 'Переработка',
  COMPONENT: 'Компоненты',
  REPAIR_PART: 'Ремонтные части',
}

function Resources({ data }: { data: Catalog }) {
  const [query, setQuery] = useState('')
  const [openCode, setOpenCode] = useState<string | null>(null)
  const needle = query.trim().toLowerCase()

  const shown = useMemo(() => {
    if (!needle) return data.resources
    return data.resources.filter(row =>
      `${row.name} ${row.code} ${CATEGORY[row.category] ?? row.category}`.toLowerCase().includes(needle)
      || row.sources.some(link => link.title.toLowerCase().includes(needle))
      || row.uses.some(link => link.title.toLowerCase().includes(needle)))
  }, [data.resources, needle])

  // Тупики экономики: ресурс, который негде взять или некуда деть. Это
  // не украшение отчёта — это либо забытый рецепт, либо мусор, который
  // копится у игроков в инвентаре.
  const orphans = data.resources.filter(row => row.sources.length === 0 || row.uses.length === 0)

  return (
    <>
      <p className="s4-lead">
        {data.resources.length} ресурсов. У каждого показано, откуда он берётся и
        куда уходит: ресурс без применения копится у игроков мёртвым грузом, а
        рецепт на ресурсе, который негде взять, не запустится никогда.
      </p>

      {orphans.length > 0 && (
        <p className="adm-verdict adm-verdict--bad">
          Тупики в цепочках: {orphans.map(row => row.name).join(', ')} — у них нет
          либо источника, либо применения.
        </p>
      )}

      <label className="adm-find">
        <Search size={13} />
        <input value={query} onChange={event => setQuery(event.target.value)}
          placeholder="Ресурс, категория или название рецепта — например «хмель» или «пиво»"
          aria-label="Поиск по ресурсам" />
      </label>

      <div className="adm-scroll">
        <Table head={['Ресурс', 'Категория', 'Тир', 'Цена', 'На руках', 'Источники', 'Применения', '']}>
          {shown.map(row => (
            <ResourceRow key={row.code} row={row}
              open={openCode === row.code}
              onToggle={() => setOpenCode(openCode === row.code ? null : row.code)} />
          ))}
        </Table>
      </div>
      {shown.length === 0 && <p className="adm-hint">Ничего не нашлось.</p>}
    </>
  )
}

function ResourceRow({ row, open, onToggle }: {
  row: CatalogResource; open: boolean; onToggle: () => void
}) {
  const dead = row.sources.length === 0 || row.uses.length === 0

  return (
    <>
      <tr className={dead ? 'adm-dead' : undefined}>
        <td>{row.name}{!row.isActive && ' (выключен)'}<em className="adm-row__hint">{row.code}</em></td>
        <td>{CATEGORY[row.category] ?? row.category}</td>
        <td className="num">{row.tier}</td>
        <td className="num">{rub(row.basePrice)} ₽</td>
        <td className="num">{rub(row.held)}</td>
        <td className="num">{row.sources.length}</td>
        <td className="num">{row.uses.length}</td>
        <td>
          <button type="button" className="adm-link" onClick={onToggle}>
            {open ? 'свернуть' : 'цепочка'}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8}>
            <div className="adm-chain">
              <div>
                <h5>Откуда берётся</h5>
                {row.sources.length === 0
                  ? <p className="adm-hint adm-bad">Негде взять — всё, что его требует, мертво.</p>
                  : <ul>{row.sources.map((link, index) => (
                      <li key={index}><b>{link.title}</b> <span>{link.detail}</span></li>
                    ))}</ul>}
              </div>
              <div>
                <h5>Куда уходит</h5>
                {row.uses.length === 0
                  ? <p className="adm-hint adm-bad">Некуда деть — копится у игроков мёртвым грузом.</p>
                  : <ul>{row.uses.map((link, index) => (
                      <li key={index}><b>{link.title}</b> <span>{link.detail}</span></li>
                    ))}</ul>}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── Производство ───────────────────────────────────────────────

function Production({ data }: { data: Catalog }) {
  const [objectCode, setObjectCode] = useState<string>('')
  const objects = [...new Set(data.recipes.map(row => row.objectCode))]
  const shown = objectCode ? data.recipes.filter(row => row.objectCode === objectCode) : data.recipes
  const losing = data.recipes.filter(row => row.marginPerCycle !== null && row.marginPerCycle <= 0)

  return (
    <>
      <p className="s4-lead">
        {data.recipes.length} рецептов на {objects.length} объектах. Маржа — выручка
        за цикл минус сырьё: напитки считаются по цене бара, остальное по базовой.
        Зарплата и износ сюда не входят, поэтому ноль и минус означают, что рецепт
        убыточен заведомо, ещё до расходов.
      </p>

      {losing.length > 0 && (
        <p className="adm-verdict adm-verdict--bad">
          Убыточны по сырью: {losing.map(row => row.name).join(', ')}.
        </p>
      )}

      <div className="s3-tabs">
        <button type="button" className={objectCode === '' ? 'active' : ''} onClick={() => setObjectCode('')}>
          Все ({data.recipes.length})
        </button>
        {objects.map(code => {
          const name = data.recipes.find(row => row.objectCode === code)?.objectName ?? code
          return (
            <button key={code} type="button" className={objectCode === code ? 'active' : ''}
              onClick={() => setObjectCode(code)}>
              {name} ({data.recipes.filter(row => row.objectCode === code).length})
            </button>
          )
        })}
      </div>

      <div className="adm-scroll">
        <Table head={['Рецепт', 'Из чего', 'Что выходит', 'Цикл', 'Труд', 'Профессия', 'Инстр.', 'Маржа']}>
          {shown.map(row => (
            <tr key={row.code} className={row.marginPerCycle !== null && row.marginPerCycle <= 0 ? 'adm-dead' : undefined}>
              <td>{row.name}{!row.isActive && ' (выключен)'}<em className="adm-row__hint">{row.objectName}</em></td>
              <td>
                {row.inputs.length === 0
                  ? <span className="adm-hint">без сырья</span>
                  : row.inputs.map(input => `${input.name} ×${input.amount}`).join(' + ')}
              </td>
              <td>
                {row.output.name} ×{row.output.amount}
                {row.priceBasis === 'bar' && <em className="adm-row__hint">по цене бара</em>}
              </td>
              <td className="num">{row.cycleMinutes} мин</td>
              <td className="num">{row.laborRequired}</td>
              <td>{row.professionCode}{row.professionLevel > 0 ? ` ур.${row.professionLevel}` : ''}</td>
              <td className="num">{row.toolTier}</td>
              <td className={row.marginPerCycle !== null && row.marginPerCycle <= 0 ? 'num adm-bad' : 'num'}>
                {row.marginPerCycle === null ? '—' : `${row.marginPerCycle > 0 ? '+' : ''}${rub(row.marginPerCycle)} ₽`}
              </td>
            </tr>
          ))}
        </Table>
      </div>
    </>
  )
}

// ── Огород ─────────────────────────────────────────────────────

function Farm({ data }: { data: Catalog }) {
  return (
    <>
      <p className="s4-lead">
        Огород — единственный источник дохода, доступный игроку без смены и без
        боя. Выгода считается как средний урожай по базовой цене минус семена:
        если она не растёт от культуры к культуре, поднимать уровень незачем.
      </p>

      <div className="adm-scroll">
        <Table head={['Культура', 'Растёт', 'Урожай', 'Даёт', 'Семена', 'Выгода за цикл', 'В час', 'Ур.']}>
          {data.crops.map(crop => (
            <tr key={crop.code} className={crop.profitPerCycle <= 0 ? 'adm-dead' : undefined}>
              <td>{crop.name}<em className="adm-row__hint">{crop.code}</em></td>
              <td className="num">{crop.minutes} мин</td>
              <td className="num">{crop.yieldMin}–{crop.yieldMax}</td>
              <td>{crop.resourceName} <em className="adm-row__hint">по {rub(crop.resourcePrice)} ₽</em></td>
              <td className="num">{rub(crop.seedPrice)} ₽</td>
              <td className={crop.profitPerCycle <= 0 ? 'num adm-bad' : 'num'}>
                {crop.profitPerCycle > 0 ? '+' : ''}{rub(crop.profitPerCycle)} ₽
              </td>
              <td className="num">{crop.profitPerHour > 0 ? '+' : ''}{rub(crop.profitPerHour)} ₽</td>
              <td className="num">{crop.requiredLevel}</td>
            </tr>
          ))}
        </Table>
      </div>

      <h5 className="adm-sub">Грядки и постройки</h5>
      <p className="adm-hint">
        Первая грядка бесплатна — на ней и держится расчёт дохода новичка.
        Дальше цены: {data.farm.plotPrices.slice(1).map(price => rub(price)).join(' · ')} ₽.
      </p>
      <div className="adm-scroll">
        <Table head={['Постройка', 'Цена', 'Что даёт']}>
          {data.farm.buildings.map(building => (
            <tr key={building.code}>
              <td>{building.name}<em className="adm-row__hint">{building.code}</em></td>
              <td className="num">{rub(building.price)} ₽</td>
              <td>{BUILDING_EFFECT[building.code] ?? '—'}</td>
            </tr>
          ))}
        </Table>
      </div>
    </>
  )
}

/** Что постройка делает — иначе в таблице только цена, а решают по эффекту. */
const BUILDING_EFFECT: Record<string, string> = {
  BARREL: 'Один автополив при посадке: −10% времени',
  CANOPY: 'Ещё −10% времени сверх бочки',
  CELLAR: 'Урожай дольше не вянет',
  DOG: 'Защита грядки от чужих',
}

// ── Торговля ───────────────────────────────────────────────────

function Trade({ data }: { data: Catalog }) {
  return (
    <>
      <p className="s4-lead">
        Госскупка задаёт нижнюю границу цен: пока государство берёт вещь дороже,
        чем предлагают на рынке, рынок стоит. Бар — денежный сток и источник
        боевых бонусов одновременно.
      </p>

      <h5 className="adm-sub">Госмагазин</h5>
      <div className="adm-scroll">
        <Table head={['Вещь', 'Тип', 'Цена', 'Продаётся']}>
          {data.shop.map(row => (
            <tr key={row.code}>
              <td>{row.name}<em className="adm-row__hint">{row.code}</em></td>
              <td>{row.type}</td>
              <td className="num">
                {rub(row.price)} ₽
                {row.isOverridden && <em className="adm-row__hint">цена переопределена</em>}
              </td>
              <td>{row.isAvailable ? 'да' : <span className="adm-bad">нет</span>}</td>
            </tr>
          ))}
        </Table>
      </div>

      <h5 className="adm-sub">Бар</h5>
      <div className="adm-scroll">
        <Table head={['Напиток', 'Из чего', 'Цена', 'Себестоимость', 'HP', 'Градус', 'Точность', 'Урон', 'Бафф']}>
          {data.bar.map(row => (
            <tr key={row.code} className={row.price <= row.baseCost ? 'adm-dead' : undefined}>
              <td>{row.name}{!row.isActive && ' (выключен)'}<em className="adm-row__hint">{row.code}</em></td>
              <td>{row.resourceName}</td>
              <td className="num">{rub(row.price)} ₽</td>
              <td className="num">{rub(row.baseCost)} ₽</td>
              <td className="num">{row.hpRestore || '—'}</td>
              <td className="num">{row.alcoholDegrees || '—'}</td>
              <td className="num">{row.accuracyBuff ? `+${row.accuracyBuff}` : '—'}</td>
              <td className="num">{row.damageBuff ? `+${row.damageBuff}` : '—'}</td>
              <td className="num">{row.buffMinutes ? `${row.buffMinutes} мин` : '—'}</td>
            </tr>
          ))}
        </Table>
      </div>
    </>
  )
}

// ── Боты ───────────────────────────────────────────────────────

function Bots({ data }: { data: Catalog }) {
  return (
    <>
      <p className="s4-lead">
        Боты — вход в боевую часть игры: с них начинают и по ним меряют, стоит ли
        драться вообще. Награда деньгами здесь — денежный кран, и она напрямую
        участвует в инфляции.
      </p>
      <div className="adm-scroll">
        <Table head={['Бот', 'Уровень', 'Сила', 'HP', 'Опыт', 'Деньги', 'Активен']}>
          {data.bots.map(bot => (
            <tr key={bot.code}>
              <td>{bot.name}<em className="adm-row__hint">{bot.code}</em></td>
              <td className="num">{bot.battleLevel}</td>
              <td className="num">{bot.power}</td>
              <td className="num">{bot.hpMax}</td>
              <td className="num">{bot.expReward}</td>
              <td className="num">{rub(bot.moneyRewardMin)}–{rub(bot.moneyRewardMax)} ₽</td>
              <td>{bot.isActive ? 'да' : 'нет'}</td>
            </tr>
          ))}
        </Table>
      </div>
    </>
  )
}
