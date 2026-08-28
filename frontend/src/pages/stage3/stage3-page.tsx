// =============================================================
// Оболочка разделов Этапа 3. Сам экран — только шапка, локальная
// навигация внутри своей группы и плашка приёмки; содержимое
// каждого раздела лежит в своём файле рядом.
// =============================================================
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { stage3AcceptanceApi } from '../../shared/api/stage3-acceptance.api'
import { ViewportPanel } from '../../shared/ui/viewport-panel'
import { FarmSection } from './farm-section'
import { PlantsSection } from './plants-section'
import { ObjectsSection } from './objects-section'
import { RecipesSection } from './recipes-section'
import { BarsSection } from './bars-section'
import { MyBarSection } from './my-bar-section'
import { ClanSection } from './clan-section'
import { ClanStorageSection } from './clan-storage-section'
import { ClanTreasurySection } from './clan-treasury-section'
import { ClanRelationsSection } from './clan-relations-section'
import './stage3.css'

export type Stage3Section =
  | 'farm' | 'plants'
  | 'objects' | 'recipes'
  | 'bars' | 'mybar'
  | 'clan' | 'clan-storage' | 'clan-treasury' | 'clan-relations'

// =============================================================
// Правило четвёртого уровня навигации.
//
// Полоса вкладок внутри страницы — не обход дырки в комнатах, а
// решение мёржа 6872542: «Мой бар», клановый склад, общак и отношения
// оставлены здесь, чтобы не удлинять полосу районов и комнат. Ровно
// на её длине сгорел вариант с девятью районами: подписи сжимались
// до 0.46 натуральной ширины и читались вертикальными полосками.
//
// Чтобы через этап это не забылось, правило записано здесь:
//   раздел, который нельзя назвать без упоминания родителя
//   («склад бригады», «общак бригады»), живёт вкладкой;
//   раздел, который называется сам по себе, обязан быть комнатой
//   в MENU.rooms.
//
// По этому правилу «Мой бар» — пограничный случай: он назван сам по
// себе, но существует только у владельца бара, поэтому остаётся здесь.
// =============================================================
interface SectionMeta { title: string; kicker: string; group: Stage3Section[] }

const FARM_GROUP: Stage3Section[] = ['farm', 'plants']
const PROD_GROUP: Stage3Section[] = ['objects', 'recipes']
const BAR_GROUP: Stage3Section[] = ['bars', 'mybar']
const CLAN_GROUP: Stage3Section[] = ['clan', 'clan-storage', 'clan-treasury', 'clan-relations']

const SECTIONS: Record<Stage3Section, SectionMeta> = {
  farm: { title: 'Ферма', kicker: 'Земля и урожай', group: FARM_GROUP },
  plants: { title: 'Растения', kicker: 'Земля и урожай', group: FARM_GROUP },
  objects: { title: 'Объекты', kicker: 'Собственность', group: PROD_GROUP },
  recipes: { title: 'Рецепты', kicker: 'Собственность', group: PROD_GROUP },
  bars: { title: 'Бары', kicker: 'Еда, напитки и градус', group: BAR_GROUP },
  mybar: { title: 'Мой бар', kicker: 'Еда, напитки и градус', group: BAR_GROUP },
  clan: { title: 'Бригада', kicker: 'Своя команда', group: CLAN_GROUP },
  'clan-storage': { title: 'Клановый склад', kicker: 'Своя команда', group: CLAN_GROUP },
  'clan-treasury': { title: 'Общак', kicker: 'Своя команда', group: CLAN_GROUP },
  'clan-relations': { title: 'Отношения', kicker: 'Своя команда', group: CLAN_GROUP },
}

const ROUTES: Record<Stage3Section, string> = {
  farm: '/farm',
  plants: '/plants',
  objects: '/objects',
  recipes: '/recipes',
  bars: '/bars',
  mybar: '/bars/mine',
  clan: '/clans',
  'clan-storage': '/clans/storage',
  'clan-treasury': '/clans/treasury',
  'clan-relations': '/clans/relations',
}

function Body({ section }: { section: Stage3Section }) {
  switch (section) {
    case 'farm': return <FarmSection />
    case 'plants': return <PlantsSection />
    case 'objects': return <ObjectsSection />
    case 'recipes': return <RecipesSection />
    case 'bars': return <BarsSection />
    case 'mybar': return <MyBarSection />
    case 'clan': return <ClanSection />
    case 'clan-storage': return <ClanStorageSection />
    case 'clan-treasury': return <ClanTreasurySection />
    case 'clan-relations': return <ClanRelationsSection />
  }
}

export function Stage3Page({ section }: { section: Stage3Section }) {
  const meta = SECTIONS[section]
  const acceptance = useQuery({
    queryKey: ['stage3', 'acceptance'],
    queryFn: stage3AcceptanceApi.get,
    refetchInterval: 60000,
  })

  return (
    // Обрамление берём общее для города: заголовок и «в город» на месте,
    // как на остальных экранах. Своя шапка выбивалась размером и не
    // давала вернуться назад.
    <ViewportPanel title={meta.title} subtitle={meta.kicker}>
      <main className="s3">
        {/* Навигация внутри группы остаётся: полоса комнат внизу знает не
            про все разделы — «Мой бар», склад, общак и отношения только тут. */}
        <nav className="s3-group" aria-label={'Разделы: ' + meta.kicker}>
          {meta.group.map(key => (
            <Link key={key} className={section === key ? 'active' : ''} to={ROUTES[key]}>
              {SECTIONS[key].title}
            </Link>
          ))}
        </nav>

        {acceptance.data && !acceptance.data.ready && (
          <section className="acceptance attention">
            <b>Приёмка: ещё не закрыта</b>
            <span>
              {acceptance.data.metrics.recipes} рецептов ·{' '}
              {acceptance.data.metrics.farmCrops} культур ·{' '}
              {acceptance.data.metrics.barOffers} позиций меню ·{' '}
              {acceptance.data.metrics.stuckCycles} зависших циклов
            </span>
          </section>
        )}

        <Body section={section} />
      </main>
    </ViewportPanel>
  )
}
