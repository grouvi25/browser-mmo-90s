// =============================================================
// Оболочка разделов Этапа 3. Сам экран — только шапка, локальная
// навигация внутри своей группы и плашка приёмки; содержимое
// каждого раздела лежит в своём файле рядом.
// =============================================================
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { stage3AcceptanceApi } from '../../shared/api/stage3-acceptance.api'
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
    <main className="s3">
      <header className="s3-head">
        <div>
          <span className="s3-kicker">{meta.kicker}</span>
          <h1>{meta.title}</h1>
        </div>
        <nav aria-label={'Разделы: ' + meta.kicker}>
          {meta.group.map(key => (
            <Link key={key} className={section === key ? 'active' : ''} to={ROUTES[key]}>
              {SECTIONS[key].title}
            </Link>
          ))}
        </nav>
      </header>

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
  )
}
