import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cityApi } from '../../shared/api/city.api'
import { clansApi } from '../../shared/api/clans.api'
import { charactersApi } from '../../shared/api/characters.api'
import { ViewportPanel } from '../../shared/ui/viewport-panel'
import { BrigadeHouses } from './brigade-houses'
import { IncomingInvites } from '../stage3/clan-invites'
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
  const me = useQuery({ queryKey: ['character', 'me'], queryFn: charactersApi.getMe })
  const action = useCityAction(() => clansApi.create(name.trim()))
  // Правка заказчика: состоящему в бригаде вторую не регистрируют — сервер
  // отказывал и раньше, но форма висела и обещала регистрацию.
  if (me.data?.clan) return <><p>Вы состоите в бригаде «{me.data.clan.name}». Зарегистрировать вторую нельзя.</p>
    <Link to="/clan-houses">Перейти в Дома бригад →</Link></>
  return <><IncomingInvites /><p>Зарегистрируйте бригаду. Состав, общак и склад находятся в Домах бригад.</p>
    <form className="city-card" onSubmit={event => { event.preventDefault(); action.mutate(undefined) }}>
      <label>Название<input required minLength={3} maxLength={32} value={name} onChange={e => setName(e.target.value)} /></label>
      <p>Регистрация: 25 000 ₽, нужен 5-й боевой уровень. Содержание: 500 ₽ в сутки из общака.</p>
      <button className="btn btn-primary" disabled={action.isPending}>Зарегистрировать бригаду</button>
    </form><Message error={action.error} success={action.isSuccess} /><Link to="/clan-houses">Перейти в Дома бригад →</Link></>
}
function School() {
  const q = useQuery({ queryKey: ['city', 'professions'], queryFn: cityApi.professions })
  const action = useCityAction(cityApi.learn)
  return <><p>Покупка открывает профессию. Уровень растёт за работу и практику в Промзоне, а не за повторные покупки.</p>
    <QueryState loading={q.isLoading} error={q.isError} retry={q.refetch} /><Message error={action.error} success={action.isSuccess} />
    <div className="city-cards">{q.data?.items.map(p => <article className="city-card" key={p.code}><h2>{p.name}</h2>
      <p>{p.owned ? `Изучена · уровень ${p.level}` : `${p.price.toLocaleString('ru')} ₽`}</p>
      <button className="btn" disabled={p.owned || action.isPending} onClick={() => action.mutate(p.code)}>{p.owned ? 'Изучено' : 'Купить профессию'}</button></article>)}</div>
    <Link to="/work">Работать по профессии →</Link></>
}
function Catalog({ kind }: { kind: 'tsum' | 'berezka' }) {
  const q = useQuery({ queryKey: ['city', 'catalog', kind], queryFn: () => cityApi.catalog(kind) })
  const action = useCityAction((id: string) => cityApi.buy(kind, id))
  return <><p>{kind === 'tsum' ? 'Именные дорогие вещи: все очки характеристик распределяете сами на Складе.' : 'Артефакты дают характеристики и дополнительный боевой опыт. Бонус опыта работает только для надетой исправной вещи.'}</p>
    <QueryState loading={q.isLoading} error={q.isError} retry={q.refetch} /><Message error={action.error} success={action.isSuccess} />
    {q.data && q.data.items.length === 0 && <p>Каталог пуст. Администратор должен выполнить сид каталога.</p>}
    <div className="city-cards">{q.data?.items.map(item => <article className="city-card" key={item.id}><h2>{item.name}</h2><p>{item.description}</p>
      <p>{item.statBudget ? `${item.statBudget} свободных очков` : `+${Math.round((item.battleExpBonus ?? 0) * 100)}% боевого опыта · +${Math.round((item.dodgeBonus ?? 0) * 100)}% уклонения`}</p>
      <b>{item.priceBase.toLocaleString('ru')} ₽</b><button className="btn btn-primary" disabled={action.isPending} onClick={() => action.mutate(item.id)}>Купить</button></article>)}</div>
    <Link to="/inventory">На Склад: надеть и распределить характеристики →</Link></>
}
function Pets() {
  const q = useQuery({ queryKey: ['city', 'pets'], queryFn: cityApi.pets, refetchInterval: 60_000 })
  const action = useCityAction(async (value: { kind: 'buy' | 'food' | 'feed'; id: string }) => value.kind === 'buy' ? cityApi.buyPet(value.id) : value.kind === 'food' ? cityApi.food(value.id, 1) : cityApi.feed(value.id))
  return <><p>Питомцы и корм. Одна порция кормит питомца на {q.data?.feedingHours ?? 24} часа.</p>
    <QueryState loading={q.isLoading} error={q.isError} retry={q.refetch} /><Message error={action.error} success={action.isSuccess} />
    <div className="city-cards">{q.data?.catalog.map(p => <article className="city-card" key={p.code}><h2>{p.name}</h2><b>{p.price.toLocaleString('ru')} ₽</b>
      <button className="btn" disabled={action.isPending || q.data?.owned.some(o => o.code === p.code)} onClick={() => action.mutate({ kind: 'buy', id: p.code })}>Купить питомца</button></article>)}</div>
    <h2>Мои питомцы</h2>{q.data?.owned.length === 0 && <p>Пока нет питомцев.</p>}
    <div className="city-cards">{q.data?.owned.map(p => { const fed = !!p.fedUntil && new Date(p.fedUntil) > new Date(); return <article className="city-card" key={p.id}><h2>{p.name}</h2>
      <p>Корм: {p.food} · {fed ? `Сыт до ${new Date(p.fedUntil!).toLocaleString('ru')}` : 'Голоден'}</p>
      <button className="btn" disabled={action.isPending || p.food >= 100} onClick={() => action.mutate({ kind: 'food', id: p.id })}>Купить корм · {q.data?.foodPrice} ₽</button>
      <button className="btn" disabled={action.isPending || fed || p.food === 0} onClick={() => action.mutate({ kind: 'feed', id: p.id })}>Покормить</button></article> })}</div></>
}
function Prison() {
  const q = useQuery({ queryKey: ['city', 'prison'], queryFn: cityApi.location, refetchInterval: 10_000 })
  const jailed = !!q.data?.jailedUntil && new Date(q.data.jailedUntil) > new Date()
  return <><QueryState loading={q.isLoading} error={q.isError} retry={q.refetch} />
    {q.data && (jailed ? <div className="city-notice"><h2>Вы заключены под стражу</h2><p>Причина: {q.data.jailReason}</p>
      <p>Освобождение: {new Date(q.data.jailedUntil!).toLocaleString('ru')}</p><p>До освобождения игровые действия и переходы недоступны. Срок истечёт автоматически; администратор может освободить раньше.</p></div>
      : <p>У вас нет действующего наказания. Можно вернуться в Центр.</p>)}</>
}
