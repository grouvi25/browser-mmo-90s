// =============================================================
// Оболочка разделов Этапа 4. Устроена ровно как оболочка Этапа 3:
// общий ViewportPanel города, полоса вкладок внутри своей группы,
// содержимое каждого раздела в своём файле рядом. Своя шапка выбивалась
// бы размером и не давала вернуться в город.
//
// Групп две, и деление — по правилу четвёртого уровня навигации,
// записанному в stage3-page.tsx: раздел, который нельзя назвать без
// родителя, живёт вкладкой; раздел, который называется сам по себе,
// обязан быть комнатой района.
//
//   «Территории» и «Премиум» — комнаты: называются сами по себе.
//   «Налёты», «Войны бригады», «Помощники» — вкладки: без родителя они
//   не называются («налёты» на что? «помощники» к чему?).
//
// Полосу районов это удлиняет на две подписи, а не на пять. На её длине
// уже сгорел вариант с девятью районами, и запас там небольшой.
// =============================================================
import { Link } from 'react-router-dom'
import { ViewportPanel } from '../../shared/ui/viewport-panel'
import { TerritoryMapSection } from './territory-map-section'
import { RaidsSection } from './raids-section'
import { WarsSection } from './wars-section'
import { PremiumShopSection } from './premium-shop-section'
import { HelpersSection } from './helpers-section'
import '../stage3/stage3.css'
import './stage4.css'

export type Stage4Section = 'territories' | 'raids' | 'wars' | 'premium' | 'helpers'

interface SectionMeta { title: string; kicker: string; group: Stage4Section[] }

const WAR_GROUP: Stage4Section[] = ['territories', 'raids', 'wars']
const PREMIUM_GROUP: Stage4Section[] = ['premium', 'helpers']

const SECTIONS: Record<Stage4Section, SectionMeta> = {
  territories: { title: 'Территории', kicker: 'Районы и война', group: WAR_GROUP },
  raids: { title: 'Налёты', kicker: 'Районы и война', group: WAR_GROUP },
  wars: { title: 'Войны бригады', kicker: 'Районы и война', group: WAR_GROUP },
  premium: { title: 'Премиум', kicker: 'Подписка', group: PREMIUM_GROUP },
  helpers: { title: 'Помощники', kicker: 'Подписка', group: PREMIUM_GROUP },
}

const ROUTES: Record<Stage4Section, string> = {
  territories: '/territories',
  raids: '/territories/raids',
  wars: '/territories/wars',
  premium: '/premium',
  helpers: '/premium/helpers',
}

function Body({ section }: { section: Stage4Section }) {
  switch (section) {
    case 'territories': return <TerritoryMapSection />
    case 'raids': return <RaidsSection />
    case 'wars': return <WarsSection />
    case 'premium': return <PremiumShopSection />
    case 'helpers': return <HelpersSection />
  }
}

export function Stage4Page({ section }: { section: Stage4Section }) {
  const meta = SECTIONS[section]

  return (
    <ViewportPanel title={meta.title} subtitle={meta.kicker}>
      <main className="s3 s4">
        <nav className="s3-group" aria-label={'Разделы: ' + meta.kicker}>
          {meta.group.map(key => (
            <Link key={key} className={section === key ? 'active' : ''} to={ROUTES[key]}>
              {SECTIONS[key].title}
            </Link>
          ))}
        </nav>
        <Body section={section} />
      </main>
    </ViewportPanel>
  )
}
