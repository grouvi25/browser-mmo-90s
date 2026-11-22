// Главная страница для гостя (просьба заказчика 28.10, по его образцу):
// рассказ об игре, вход прямо здесь и свежая сводка новостей. Нужна и для
// заявки на эквайринг — у сайта должна быть понятная витрина и политика.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../shared/api/client'
import type { Announcement, AnnouncementKind } from '../../shared/api/announcements.api'
import { LoginForm } from '../auth/login-form'
import sceneCenter from '../../shared/assets/ui/scene-center.webp'
import sceneIndustrial from '../../shared/assets/ui/scene-industrial.webp'
import sceneGarages from '../../shared/assets/ui/scene-garages.webp'
import sceneBrigade from '../../shared/assets/ui/scene-brigade-houses.webp'
import './landing.css'
import { registrationPath } from '../../shared/lib/referral'
import { DESKTOP_INSTALLER, offerDesktop } from '../../shared/lib/desktop-app'
import { RUSTORE_APP } from '../../shared/lib/rustore'

// Тексты для игроков по правилам Димы: без «ё», без длинных тире, кавычки прямые.
const FEATURES: { title: string; text: string }[] = [
  { title: 'Постой за себя', text: 'Пошаговые бои один на один и стенка на стенку: куда бить, что закрывать, когда подойти. Ножи, биты, стволы, броня и обереги.' },
  { title: 'Найди свой ресурс', text: 'Фермы, огород, пункт металлолома, пилорама. Сырье сдаешь государству, продаешь на рынке или пускаешь в дело.' },
  { title: 'Освой ремесло', text: 'Профессии в Училище: оружейник, металлург, технолог, юрист. Смены в госцехах, свои заводы и производственный уровень.' },
  { title: 'Торгуй', text: 'Рынок между игроками, госскупка, ЦУМ и Березка с редкими вещами. В кошельке виден каждый рубль.' },
  { title: 'Собери своих', text: 'Бригады, общак, дома бригад и районы города. Территорию держат вместе и вместе ее отбивают.' },
  { title: 'Заведи пса', text: 'Собака идет с тобой в бой, ее можно одеть и прокачать. Помощники отработают смену, пока ты занят.' },
]

const GALLERY: [string, string][] = [[sceneIndustrial, 'Промзона'], [sceneGarages, 'Гаражи'], [sceneBrigade, 'Дома бригад']]

const KIND_LABEL: Record<AnnouncementKind, string> = { NEWS: 'новость', PATCH: 'обновление', WORLD: 'в городе' }

function stamp(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

/** Вводный абзац: стартовые деньги берём у сервера, их меняют в админке. */
function StartMoneyLead() {
  const facts = useQuery({
    queryKey: ['landing', 'facts'],
    queryFn: () => api.get<{ startMoney: number }>('/api/site/facts', { noAuth: true }),
    retry: false,
  })
  // Страница входа стоит на этой же главной: кривой ответ не должен её ронять.
  const startMoney = facts.data?.startMoney
  const money = typeof startMoney === 'number' ? `${startMoney.toLocaleString('ru-RU')} рублей` : 'немного денег'
  return <p className="landing__lead">Кооператив это город девяностых, где каждый начинает с нуля: {money} в кармане и пустые руки. Дальше как сам решишь.</p>
}

function Svodka() {
  const [kind, setKind] = useState<AnnouncementKind | 'ALL'>(() => (window.location.hash === '#updates' ? 'PATCH' : 'ALL'))
  // Пункты меню «Новости» и «Обновления» ведут сюда же, но с нужным фильтром.
  useEffect(() => {
    const onHash = () => {
      const hash = window.location.hash
      if (hash !== '#updates' && hash !== '#news') return
      setKind(hash === '#updates' ? 'PATCH' : 'NEWS')
      document.getElementById('news')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
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
          <a href="#updates">Обновления</a>
          <a className="landing__enter" href="#login">Войти</a>
        </nav>
      </header>

      <section className="landing__hero" id="top" style={{ backgroundImage: `url(${sceneCenter})` }}>
        <div className="landing__hero-text">
          <p className="landing__kicker">Россия. Девяностые. Твоя история.</p>
          <h1>Твой район.<br />Твои правила.</h1>
          <p className="landing__sub">Онлайн-игра для браузера, Android и Windows · 18+</p>
          <div className="landing__actions">
            <Link className="landing__btn landing__btn--main" to={registrationPath()}>Начать свой путь</Link>
            <a className="landing__btn" href="#about">Что за игра?</a>
            <a className="landing__btn" href={RUSTORE_APP} target="_blank" rel="noreferrer">Скачать в RuStore</a>
            {offerDesktop && <a className="landing__btn" href={DESKTOP_INSTALLER} download>Скачать для ПК</a>}
          </div>
        </div>
        <div className="landing__login" id="login">
          <h2>Свой на районе?</h2>
          <LoginForm />
          <p className="landing__login-foot">Нет аккаунта? <Link to={registrationPath()}>Зарегистрироваться</Link></p>
          {offerDesktop && <p className="landing__login-foot"><a href={DESKTOP_INSTALLER} download>Скачать игру для ПК</a></p>}
        </div>
      </section>

      <section className="landing__about" id="about" aria-labelledby="about-title">
        <h2 id="about-title">Здесь все решают люди.</h2>
        <StartMoneyLead />
        <div className="landing__features">
          {FEATURES.map(feature => (
            <article key={feature.title} className="landing__feature">
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </article>
          ))}
        </div>
        <div className="landing__gallery">
          {GALLERY.map(([src, label]) => (
            <figure key={label}>
              <img src={src} alt={label} loading="lazy" draggable={false} />
              <figcaption>{label}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <Svodka />

      <section className="landing__cta">
        <p className="landing__kicker">У каждого свой путь</p>
        <h2>Твое место еще не занято.</h2>
        <Link className="landing__btn landing__btn--main" to={registrationPath()}>Вписать свое имя</Link>
      </section>

      <footer className="landing__footer">
        <b>КООПЕРАТИВ. Свои люди. Свое дело.</b>
        <span>Браузерная онлайн-игра про Россию девяностых · 18+</span>
        <nav aria-label="Документы">
          <Link to="/politika">Политика обработки персональных данных</Link>
          <Link to="/soglasie">Согласие на обработку персональных данных</Link>
          <Link to="/soglashenie">Пользовательское соглашение</Link>
          <Link to="/cookies">Cookie и push-уведомления</Link>
        </nav>
        <span className="landing__muted">© ООО «АРТЕФАКТУМ», {new Date().getFullYear()}</span>
      </footer>
    </div>
  )
}
