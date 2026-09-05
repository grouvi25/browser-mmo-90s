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
import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { adminApi, REASON_MIN, type Catalog, type CatalogResource } from '../admin-api'
import { Skeleton, Fault, Note } from '../../stage3/stage3-ui'
import { Table, rub } from '../admin-ui'
import { ItemsSection } from './combat-sandbox-section'

type Page = 'all' | 'items' | 'resources' | 'objects' | 'production' | 'farm' | 'trade' | 'professions' | 'bots' | 'premium'

const PAGES: { key: Page; title: string }[] = [
  // «Всё» первым: искать по названию проще, чем помнить, в какой из
  // девяти вкладок лежит нужное. Раздел разросся ровно до размера, при
  // котором вкладки начинают прятать содержимое.
  { key: 'all', title: 'Всё' },
  { key: 'items', title: 'Вещи' },
  { key: 'resources', title: 'Ресурсы и материалы' },
  { key: 'objects', title: 'Объекты' },
  { key: 'production', title: 'Производство' },
  { key: 'farm', title: 'Огород' },
  { key: 'trade', title: 'Госскупка и бар' },
  { key: 'professions', title: 'Профессии' },
  { key: 'bots', title: 'Боты' },
  { key: 'premium', title: 'Премиум' },
]

export function CatalogSection({ role }: { role?: string | null }) {
  const [page, setPage] = useState<Page>('all')
  const catalog = useQuery({ queryKey: ['admin', 'catalog'], queryFn: adminApi.catalog })
  const canEdit = role === 'SUPER_ADMIN'

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
          {page === 'all' && <Everything data={catalog.data} onGo={setPage} />}
          {page === 'resources' && <Resources data={catalog.data} canEdit={canEdit} />}
          {page === 'objects' && <Objects data={catalog.data} canEdit={canEdit} />}
          {page === 'production' && <Production data={catalog.data} />}
          {page === 'farm' && <Farm data={catalog.data} />}
          {page === 'trade' && <Trade data={catalog.data} canEdit={canEdit} />}
          {page === 'professions' && <Professions data={catalog.data} />}
          {page === 'bots' && <Bots data={catalog.data} />}
          {page === 'premium' && <Premium data={catalog.data} />}
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

function Resources({ data, canEdit }: { data: Catalog; canEdit: boolean }) {
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
        рецепт на ресурсе, который негде взять, не запустится никогда.{' '}
        {canEdit
          ? 'Базовая цена правится прямо в строке — на неё опираются госскупка, маржа рецептов и выгода огорода разом.'
          : 'Править может только SUPER_ADMIN.'}
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
        <Table head={['Ресурс', 'Категория', 'Тир', 'Цена', 'На руках', 'Источники', 'Применения', '', '']}>
          {shown.map(row => (
            <ResourceRow key={row.code} row={row} canEdit={canEdit}
              open={openCode === row.code}
              onToggle={() => setOpenCode(openCode === row.code ? null : row.code)} />
          ))}
        </Table>
      </div>
      {shown.length === 0 && <p className="adm-hint">Ничего не нашлось.</p>}
    </>
  )
}

function ResourceRow({ row, open, onToggle, canEdit }: {
  row: CatalogResource; open: boolean; onToggle: () => void; canEdit: boolean
}) {
  const dead = row.sources.length === 0 || row.uses.length === 0

  return (
    <>
      <EditableRow
        entity="resource" code={row.code} title={row.name} canEdit={canEdit} dead={dead}
        fields={RESOURCE_FIELDS}
        values={{
          basePrice: row.basePrice, weight: row.weight,
          isTradable: row.isTradable, isActive: row.isActive,
        }}
        cells={<>
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
        </>}
      />
      {open && (
        <tr>
          <td colSpan={9}>
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

function Trade({ data, canEdit }: { data: Catalog; canEdit: boolean }) {
  return (
    <>
      <p className="s4-lead">
        Госскупка задаёт нижнюю границу цен: пока государство берёт вещь дороже,
        чем предлагают на рынке, рынок стоит. Бар — денежный сток и источник
        боевых бонусов одновременно.{' '}
        {canEdit
          ? 'Цены правятся в строке. У госмагазина пустая цена значит «брать из шаблона предмета» — это отдельное состояние, а не «не трогать».'
          : 'Править может только SUPER_ADMIN.'}
      </p>

      <h5 className="adm-sub">Госмагазин</h5>
      <div className="adm-scroll">
        <Table head={['Вещь', 'Тип', 'Цена', 'Продаётся', '']}>
          {data.shop.map(row => (
            <EditableRow
              key={row.code} entity="shop" code={row.code} title={row.name} canEdit={canEdit}
              dead={!row.isAvailable}
              fields={SHOP_FIELDS}
              values={{ overridePrice: row.isOverridden ? row.price : null, isAvailable: row.isAvailable }}
              cells={<>
                <td>{row.name}<em className="adm-row__hint">{row.code}</em></td>
                <td>{row.type}</td>
                <td className="num">
                  {rub(row.price)} ₽
                  {row.isOverridden && <em className="adm-row__hint">цена переопределена</em>}
                </td>
                <td>{row.isAvailable ? 'да' : <span className="adm-bad">нет</span>}</td>
              </>}
            />
          ))}
        </Table>
      </div>

      <h5 className="adm-sub">Бар</h5>
      <div className="adm-scroll">
        <Table head={['Напиток', 'Из чего', 'Цена', 'Себестоимость', 'HP', 'Градус', 'Точность', 'Урон', 'Бафф', '']}>
          {data.bar.map(row => (
            <EditableRow
              key={row.code} entity="bar" code={row.code} title={row.name} canEdit={canEdit}
              dead={row.price <= row.baseCost}
              fields={BAR_FIELDS}
              values={{
                price: row.price, hpRestore: row.hpRestore,
                accuracyBuff: row.accuracyBuff, damageBuff: row.damageBuff,
                buffMinutes: row.buffMinutes, isActive: row.isActive,
              }}
              cells={<>
                <td>{row.name}{!row.isActive && ' (выключен)'}<em className="adm-row__hint">{row.code}</em></td>
                <td>{row.resourceName}</td>
                <td className="num">{rub(row.price)} ₽</td>
                <td className="num">{rub(row.baseCost)} ₽</td>
                <td className="num">{row.hpRestore || '—'}</td>
                <td className="num">{row.alcoholDegrees || '—'}</td>
                <td className="num">{row.accuracyBuff ? `+${row.accuracyBuff}` : '—'}</td>
                <td className="num">{row.damageBuff ? `+${row.damageBuff}` : '—'}</td>
                <td className="num">{row.buffMinutes ? `${row.buffMinutes} мин` : '—'}</td>
              </>}
            />
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

// ── Всё разом ──────────────────────────────────────────────────

/** Строка сводного поиска: что это, как называется и куда за подробностями. */
interface AnyRow { kind: string; page: Page; name: string; code: string; note: string }

/**
 * Поиск по всему справочнику.
 *
 * Девять вкладок — это девять мест, в которых надо помнить, что лежит.
 * Спрашивают же обычно про конкретную вещь: «где ткань», «что даёт
 * бочка». Здесь ищется всё сразу, а строка говорит, в каком разделе
 * смотреть подробности.
 */
function Everything({ data, onGo }: { data: Catalog; onGo: (page: Page) => void }) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()

  const rows = useMemo<AnyRow[]>(() => [
    ...data.resources.map(row => ({
      kind: 'Ресурс', page: 'resources' as Page, name: row.name, code: row.code,
      note: `${CATEGORY[row.category] ?? row.category}, ${row.basePrice} ₽ · источников ${row.sources.length}, применений ${row.uses.length}`,
    })),
    ...data.recipes.map(row => ({
      kind: 'Рецепт', page: 'production' as Page, name: row.name, code: row.code,
      note: `${row.objectName}: ${row.inputs.map(input => `${input.name} ×${input.amount}`).join(' + ') || 'без сырья'} → ${row.output.name} ×${row.output.amount}`,
    })),
    ...data.objects.map(row => ({
      kind: 'Объект', page: 'objects' as Page, name: row.name, code: row.code,
      note: `смена ${row.shiftDurationMinutes} мин, оклад ${row.baseSalary} ₽, мест ${row.workerSlots}`,
    })),
    ...data.crops.map(row => ({
      kind: 'Культура', page: 'farm' as Page, name: row.name, code: row.code,
      note: `${row.minutes} мин, даёт ${row.resourceName}, выгода ${row.profitPerCycle} ₽`,
    })),
    ...data.farm.buildings.map(row => ({
      kind: 'Постройка', page: 'farm' as Page, name: row.name, code: row.code,
      note: `${row.price} ₽ · ${BUILDING_EFFECT[row.code] ?? ''}`,
    })),
    ...data.shop.map(row => ({
      kind: 'Госмагазин', page: 'trade' as Page, name: row.name, code: row.code,
      note: `${row.price} ₽${row.isAvailable ? '' : ' · не продаётся'}`,
    })),
    ...data.bar.map(row => ({
      kind: 'Бар', page: 'trade' as Page, name: row.name, code: row.code,
      note: `${row.price} ₽, из «${row.resourceName}»`,
    })),
    ...data.professions.map(row => ({
      kind: 'Профессия', page: 'professions' as Page, name: row.name, code: row.code,
      note: `${CHAIN_TITLE[row.chain] ?? row.chain}, передел ${row.step}${row.requires ? `, после «${row.requires}»` : ''}`,
    })),
    ...data.bots.map(row => ({
      kind: 'Бот', page: 'bots' as Page, name: row.name, code: row.code,
      note: `уровень ${row.battleLevel}, награда ${row.moneyRewardMin}–${row.moneyRewardMax} ₽`,
    })),
    ...data.premium.map(row => ({
      kind: 'Премиум', page: 'premium' as Page, name: row.name, code: row.code,
      note: `${row.priceRub} ₽ · ${row.description}`,
    })),
  ], [data])

  const shown = needle
    ? rows.filter(row => `${row.name} ${row.code} ${row.kind} ${row.note}`.toLowerCase().includes(needle))
    : rows

  return (
    <>
      <p className="s4-lead">
        Всё, из чего состоит игра: {rows.length} записей. Вещи правятся на своей
        вкладке, остальное пока только для чтения.
      </p>

      <label className="adm-find">
        <Search size={13} />
        <input value={query} onChange={event => setQuery(event.target.value)}
          placeholder="Что угодно: «ткань», «бочка», «пиво», «химик»"
          aria-label="Поиск по справочнику" />
      </label>

      <div className="adm-scroll">
        <Table head={['Что это', 'Название', 'Код', 'Кратко', '']}>
          {shown.slice(0, 200).map((row, index) => (
            <tr key={`${row.kind}-${row.code}-${index}`}>
              <td>{row.kind}</td>
              <td>{row.name}</td>
              <td><code>{row.code}</code></td>
              <td>{row.note}</td>
              <td>
                <button type="button" className="adm-link" onClick={() => onGo(row.page)}>подробнее</button>
              </td>
            </tr>
          ))}
        </Table>
      </div>
      {shown.length === 0 && <p className="adm-hint">Ничего не нашлось. Попробуйте часть слова.</p>}
      {shown.length > 200 && <p className="adm-hint">Показаны первые 200 из {shown.length} — уточните запрос.</p>}
    </>
  )
}

// ── Объекты ────────────────────────────────────────────────────

function Objects({ data, canEdit }: { data: Catalog; canEdit: boolean }) {
  const idle = data.objects.filter(row => !row.isActive || row.status !== 'ACTIVE')

  return (
    <>
      <p className="s4-lead">
        {data.objects.length} объектов — это рабочие места игроков и точки входа в
        производство. Оклад и длительность смены отсюда попадают прямо в денежную
        массу, а профессия решает, кого на объект вообще пустят.{' '}
        {canEdit
          ? 'Оклад, смена и число мест правятся в строке — это самый прямой кран денег в игре, поэтому и потолок здесь ниже, чем у прочих цен.'
          : 'Править может только SUPER_ADMIN.'}
      </p>

      {idle.length > 0 && (
        <p className="adm-verdict adm-verdict--bad">
          Не работают: {idle.map(row => row.name).join(', ')}.
        </p>
      )}

      <div className="adm-scroll">
        <Table head={['Объект', 'Тип', 'Смена', 'Оклад', 'Мест', 'Профессия', 'Выдаёт', 'Склад', 'Состояние', '']}>
          {data.objects.map(row => (
            <EditableRow
              key={row.code} entity="object" code={row.code} title={row.name} canEdit={canEdit}
              dead={!row.isActive || row.status !== 'ACTIVE'}
              fields={OBJECT_FIELDS}
              values={{
                baseSalary: row.baseSalary,
                shiftDurationMinutes: row.shiftDurationMinutes,
                workerSlots: row.workerSlots,
                outputAmountMin: row.outputAmountMin,
                outputAmountMax: row.outputAmountMax,
                storageCapacity: row.storageCapacity,
                isActive: row.isActive,
              }}
              cells={<>
                <td>{row.name}<em className="adm-row__hint">{row.code}</em></td>
                <td>{row.type}</td>
                <td className="num">{row.shiftDurationMinutes} мин</td>
                <td className="num">{rub(row.baseSalary)} ₽</td>
                <td className="num">{row.workerSlots}</td>
                <td>{row.requiredProfessionCode}{row.requiredProfessionLevel > 0 ? ` ур.${row.requiredProfessionLevel}` : ''}</td>
                <td>
                  {row.producesResourceCode
                    ? <>{row.producesResourceCode}<em className="adm-row__hint">{row.outputAmountMin}–{row.outputAmountMax} шт.</em></>
                    : <span className="adm-hint">по рецепту</span>}
                </td>
                <td className="num">{row.storageCapacity || '—'}</td>
                <td>{row.status === 'ACTIVE' && row.isActive ? 'работает' : <span className="adm-bad">{row.status}</span>}</td>
              </>}
            />
          ))}
        </Table>
      </div>
    </>
  )
}

// ── Профессии ──────────────────────────────────────────────────

const CHAIN_TITLE: Record<string, string> = {
  metal: 'Металл', construction: 'Стройка', chemistry: 'Химия',
}

function Professions({ data }: { data: Catalog }) {
  const orphans = data.professions.filter(row => row.objects.length === 0)

  return (
    <>
      <p className="s4-lead">
        Три направления по три передела. Следующий передел открывается уровнем
        предыдущего, а не своим собственным — иначе объект был бы заперт
        требованием, которое сам же и качает.
      </p>

      {orphans.length > 0 && (
        <p className="adm-verdict adm-verdict--bad">
          Профессии без единого объекта: {orphans.map(row => row.name).join(', ')} —
          качать их негде.
        </p>
      )}

      <div className="adm-scroll">
        <Table head={['Профессия', 'Направление', 'Передел', 'Открывается после', 'Где работать']}>
          {data.professions.map(row => (
            <tr key={row.code} className={row.objects.length === 0 ? 'adm-dead' : undefined}>
              <td>{row.name}<em className="adm-row__hint">{row.code}</em></td>
              <td>{CHAIN_TITLE[row.chain] ?? row.chain}</td>
              <td className="num">{row.step}</td>
              <td>{row.requires ?? <span className="adm-hint">с начала игры</span>}</td>
              <td>{row.objects.length === 0 ? <span className="adm-bad">негде</span> : row.objects.join(', ')}</td>
            </tr>
          ))}
        </Table>
      </div>

      <h5 className="adm-sub">Уровни и опыт</h5>
      <p className="adm-hint">
        Каждый уровень добавляет 3% к выработке — за шесть уровней это +18%.
      </p>
      <div className="adm-scroll">
        <Table head={['Уровень', 'Нужно опыта', 'Выработка']}>
          {data.professionLevels.map(row => (
            <tr key={row.level}>
              <td className="num">{row.level}</td>
              <td className="num">{rub(row.exp)}</td>
              <td className="num">×{row.efficiency.toFixed(2)}</td>
            </tr>
          ))}
        </Table>
      </div>
    </>
  )
}

// ── Премиум ────────────────────────────────────────────────────

function Premium({ data }: { data: Catalog }) {
  if (data.premium.length === 0) {
    return <p className="adm-hint">Премиум-товаров в базе нет.</p>
  }
  return (
    <>
      <p className="s4-lead">
        Премиум продаётся за рубли и выдаётся администратором вручную. Каждая
        позиция — обещание игроку, и её надо уметь объяснить: что именно даёт и
        не ломает ли это баланс остальным.
      </p>
      <div className="adm-scroll">
        <Table head={['Товар', 'Что это', 'Цена', 'Что выдаёт', 'Активен']}>
          {data.premium.map(row => (
            <tr key={row.code} className={row.isActive ? undefined : 'adm-dead'}>
              <td>{row.name}<em className="adm-row__hint">{row.code}</em></td>
              <td>{row.description}<em className="adm-row__hint">{row.kind}</em></td>
              <td className="num">{rub(row.priceRub)} ₽</td>
              <td>{row.grantCode}{row.grantValue ? ` ×${row.grantValue}` : ''}</td>
              <td>{row.isActive ? 'да' : <span className="adm-bad">нет</span>}</td>
            </tr>
          ))}
        </Table>
      </div>
    </>
  )
}

// ── Что можно править ──────────────────────────────────────────
//
// Списки короткие намеренно. Править из панели стоит то, что двигает
// экономику; всё остальное — код рецепта, тип объекта, категория
// ресурса — это устройство игры, и менять его на живой базе через
// текстовое поле опаснее, чем выкатить.

const RESOURCE_FIELDS: EditField[] = [
  { key: 'basePrice', label: 'Базовая цена', note: 'госскупка, маржа рецептов, выгода огорода' },
  { key: 'weight', label: 'Вес', step: 0.1, note: 'сколько влезет в инвентарь' },
  { key: 'isTradable', label: 'На рынке', kind: 'bool', note: 'можно ли выставить лотом' },
  { key: 'isActive', label: 'В игре', kind: 'bool' },
]

const OBJECT_FIELDS: EditField[] = [
  { key: 'baseSalary', label: 'Оклад за смену', note: 'главный законный кран денег' },
  { key: 'shiftDurationMinutes', label: 'Смена, мин', note: 'вместе с суточным лимитом задаёт число смен' },
  { key: 'workerSlots', label: 'Рабочих мест' },
  { key: 'outputAmountMin', label: 'Выход от' },
  { key: 'outputAmountMax', label: 'Выход до' },
  { key: 'storageCapacity', label: 'Склад' },
  { key: 'isActive', label: 'Работает', kind: 'bool' },
]

const SHOP_FIELDS: EditField[] = [
  { key: 'overridePrice', label: 'Цена', note: 'пусто — брать из шаблона предмета' },
  { key: 'isAvailable', label: 'Продаётся', kind: 'bool' },
]

const BAR_FIELDS: EditField[] = [
  { key: 'price', label: 'Цена порции', note: 'денежный сток' },
  { key: 'hpRestore', label: 'Лечит HP' },
  { key: 'accuracyBuff', label: 'Точность', step: 0.01 },
  { key: 'damageBuff', label: 'Урон', step: 0.01 },
  { key: 'buffMinutes', label: 'Бафф, мин' },
  { key: 'isActive', label: 'Продаётся', kind: 'bool' },
]

// ── Правка строки справочника ──────────────────────────────────

/** Поле, которое можно поправить. Подпись нужна человеку, шаг — числу. */
export interface EditField {
  key: string
  label: string
  step?: number
  kind?: 'number' | 'bool'
  /** Что это число делает. Без подписи цена — просто цифра в таблице. */
  note?: string
}

/**
 * Строка таблицы, которую можно развернуть в форму правки.
 *
 * Цена ресурса, цена в баре, оклад объекта — те же коэффициенты
 * экономики, что и в разделе «Баланс», только хранятся в базе. Правило
 * то же: с причиной, в журнал и с обратной операцией.
 *
 * Читаемая часть строки приходит готовой (`cells`) — таблицы у разделов
 * разные, и сводить их к одной форме значило бы обеднить каждую.
 */
function EditableRow({
  entity, code, title, fields, values, canEdit, cells, dead,
}: {
  entity: 'resource' | 'shop' | 'bar' | 'object'
  code: string
  title: string
  fields: EditField[]
  values: Record<string, number | boolean | null>
  canEdit: boolean
  cells: ReactNode
  dead?: boolean
}) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  const save = useMutation({
    mutationFn: () => {
      // Отправляем только изменённое: обратная операция пишется по этим
      // же полям, и лишние затёрли бы чужую правку соседнего поля.
      const changed: Record<string, unknown> = {}
      for (const field of fields) {
        const raw = draft[field.key]
        if (raw === undefined) continue
        const next = field.kind === 'bool' ? raw === 'true' : Number(raw)
        if (next !== values[field.key]) changed[field.key] = next
      }
      return adminApi.patchCatalog(entity, code, changed, reason.trim())
    },
    onSuccess: () => {
      setEditing(false); setReason(''); setError(''); setDraft({})
      void qc.invalidateQueries({ queryKey: ['admin', 'catalog'] })
    },
    onError: (err: Error) => setError(err.message),
  })

  const columns = 12

  if (editing) {
    return (
      <tr className="adm-item is-editing">
        <td colSpan={columns}>
          <div className="adm-item__edit">
            <b>{title}</b> <code>{code}</code>
            <div className="adm-item__fields">
              {fields.map(field => (
                <label key={field.key}>
                  <span>{field.label}</span>
                  {field.kind === 'bool' ? (
                    <select
                      defaultValue={String(values[field.key] ?? false)}
                      onChange={event => setDraft({ ...draft, [field.key]: event.target.value })}>
                      <option value="true">да</option>
                      <option value="false">нет</option>
                    </select>
                  ) : (
                    <input
                      type="number" step={field.step ?? 1}
                      defaultValue={values[field.key] === null ? '' : String(values[field.key])}
                      onChange={event => setDraft({ ...draft, [field.key]: event.target.value })}
                    />
                  )}
                  {field.note && <em className="adm-row__hint">{field.note}</em>}
                </label>
              ))}
            </div>
            <div className="adm-item__save">
              <input
                value={reason}
                onChange={event => setReason(event.target.value)}
                placeholder={`Причина, от ${REASON_MIN} символов`}
                aria-label="Причина правки"
              />
              <button type="button" disabled={save.isPending || reason.trim().length < REASON_MIN}
                onClick={() => save.mutate()}>Сохранить</button>
              <button type="button" className="adm-link"
                onClick={() => { setEditing(false); setError('') }}>отмена</button>
            </div>
            {error && <Note text={error} kind="bad" />}
            <p className="adm-hint">
              Правка применяется к игре сразу и отменяется из журнала.
            </p>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr className={dead ? 'adm-dead' : undefined}>
      {cells}
      <td>
        {canEdit
          ? <button type="button" className="adm-link" onClick={() => setEditing(true)}>править</button>
          : null}
      </td>
    </tr>
  )
}
