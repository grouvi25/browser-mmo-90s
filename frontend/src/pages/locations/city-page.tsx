import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cityApi } from '../../shared/api/city.api'
import { clansApi } from '../../shared/api/clans.api'
import { charactersApi } from '../../shared/api/characters.api'
import { ViewportPanel } from '../../shared/ui/viewport-panel'
import { SPRITES } from '../../shared/ui/sprite'
import { itemImage } from '../../shared/assets/shop/shop-images'
import { itemBonusLines } from '../../shared/lib/item-bonuses'
import { ItemIconPicker } from '../inventory/item-setup'
import '../shop/shop.css'
import { dogBonusText } from '../../shared/lib/dog'
import { BrigadeHouses } from './brigade-houses'
import { DogGoods, type DogGoodsKind } from './dog-goods'
import { IncomingInvites } from '../stage3/clan-invites'
import { ClanIconPicker } from '../stage3/clan-icon-upload'
import '../stage3/stage3.css'

type Kind = 'hall' | 'school' | 'prison' | 'houses' | 'tsum' | 'berezka' | 'pets'
const TITLES: Record<Kind, string> = { hall: 'Мэрия', school: 'Училище', prison: 'Тюрьма', houses: 'Дома бригад', tsum: 'ЦУМ', berezka: 'Берёзка', pets: 'Зоомагазин' }
export function CityPage({ kind }: { kind: Kind }) {
  return <ViewportPanel title={TITLES[kind]}>
    {kind === 'hall' ? <CityHall /> : kind === 'school' ? <School /> : kind === 'prison' ? <Prison />
      : kind === 'houses' ? <BrigadeHouses /> : kind === 'pets' ? <Pets /> : <Catalog kind={kind} />}
  </ViewportPanel>
}
function useCityAction<T>(action: (value: T) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: action, onSuccess: () => {
    void qc.invalidateQueries({ queryKey: ['city'] }); void qc.invalidateQueries({ queryKey: ['character'] })
    void qc.invalidateQueries({ queryKey: ['inventory'] }); void qc.invalidateQueries({ queryKey: ['clans'] })
  } })
}
function Message({ error, success }: { error: Error | null; success?: boolean }) {
  return error ? <p role="alert" className="city-notice">{error.message}</p> : success ? <p role="status" className="city-notice">Готово. Данные сохранены.</p> : null
}
function QueryState({ loading, error, retry }: { loading: boolean; error: boolean; retry: () => unknown }) {
  if (loading) return <p role="status">Загрузка…</p>
  return error ? <p role="alert">Не удалось загрузить данные. <button className="btn" onClick={() => retry()}>Повторить</button></p> : null
}
function CityHall() {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState<string | null>(null)
  const me = useQuery({ queryKey: ['character', 'me'], queryFn: charactersApi.getMe })
  // Иконку ставит глава при регистрации (правка 21.10): сразу после создания.
  const action = useCityAction(async () => {
    const clan = await clansApi.create(name.trim())
    if (icon) await clansApi.setIcon(icon)
    return clan
  })
  // Правка заказчика: состоящему в бригаде вторую не регистрируют — сервер
  // отказывал и раньше, но форма висела и обещала регистрацию.
  if (me.data?.clan) return <><p>Вы состоите в бригаде «{me.data.clan.name}». Зарегистрировать вторую нельзя.</p>
    <Link to="/clan-houses">Перейти в Дома бригад →</Link></>
  return <><IncomingInvites /><p>Зарегистрируйте бригаду. Состав, общак и склад находятся в Домах бригад.</p>
    <form className="city-card" onSubmit={event => { event.preventDefault(); action.mutate(undefined) }}>
      <label>Название<input required minLength={3} maxLength={32} value={name} onChange={e => setName(e.target.value)} /></label>
      <div>Иконка бригады (видна в списке игроков онлайн; ставится один раз, потом не поменять)<ClanIconPicker value={icon} onChange={setIcon} /></div>
      <p>Регистрация: 1 000 $, нужен 5-й боевой уровень. Содержание: 500 ₽ в сутки из общака.</p>
      <button className="btn btn-primary" disabled={action.isPending}>Зарегистрировать бригаду</button>
    </form><Message error={action.error} success={action.isSuccess} /><Link to="/clan-houses">Перейти в Дома бригад →</Link></>
}
function School() {
  const q = useQuery({ queryKey: ['city', 'professions'], queryFn: cityApi.professions })
  const action = useCityAction(cityApi.learn)
  // Правка заказчика 28.10: второй уровень профессии — за доллары; с ним
  // ресурсы продаются на рынке за доллары.
  const level2 = useCityAction(cityApi.buyLevel2)
  const usd = q.data?.level2Usd ?? 0
  return <><p>Покупка открывает профессию. Уровень растёт за работу и практику в Промзоне. Второй уровень изученной профессии можно взять сразу за доллары — с ним добытые ресурсы продаются на рынке за доллары.</p>
    <QueryState loading={q.isLoading} error={q.isError} retry={q.refetch} /><Message error={action.error ?? level2.error} success={action.isSuccess || level2.isSuccess} />
    <div className="city-cards">{q.data?.items.map(p => <article className="city-card" key={p.code}><h2>{p.name}</h2>
      <p>{p.owned ? `Изучена · уровень ${p.level}` : `${p.price.toLocaleString('ru')} ₽`}</p>
      <button className="btn" disabled={p.owned || action.isPending} onClick={() => action.mutate(p.code)}>{p.owned ? 'Изучено' : 'Купить профессию'}</button>
      {p.owned && p.level < 2 && usd > 0 && (
        <button className="btn" disabled={level2.isPending}
          onClick={() => { if (window.confirm(`Поднять «${p.name}» до 2-го уровня за ${usd} $?`)) level2.mutate(p.code) }}>
          2-й уровень за {usd} $
        </button>
      )}</article>)}</div>
    <Link to="/work">Работать по профессии →</Link></>
}
/** ЦУМ и Берёзка выглядят как обычный магазин — плитки Госмагазина, —
    только цена в долларах (правка заказчика). */
function Catalog({ kind }: { kind: 'tsum' | 'berezka' }) {
  // В ЦУМе вкладка «Для собак» (правка 28.10): донатная собака и долгий корм.
  const [tab, setTab] = useState<'items' | 'dogs'>('items')
  const q = useQuery({ queryKey: ['city', 'catalog', kind], queryFn: () => cityApi.catalog(kind) })
  const me = useQuery({ queryKey: ['character', 'me'], queryFn: charactersApi.getMe })
  const [bought, setBought] = useState<{ id: string; name: string } | null>(null)
  const action = useCityAction(async (id: string) => {
    const result = await cityApi.buy(kind, id)
    if (kind === 'tsum' && result.item?.id) setBought({ id: result.item.id, name: result.itemName })
    return result
  })
  const dollars = me.data?.dollars ?? 0
  return <div className="gshop">
    <header className="gshop-head">
      <span className="gshop-cash">
        <img className="gshop-frame" src={SPRITES['shop-tab-frame']} alt="" draggable={false} />
        <span>Ваш счёт: <b>{dollars.toLocaleString('ru')} $</b></span>
      </span>
      <Link to="/premium">Пополнить у дилера →</Link>
    </header>
    {kind === 'tsum' && <nav className="gshop-tabs" aria-label="Отделы ЦУМа">
      {([['items', 'Именные вещи'], ['dogs', 'Для собак']] as const).map(([value, label]) => (
        <button key={value} className={tab === value ? 'active' : ''} aria-current={tab === value} onClick={() => setTab(value)}>
          <img className="gshop-frame" src={SPRITES['shop-tab-frame']} alt="" draggable={false} /><span>{label}</span>
        </button>
      ))}
    </nav>}
    {tab === 'dogs' ? <DogGoods currency="USD" /> : <>
    <p className="gshop-note">{kind === 'tsum'
      ? 'Именные вещи: все очки характеристик вы распределяете сами на Складе.'
      : 'Артефакты: характеристики и дополнительный боевой опыт, пока вещь надета и цела.'}</p>
    <QueryState loading={q.isLoading} error={q.isError} retry={q.refetch} /><Message error={action.error} success={action.isSuccess} />
    {bought && <p className="gshop-note" role="status">
      «{bought.name}» на Складе. Поставьте вещи свою картинку: <ItemIconPicker itemId={bought.id} onDone={() => setBought(null)} />{' '}
      <button type="button" className="btn btn-sm" onClick={() => setBought(null)}>Потом</button>
    </p>}
    {q.data && q.data.items.length === 0 && <p className="gshop-empty">Витрина пуста.</p>}
    <section className="gshop-grid">{q.data?.items.map(item => {
      const price = item.priceDollars ?? 0
      const tooPoor = dollars < price
      return <article className="gshop-card" key={item.id}>
        <img src={itemImage(item.code, item.weaponType, item.type)} alt="" width={64} height={64} />
        <div className="gshop-card-body">
          <div className="gshop-card-head"><h3>{item.name}</h3></div>
          <p className="gshop-card-meta">
            <span>Прочность: {item.durabilityMax}</span>
            <span>Цена: {price.toLocaleString('ru')} $</span>
          </p>
          <div className="gshop-card-lower">
            <ul className="gshop-bonuses">
              {item.statBudget ? <li>{item.statBudget} свободных очков</li> : null}
              {item.battleExpBonus ? <li>Боевой опыт: +{Math.round(item.battleExpBonus * 100)}%</li> : null}
              {item.dodgeBonus ? <li>Уворот: +{Math.round(item.dodgeBonus * 100)}%</li> : null}
              {itemBonusLines(item).map(line => <li key={line.key}>{line.label}: {line.value}</li>)}
              {item.description && <li>{item.description}</li>}
            </ul>
            <div className="gshop-card-actions">
              <button className="gshop-btn" disabled={action.isPending || tooPoor || !price}
                title={tooPoor ? 'Не хватает долларов' : undefined} onClick={() => action.mutate(item.id)}>
                <img className="gshop-frame" src={SPRITES['shop-btn-frame']} alt="" draggable={false} />
                <span>Купить</span>
              </button>
            </div>
          </div>
        </div>
      </article>
    })}</section>
    <Link to="/inventory">На Склад: надеть и распределить характеристики →</Link>
    </>}
  </div>
}

const STAT_NAMES: Record<string, string> = { str: 'Сила', agi: 'Ловкость', rea: 'Реакция', acc: 'Меткость', end: 'Выносливость', luck: 'Фарт' }

/** Зоомагазин (правки заказчика): собаки с уровнями, своими очками и
    снаряжением (намордник, защита, ошейник, обувь); донатная собака —
    очков на 50% больше, распределяет игрок. Корм — сроком. */
function Pets() {
  const [zooTab, setZooTab] = useState<DogGoodsKind>('dogs')
  const q = useQuery({ queryKey: ['city', 'pets'], queryFn: cityApi.pets, refetchInterval: 60_000 })
  const action = useCityAction(async (value: { kind: 'buy' | 'exchange' | 'food' | 'feed' | 'gear' | 'alloc'; id: string; pack?: string; stat?: string; delta?: 1 | -1 }) =>
    value.kind === 'buy' ? cityApi.buyPet(value.id) : value.kind === 'exchange' ? cityApi.exchangePet(value.id)
      : value.kind === 'food' ? cityApi.food(value.id, value.pack!) : value.kind === 'gear' ? cityApi.dogGear(value.id, value.pack!)
      : value.kind === 'alloc' ? cityApi.allocateDog(value.id, value.stat!, value.delta!) : cityApi.feed(value.id))
  const catalog = q.data?.catalog ?? []
  const dog = q.data?.dog ?? null
  const petRow = q.data?.owned.find(p => p.id === dog?.id)
  // Кот и пёс прошлого выката: бесплатная замена на собаку любой породы.
  const legacy = dog ? [] : (q.data?.owned ?? []).filter(p => p.code === 'cat' || p.code === 'dog')
  const progress = dog && dog.nextLevelExp ? Math.round(((dog.exp - dog.levelExp) / (dog.nextLevelExp - dog.levelExp)) * 100) : 100
  return <><p>Собака даёт бонус к характеристикам в бою, пока сыта, и растёт вместе с вами: ей идёт половина вашего боевого опыта.</p>
    <QueryState loading={q.isLoading} error={q.isError} retry={q.refetch} /><Message error={action.error} success={action.isSuccess} />
    {legacy.length > 0 && <article className="city-card city-card--dog">
      <h2>Обмен питомца</h2>
      <p>Котов и псов в Зоомагазине больше нет. {legacy.map(p => p.name).join(' и ')} бесплатно меняется на собаку — выберите породу. Сытость и корм перейдут к ней.</p>
      <div className="city-feed">{catalog.filter(p => !p.priceDollars).map(p => <button key={p.code} className="btn btn-primary" disabled={action.isPending}
        onClick={() => action.mutate({ kind: 'exchange', id: p.code })}>Взять: {p.name}</button>)}</div>
    </article>}
    {dog && <article className="city-card city-card--dog">
      <h2>{dog.name} · {dog.level}-й уровень</h2>
      <div className="dog-exp" title={dog.nextLevelExp ? `${dog.exp} из ${dog.nextLevelExp} опыта` : 'Максимальный уровень'}>
        <i style={{ width: `${progress}%` }} /><span>{dog.nextLevelExp ? `опыт ${dog.exp} / ${dog.nextLevelExp}` : 'максимальный уровень'}</span>
      </div>
      <p>{dog.role} · {dogBonusText(dog.fullBonus) || 'бонусов пока нет'} {dog.fed ? '' : '(не действует, пока голодная)'}</p>
      {dog.freeAllocation && <div className="dog-alloc">
        <b>Свободных очков: {dog.freePoints}</b>
        {Object.entries(STAT_NAMES).map(([stat, label]) => <span key={stat} className="dog-alloc__row">
          {label}: {dog.allocation[stat] ?? 0}
          <button className="btn btn-sm" aria-label={`Снять очко: ${label}`} disabled={action.isPending || !(dog.allocation[stat] > 0)}
            onClick={() => action.mutate({ kind: 'alloc', id: dog.id, stat, delta: -1 })}>−</button>
          <button className="btn btn-sm" aria-label={`Добавить очко: ${label}`} disabled={action.isPending || dog.freePoints < 1}
            onClick={() => action.mutate({ kind: 'alloc', id: dog.id, stat, delta: 1 })}>+</button>
        </span>)}
      </div>}
      <h3>Снаряжение</h3>
      <div className="dog-gear">{Object.entries(q.data?.gearSlots ?? {}).map(([slot, label]) => {
        const worn = dog.gear[slot]
        return <div key={slot} className="dog-gear__slot">
          <b>{label}</b>
          <span>{worn ? `${worn.name} (${dogBonusText(worn.bonus)})` : 'пусто'}</span>
        </div>
      })}</div>
      <p><b>{dog.fed ? `Сыта до ${new Date(dog.fedUntil!).toLocaleString('ru')}` : 'Голодная — корм в отделе «Корм»'}</b></p>
      {petRow && petRow.food > 0 && !dog.fed && <div className="city-feed"><button className="btn" disabled={action.isPending} onClick={() => action.mutate({ kind: 'feed', id: dog.id })}>Скормить старую порцию ({petRow.food})</button></div>}
    </article>}
    {/* Витрина как в обычном магазине (правка заказчика 28.10). */}
    <nav className="gshop-tabs" aria-label="Отделы Зоомагазина">
      {ZOO_TABS.map(([value, label]) => (
        <button key={value} className={zooTab === value ? 'active' : ''} aria-current={zooTab === value} onClick={() => setZooTab(value)}>
          <img className="gshop-frame" src={SPRITES['shop-tab-frame']} alt="" draggable={false} /><span>{label}</span>
        </button>
      ))}
    </nav>
    <DogGoods kinds={[zooTab]} /></>
}
const ZOO_TABS: Array<[DogGoodsKind, string]> = [['dogs', 'Собаки'], ['food', 'Корм'], ['gear', 'Снаряжение']]
function Prison() {
  const q = useQuery({ queryKey: ['city', 'prison'], queryFn: cityApi.location, refetchInterval: 10_000 })
  const jailed = !!q.data?.jailedUntil && new Date(q.data.jailedUntil) > new Date()
  return <><QueryState loading={q.isLoading} error={q.isError} retry={q.refetch} />
    {q.data && (jailed ? <div className="city-notice"><h2>Вы заключены под стражу</h2><p>Причина: {q.data.jailReason}</p>
      <p>Освобождение: {new Date(q.data.jailedUntil!).toLocaleString('ru')}</p><p>До освобождения игровые действия и переходы недоступны. Срок истечёт автоматически; администратор может освободить раньше.</p></div>
      : <p>У вас нет действующего наказания. Можно вернуться в Центр.</p>)}</>
}
