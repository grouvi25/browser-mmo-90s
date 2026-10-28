// Главная страница для гостя (просьба заказчика 28.10, по его образцу):
// рассказ об игре, вход прямо здесь и свежая сводка новостей. Нужна и для
// заявки на эквайринг — у сайта должна быть понятная витрина и политика.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../shared/api/client'
import type { Announcement, AnnouncementKind } from '../../shared/api/announcements.api'
import { LoginForm } from '../auth/login-form'
import sceneCenter from '../../shared/assets/ui/scene-center.webp'
import './landing.css'

const FEATURES: { title: string; text: string }[] = [
  { title: 'Постой за себя', text: 'Пошаговые бои один на один и стенка на стенку: куда бить, что закрывать, когда подойти. Опыт, уровни, оружие и навыки.' },
  { title: 'Найди свой ресурс', text: 'Фермы, металлолом, колхоз, пилорама. Сырьё сдаёшь государству, продаёшь на рынке или пускаешь в дело.' },
  { title: 'Открой своё дело', text: 'Смены на заводах и в цехах, свои объекты и наёмные рабочие. Из сырья — заготовки, из заготовок — вещи.' },
  { title: 'Собери своих', text: 'Бригады, общак, дома и районы города. Территорию держат вместе — и вместе её отбивают.' },
]

const KIND_LABEL: Record<AnnouncementKind, string> = { NEWS: 'новость', PATCH: 'обновление', WORLD: 'в городе' }

function stamp(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

function Svodka() {
  const [kind, setKind] = useState<AnnouncementKind | 'ALL'>('ALL')
  const [open, setOpen] = useState<string | null>(null)
  const feed = useQuery({
    queryKey: ['landing', 'announcements', kind],
    queryFn: () => api.get<{ items: Announcement[] }>(`/api/announcements/public${kind === 'ALL' ? '' : `?kind=${kind}`}`, { noAuth: true }),
    retry: false,
  })
  const items = feed.data?.items ?? []
  return (
    <section className="landing__news" id="news" aria-labelledby="news-title">
      <div className="landing__news-head">
        <h2 id="news-title">Сводка района</h2>
        <div className="landing__filters" role="tablist" aria-label="Что показать">
          {([['ALL', 'Все'], ['NEWS', 'Новости'], ['PATCH', 'Обновления']] as const).map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={kind === value}
              className={kind === value ? 'is-active' : ''} onClick={() => setKind(value)}>{label}</button>
          ))}
        </div>
      </div>
      {feed.isLoading ? <p className="landing__muted">Загружаем сводку…</p>
        : items.length === 0 ? <p className="landing__muted">Пока тихо. Свежие новости появятся здесь.</p>
          : <div className="landing__cards">
            {items.map(item => (
              <article key={item.id} className="landing__card">
                <span className="landing__tag">{KIND_LABEL[item.kind]} · {stamp(item.createdAt)}</span>
                <h3>{item.title}</h3>
                <p className={open === item.id ? 'landing__body is-open' : 'landing__body'}>{item.body}</p>
                <button type="button" className="landing__link" onClick={() => setOpen(open === item.id ? null : item.id)}>
                  {open === item.id ? 'Свернуть' : 'Читать сводку'}
                </button>
              </article>
            ))}
          </div>}
    </section>
  )
}

export function LandingPage() {
  return (
    <div className="landing">
      <header className="landing__bar">
        <a className="landing__logo" href="#top">КООПЕРАТИВ</a>
        <nav aria-label="Разделы">
          <a href="#about">Об игре</a>
          <a href="#news">Новости</a>
          <a href="#news">Обновления</a>
          <a className="landing__enter" href="#login">Войти</a>
        </nav>
      </header>

      <section className="landing__hero" id="top" style={{ backgroundImage: `url(${sceneCenter})` }}>
        <div className="landing__hero-text">
          <p className="landing__kicker">Россия. Девяностые. Твоя история.</p>
          <h1>Твой район.<br />Твои правила.</h1>
          <p className="landing__sub">Браузерная онлайн-игра · без установки · 18+</p>
          <div className="landing__actions">
            <Link className="landing__btn landing__btn--main" to="/register">Начать свой путь</Link>
            <a className="landing__btn" href="#about">Что за игра?</a>
          </div>
        </div>
        <div className="landing__login" id="login">
          <h2>Свой на районе?</h2>
          <LoginForm />
          <p className="landing__login-foot">Нет аккаунта? <Link to="/register">Зарегистрироваться</Link></p>
        </div>
      </section>

      <section className="landing__about" id="about" aria-labelledby="about-title">
        <h2 id="about-title">Здесь всё решают люди.</h2>
        <p className="landing__lead">Кооператив — город девяностых, где каждый начинает с нуля: с 1 250 рублей в кармане и пустыми руками. Дальше — как сам решишь.</p>
        <div className="landing__features">
          {FEATURES.map(feature => (
            <article key={feature.title} className="landing__feature">
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </article>
          ))}
        </div>
      </section>

      <Svodka />

      <section className="landing__cta">
        <p className="landing__kicker">У каждого свой путь</p>
        <h2>Твоё место ещё не занято.</h2>
        <Link className="landing__btn landing__btn--main" to="/register">Вписать своё имя</Link>
      </section>

      <footer className="landing__footer">
        <b>КООПЕРАТИВ — свои люди. Своё дело.</b>
        <span>Браузерная онлайн-игра про Россию девяностых · 18+</span>
        <nav aria-label="Документы">
          <Link to="/politika">Политика обработки персональных данных</Link>
        </nav>
        <span className="landing__muted">© ООО «АРТЕФАКТУМ», {new Date().getFullYear()}</span>
      </footer>
    </div>
  )
}
