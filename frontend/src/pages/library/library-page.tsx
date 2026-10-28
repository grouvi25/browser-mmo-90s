// Библиотека (обещание игрокам 22.10): короткие разделы «что где делать».
// Тексты стартовые — заказчик дополнит; числа сверены с сервером на 23.10.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LOCATION_LEVELS } from '../../shared/lib/location-levels'
import { libraryApi, type LibraryTables } from '../../shared/api/library.api'
import './library.css'

interface Topic { key: string; title: string; body: React.ReactNode | ((t: LibraryTables | undefined) => React.ReactNode) }

const n = (value: number) => value.toLocaleString('ru-RU')
const Loading = () => <p className="library__muted">Загружаем таблицу…</p>

/** Опыт и уровни (просьба заказчика 28.10) — числа с сервера. */
function LevelsTopic({ t }: { t: LibraryTables | undefined }) {
  if (!t) return <Loading />
  return <>
    <p>Боевой опыт даёт бой: чем сильнее соперник и чем больше урона вы нанесли, тем больше опыта. За каждый новый уровень — {t.statPointsPerLevel} очка характеристик и денежная премия.</p>
    <div className="library__scroll"><table className="library__table">
      <thead><tr><th>Уровень</th><th>Опыт</th><th>Премия</th></tr></thead>
      <tbody>{t.battle.map(row => <tr key={row.level}><td>{row.level}</td><td>{n(row.exp)}</td><td>{row.level === 1 ? `старт ${n(row.money)} ₽` : `${n(row.money)} ₽`}</td></tr>)}</tbody>
    </table></div>
    <h3>Экономический уровень</h3>
    <p>Растёт от торговли: опыт — 2% от суммы любой продажи — государству, вещей и сырья, и на рынке. За каждый новый уровень — +1 к силе и денежная премия.</p>
    <div className="library__scroll"><table className="library__table">
      <thead><tr><th>Уровень</th><th>Опыт</th><th>Премия</th><th>Сила</th></tr></thead>
      <tbody>{t.economic.filter(row => row.level > 0).map(row => <tr key={row.level}><td>{row.level}</td><td>{n(row.exp)}</td><td>{n(row.money)} ₽</td><td>+{row.str}</td></tr>)}</tbody>
    </table></div>
  </>
}

/** Профессии и их прокачка (просьба заказчика 28.10). */
function ProfessionsTopic({ t }: { t: LibraryTables | undefined }) {
  if (!t) return <Loading />
  return <>
    <p>Профессия покупается в <Link to="/school">Училище</Link> и качается сменами на объектах <Link to="/work">Промзоны</Link>: за смену — опыт профессии. Каждый уровень профессии прибавляет к выработке. Для смены нужен инструмент из Гос магазина.</p>
    <div className="library__scroll"><table className="library__table">
      <thead><tr><th>Уровень профессии</th><th>Опыт всего</th><th>Выработка</th></tr></thead>
      <tbody>{t.professionLevels.map(row => <tr key={row.level}><td>{row.level}</td><td>{n(row.exp)}</td><td>+{row.efficiencyPct}%</td></tr>)}</tbody>
    </table></div>
    <p>Три направления, в каждом три ступени: следующая профессия открывает объекты, когда предыдущая прокачана до нужного уровня.</p>
    {t.professions.map(chain => <section key={chain.chain} className="library__chain">
      <h3>{chain.chain}</h3>
      {chain.steps.map(step => <div key={step.code} className="library__step">
        <b>{step.name}</b>{step.after && <span className="library__muted"> — после «{step.after}»</span>}
        {step.objects.length > 0 && <div className="library__scroll"><table className="library__table">
          <thead><tr><th>Где работать</th><th>Смена</th><th>Оплата</th><th>Опыт</th><th>Допуск</th></tr></thead>
          <tbody>{step.objects.map(o => <tr key={o.name}><td>{o.name}</td><td>{o.minutes} мин</td><td>{n(o.salary)} ₽</td><td>+{o.exp}</td><td>{o.admission ? `${o.admission.profession}, ур. ${o.admission.level}` : 'сразу'}</td></tr>)}</tbody>
          </table></div>}
      </div>)}
    </section>)}
  </>
}

const lvl = (key: string) => LOCATION_LEVELS[key]?.level ?? 1

const TOPICS: Topic[] = [
  { key: 'start', title: 'С чего начать', body: <>
    <p>Первые уровни проще всего взять на ботах: <Link to="/pvp">Стрелки</Link> → «Бой с ботом». Бой даёт опыт и деньги.</p>
    <p>Перед боем купите оружие и броню в <Link to="/shop">Гос магазине</Link> и наденьте их на <Link to="/inventory">Складе</Link>. Переодеваться можно только на Складе (из дома — тоже через Склад).</p>
    <p>Локации открываются постепенно: Фермы, Промзона и Училище — с {lvl('farm')}-го уровня, Гаражи, Бары и Зоомагазин — с {lvl('garages')}-го, Территории, Дома бригад, Мэрия и Жилой сектор — с {lvl('territories')}-го.</p>
  </> },
  { key: 'stats', title: 'Характеристики', body: <>
    <p>За каждый боевой уровень — очки характеристик (сколько — в разделе «Опыт и уровни»). В <Link to="/stats">Центре подготовки</Link> «+» и «−» только двигают черновик: сверху видно, как меняются HP, перенос веса и инициатива. Очки тратятся по кнопке «Подтвердить».</p>
    <p>Ошиблись — свиток перераспределения вернёт все вложенные очки. Два свитка даются бесплатно, следующие продаются там же за рубли.</p>
    <p>Кроме характеристик на урон влияет навык владения оружием: чем чаще бьёте оружием одного типа, тем выше навык. Подробно — во вкладке «Оружейные навыки».</p>
  </> },
  { key: 'levels', title: 'Опыт и уровни', body: t => <LevelsTopic t={t} /> },
  { key: 'professions', title: 'Профессии', body: t => <ProfessionsTopic t={t} /> },
  { key: 'battle', title: 'Бой', body: <>
    <p>Каждый раунд выбираете, куда бить и что закрывать блоком, или делаете шаг по полю. На ход — минута; кто не успел, тот закрывается блоком сам.</p>
    <p>Зоны: голова, корпус, правая рука, левая рука, ноги. Третье попадание в одну зону выбивает оружие из руки или сбивает броню с этой зоны — цвет зоны на фигуре меняется от зелёного к красному.</p>
    <p>Дуэль идёт в полосе 3×8 клеток. На поле стоят бочки: через них не пройти и не прострелить — за ними можно укрыться от стрелка. Оружие дальнего боя бьёт на столько клеток, сколько указано в его карточке.</p>
    <p>Карманы — до четырёх расходников, их можно использовать прямо в бою. Собака, если сыта, бьёт вашу цель после вашего удара — в боях с ботами и в групповых, но не в дуэлях.</p>
  </> },
  { key: 'gear', title: 'Снаряжение и износ', body: <>
    <p>Вещи изнашиваются в бою — и при победе, и при поражении. Когда прочность падает до 20%, после боя в чат приходит напоминание; чинят в <Link to="/repair">Гаражах</Link>. Сломанная вещь не работает.</p>
    <p>На Складе можно сохранить до трёх комплектов одежды и надевать любой одной кнопкой.</p>
  </> },
  { key: 'money', title: 'Заработок', body: <>
    <p><b>Фермы</b> — купите участок, посадите семена, полейте (до трёх раз, каждый полив ускоряет рост) и соберите урожай. Сроки созревания — во вкладке «Растения». Можно засадить или полить все грядки одной кнопкой.</p>
    <p><b>Промзона</b> — смены по профессии. Профессия покупается в <Link to="/school">Училище</Link>, для работы нужен инструмент из Гос магазина.</p>
    <p><b>Рынок</b> — объявления игроков и частные лавки.</p>
  </> },
  { key: 'dollars', title: 'Доллары и Чёрный рынок', body: <>
    <p>Доллары покупаются у дилера — список дилеров на <Link to="/premium">Чёрном рынке</Link>. За доллары — премиум, помощники, вещи ЦУМа и Берёзки, жильё.</p>
    <p>В <Link to="/premium/exchange">Обменнике</Link> рубли меняются на доллары и обратно; покупка долларов за рубли ограничена суточным потолком.</p>
  </> },
  { key: 'clan', title: 'Бригады', body: <>
    <p>В бригаду принимают с 7-го боевого уровня — сначала стоит освоиться одному. Зарегистрировать свою бригаду можно в Мэрии с 5-го уровня.</p>
    <p>На игроков до 3-го уровня не нападают: налёт на дом новичка объявить нельзя.</p>
  </> },
  { key: 'help', title: 'Помощь', body: <>
    <p>Вопрос или ошибка — в <Link to="/support">Поддержку</Link>: там видно, кто из модераторов в сети, а заявку сразу видят все модераторы.</p>
    <p>При наведении на кнопку локации в Центре всплывает короткая подсказка, что в ней делают.</p>
  </> },
]

export function LibraryPage() {
  const [open, setOpen] = useState(TOPICS[0].key)
  const topic = TOPICS.find(t => t.key === open) ?? TOPICS[0]
  const tables = useQuery({ queryKey: ['library', 'tables'], queryFn: libraryApi.tables, staleTime: 5 * 60_000 })
  return (
    <div className="library">
      <nav className="library__toc" aria-label="Разделы библиотеки">
        {TOPICS.map(t => <button key={t.key} type="button" aria-current={t.key === open ? 'page' : undefined}
          className={t.key === open ? 'is-active' : ''} onClick={() => setOpen(t.key)}>{t.title}</button>)}
      </nav>
      <article className="library__text"><h2>{topic.title}</h2>{typeof topic.body === 'function' ? topic.body(tables.data) : topic.body}</article>
    </div>
  )
}
