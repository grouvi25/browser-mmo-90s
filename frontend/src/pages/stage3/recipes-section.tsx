import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { productionApi, type CatalogProduct } from '../../shared/api/production.api'
import { Skeleton, Fault, Empty } from './stage3-ui'

const QUALITY: Record<string, string> = { POOR: 'плохое', NORMAL: 'обычное', FINE: 'отличное' }

const SHOWN = 12

/** Минуты труда по-человечески: 90 мин, 3 ч 20 мин. */
function labor(minutes: number) {
  const whole = Math.round(minutes)
  if (whole < 60) return `${whole} мин`
  const rest = whole % 60
  return `${Math.floor(whole / 60)} ч${rest ? ` ${rest} мин` : ''}`
}

/** Карточка товара: где получается, что нужно и куда идёт дальше. */
function ProductCard({ product, linkOf }: { product: CatalogProduct; linkOf: (code: string) => string }) {
  return (
    <article className="s3-howto" aria-label={`Как получить: ${product.name}`}>
      <h3>{product.name}</h3>
      {product.inShop && <p className="s3-howto__note">Продаётся в <Link to="/shop">Госмагазине</Link>.</p>}
      {product.ways.map(way => (
        <div key={way.objectCode} className="s3-howto__way">
          <p className="s3-howto__place">
            <b>{way.gather ? 'Добывается' : 'Делается'}:</b> {way.objectName}
            {/* №104: надпись «работает после покупки» сбивала: госцех работает и некупленным. */}
            {way.craftMinutes != null && <span className="s3-howto__price"> · госцех, можно делать сразу</span>}
            {way.ownedOnly && !way.gather && <span className="s3-howto__price"> · только на своём заводе</span>}
          </p>
          <dl>
            {way.professionName && <div><dt>Профессия</dt><dd>{way.professionName}{way.professionKnown
              ? <span className="ok"> · есть</span>
              : <> · <Link to="/school">в Училище</Link></>}</dd></div>}
            {way.toolName && <div><dt>Инструмент</dt><dd>{way.toolCode ? <Link to={linkOf(way.toolCode)}>{way.toolName}</Link> : way.toolName}</dd></div>}
            {way.craftMinutes != null
              ? <div><dt>Время на 1 шт.</dt><dd>{way.craftMinutes} мин</dd></div>
              : <div><dt>Труд на 1 шт.</dt><dd>{labor(way.labor)}{!way.gather && way.shiftMinutes > 0 && <span className="muted"> · {Math.ceil(way.labor / way.shiftMinutes)} см. по {way.shiftMinutes} мин</span>}</dd></div>}
          </dl>
          {way.inputs.length > 0 && (
            <div className="s3-howto__inputs">
              <b>Нужно:</b>
              <ul>{way.inputs.map(input => <li key={input.code}>{input.amount} × <Link to={linkOf(input.code)}>{input.name}</Link></li>)}</ul>
            </div>
          )}
        </div>
      ))}
      {product.usedIn.length > 0 && (
        <p className="s3-howto__used"><b>Идёт на:</b> {product.usedIn.map((next, index) => <span key={next.code}>{index > 0 && ', '}<Link to={linkOf(next.code)}>{next.name}</Link></span>)}</p>
      )}
    </article>
  )
}

/** «Как сделать»: выбираем товар и идём по цепочке вглубь. */
function HowTo() {
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const chosen = params.get('product')
  const catalog = useQuery({ queryKey: ['production', 'catalog'], queryFn: productionApi.catalog, staleTime: 60_000 })
  const items = useMemo(() => catalog.data?.items ?? [], [catalog.data])
  const needle = search.trim().toLocaleLowerCase('ru')
  const found = useMemo(() => (needle ? items.filter(item => item.name.toLocaleLowerCase('ru').includes(needle)) : []), [items, needle])
  const product = items.find(item => item.code === chosen)
  const linkOf = (code: string) => `/recipes?product=${encodeURIComponent(code)}`

  if (catalog.isLoading) return <Skeleton rows={2} />
  if (catalog.isError) return <Fault retry={() => catalog.refetch()} />

  return (
    <section className="s3-howto-wrap" aria-label="Как сделать">
      <h2 className="s3-howto__title">Как сделать</h2>
      <label className="s3-howto__search">
        Что нужно получить?
        <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Например, куртка, аптечка, заготовка" />
      </label>
      {needle && (found.length === 0
        ? <p className="s3-hint">Такого в игре нет, попробуйте другое слово.</p>
        : <ul className="s3-howto__found">
          {found.slice(0, SHOWN).map(item => (
            <li key={item.code}>
              <button type="button" className="btn btn-sm" onClick={() => { setSearch(''); setParams({ product: item.code }) }}>{item.name}</button>
            </li>
          ))}
          {found.length > SHOWN && <li className="muted">и ещё {found.length - SHOWN}, уточните запрос</li>}
        </ul>)}
      {product && <ProductCard product={product} linkOf={linkOf} />}
      {chosen && !product && <p className="s3-hint">Этот товар сейчас не производится.</p>}
    </section>
  )
}

/** Справочник переделов: что из чего делается и на каком объекте. */
export function RecipesSection() {
  const [objectCode, setObjectCode] = useState('')

  const objects = useQuery({ queryKey: ['production', 'all'], queryFn: productionApi.all })
  const recipes = useQuery({
    queryKey: ['production', 'recipes', objectCode],
    queryFn: () => productionApi.recipes(objectCode),
    enabled: Boolean(objectCode),
  })

  if (objects.isLoading) return <Skeleton rows={3} />
  if (objects.isError) return <Fault retry={() => objects.refetch()} />

  const items = objects.data?.items ?? []

  return (
    <>
      <HowTo />
      <section className="s3-toolbar">
        <label>
          Рецепты объекта
          <select value={objectCode} onChange={e => setObjectCode(e.target.value)}>
            <option value="">— выберите объект —</option>
            {items.map(object => (
              <option key={object.id} value={object.code ?? ''}>{object.name}</option>
            ))}
          </select>
        </label>
      </section>

      <p className="s3-hint">
        Из плохого сырья отличный продукт не выходит: мастер на плохом сырье вытянет только обычное качество.
        Инструмент выше требуемого тира ускоряет цикл на 15% за уровень.
      </p>

      {!objectCode ? (
        <Empty title="Выберите объект" hint="Покажем его рецепты: вход, выход, время цикла и требуемый труд." />
      ) : recipes.isLoading ? (
        <Skeleton rows={3} />
      ) : recipes.isError ? (
        <Fault retry={() => recipes.refetch()} />
      ) : (recipes.data?.items?.length ?? 0) === 0 ? (
        <Empty title="У объекта нет рецептов" />
      ) : (
        <div className="s3-scroll">
          <table className="s3-table">
            <thead>
              <tr><th>Рецепт</th><th>Вход</th><th>Выход</th><th>Цикл</th><th>Труд</th><th>Профессия</th><th>Доступ</th></tr>
            </thead>
            <tbody>
              {recipes.data?.items?.map(recipe => (
                <tr key={recipe.id} className={recipe.available ? '' : 'is-locked'}>
                  <td><b>{recipe.name}</b></td>
                  <td>
                    {recipe.inputs.length === 0 ? <span className="muted">добыча</span> : recipe.inputs.map(input => (
                      <div key={input.resourceCode}>
                        {input.amount} × {input.resourceName ?? input.resourceCode}
                        {input.minQuality !== 'POOR' && <span className="muted"> (от {QUALITY[input.minQuality]})</span>}
                      </div>
                    ))}
                  </td>
                  <td>{recipe.outputAmount} × {recipe.outputName ?? recipe.outputResourceCode ?? recipe.outputItemTemplateCode}</td>
                  <td>{recipe.cycleMinutes} мин</td>
                  <td>{recipe.laborRequired}</td>
                  <td>{recipe.requiredProfessionName ?? recipe.requiredProfessionCode}, ур. {recipe.requiredProfessionLevel}{recipe.requiredToolName && <div className="muted">инструмент: {recipe.requiredToolName}</div>}</td>
                  <td>{recipe.available ? <span className="ok">открыт</span> : <span className="muted">+{recipe.missingLevel} ур.</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
