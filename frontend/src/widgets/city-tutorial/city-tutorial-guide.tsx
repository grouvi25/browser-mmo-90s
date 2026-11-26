// Обучение в городе (переделка 25.11 по образцу RomeWar, просьба Димы):
// одна подсказка — одно действие, подсказка стоит у нужной кнопки со
// стрелкой, остальное затемнено. Уроки те же, что и раньше: купить оружие,
// надеть, вложить очки в урон, характеристики; потом письмо Бывалого.
//
// Нужную кнопку страница помечает data-tutorial-focus="<шаг>". Если на
// странице такой нет, игрок не там: подсвечиваем кнопку места на площади
// (data-stage-nav) или «Центр», чтобы вернуться на площадь.
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../app/providers/auth-provider'
import { reachGoal } from '../../shared/lib/attribution'
import { NewcomerLetterModal } from '../welcome/newcomer-letter'
import { MODAL, TourSpotlight } from './tour-spotlight'
import { tutorialKey, updateTutorial, useCityTutorial, type TutorialProgress } from './use-city-tutorial'
import './city-tutorial.css'

type Lesson = NonNullable<TutorialProgress['lesson']>

const scenes = new Set(['/', '/shop', '/inventory', '/stats', '/district/market'])
const LESSONS: Lesson[] = ['buy', 'equip', 'allocate', 'stats']
const TITLES: Record<Lesson, string> = {
  buy: 'Купи оружие',
  equip: 'Надень оружие',
  allocate: 'Вложи очки в урон',
  stats: 'Характеристики',
  unavailable: 'Стартовое оружие',
}
/** Куда идти за уроком: адрес и кнопка места на площади. */
const PLACE: Record<Exclude<Lesson, 'unavailable'>, { path: string; nav: string }> = {
  buy: { path: '/shop', nav: 'shop' },
  equip: { path: '/inventory', nav: 'inventory' },
  allocate: { path: '/inventory', nav: 'inventory' },
  stats: { path: '/stats', nav: 'skills' },
}

interface Step { key: string; el: HTMLElement }

const visible = (el: Element | null): el is HTMLElement => {
  if (!(el instanceof HTMLElement)) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
}

function findStep(lesson: Lesson, pathname: string): Step | null {
  // Открытое окно (настройка вещи) важнее страницы под ним: берём верхнее.
  const modals = document.querySelectorAll(MODAL)
  const scope = modals[modals.length - 1] ?? document
  const focus = [...scope.querySelectorAll('[data-tutorial-focus]')].find(visible)
  if (focus) return { key: (focus as HTMLElement).dataset.tutorialFocus || lesson, el: focus as HTMLElement }
  if (lesson === 'unavailable' || pathname === PLACE[lesson].path) return null
  const nav = document.querySelector(`[data-stage-nav="${PLACE[lesson].nav}"]`)
  if (visible(nav)) return { key: `nav-${PLACE[lesson].nav}`, el: nav }
  const center = document.querySelector('[data-stage-nav="center"]')
  return visible(center) ? { key: 'nav-center', el: center } : null
}

/** Шаг пересчитывается сам: страница перестраивается после каждого действия. */
function useStep(lesson: Lesson | undefined, pathname: string, enabled: boolean): Step | null {
  const [step, setStep] = useState<Step | null>(null)
  useEffect(() => {
    if (!enabled || !lesson) { setStep(null); return }
    const read = () => setStep(prev => {
      const next = findStep(lesson, pathname)
      return prev?.el === next?.el && prev?.key === next?.key ? prev : next
    })
    read()
    const timer = window.setInterval(read, 200)
    return () => window.clearInterval(timer)
  }, [lesson, pathname, enabled])
  return step
}

const reached = new Set<string>()
const goal = (id: string) => {
  if (reached.has(id)) return
  reached.add(id)
  reachGoal(`tutorial_${id}`)
}

const introKey = (userId: string | null) => `mmo_tour_intro_${userId ?? ''}`
/** «×» скрывает подсказки до конца сеанса вкладки; вернуть — Библиотека → «Обучение для новичков». */
const PAUSED_KEY = 'mmo_tour_paused'
function pausedNow(): boolean {
  try { return sessionStorage.getItem(PAUSED_KEY) === '1' } catch { return false }
}
function savePaused(value: boolean) {
  try { if (value) sessionStorage.setItem(PAUSED_KEY, '1'); else sessionStorage.removeItem(PAUSED_KEY) } catch { /* приватный режим */ }
}
function introSeen(userId: string | null): boolean {
  try { return localStorage.getItem(introKey(userId)) === '1' } catch { return true }
}

export function CityTutorialGuide() {
  const { userId } = useAuth()
  const location = useLocation()
  const qc = useQueryClient()
  const { data } = useCityTutorial()
  const [paused, setPaused] = useState(pausedNow)
  const [intro, setIntro] = useState(() => !introSeen(userId))
  const finish = useMutation({
    mutationFn: () => updateTutorial('complete'),
    onSuccess: value => {
      goal('done')
      qc.setQueryData(tutorialKey(userId), value)
      void qc.invalidateQueries({ queryKey: ['character', 'me'] })
      void qc.invalidateQueries({ queryKey: ['character'], exact: true })
      void qc.invalidateQueries({ queryKey: ['dollars'] })
      void qc.invalidateQueries({ queryKey: ['chat', 'notices'] })
    },
  })

  useEffect(() => {
    if (!location.state?.resumeTutorial) return
    savePaused(false)
    setPaused(false)
  }, [location.key, location.state])
  useEffect(() => { setIntro(!introSeen(userId)) }, [userId])

  const lesson = data?.lesson
  const shown = !!data?.active && !!lesson && !paused && scenes.has(location.pathname)
  const step = useStep(lesson, location.pathname, shown && !intro)

  useEffect(() => {
    if (!step) return
    goal(step.key)
    step.el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [step])

  if (data?.letterPending) return <NewcomerLetterModal />
  if (!shown || !lesson) return null

  const close = () => { savePaused(true); setPaused(true) }
  const weapon = data?.weapon
  const reward = data?.reward
  const number = LESSONS.indexOf(lesson)
  const counter = number >= 0 ? `${number + 1} из ${LESSONS.length}` : undefined

  if (intro && lesson === 'buy') {
    return <TourSpotlight target={null} title="Первые шаги" onClose={close}
      text={'Соберись к первому бою: купи оружие, возьми его в руку и вложи очки в урон.'
        + (reward ? ` Бывалый даст за это ${reward.rubles.toLocaleString('ru-RU')} ₽ и ${reward.dollars} $.` : '')}>
      <button type="button" className="btn tour__action" autoFocus onClick={() => {
        try { localStorage.setItem(introKey(userId), '1') } catch { /* приватный режим: покажем ещё раз */ }
        goal('start')
        setIntro(false)
      }}>Начать</button>
    </TourSpotlight>
  }

  const name = weapon?.name ? `«${weapon.name}»` : 'оружия'
  const TEXT: Record<string, string> = {
    'nav-shop': 'Открой Гос магазин.',
    'nav-inventory': 'Открой Склад.',
    'nav-skills': 'Открой Центр подготовки.',
    'nav-center': 'Вернись на площадь: нажми «Центр».',
    'shop-tab': 'Открой раздел с этим оружием.',
    buy: `Нажми «Купить» у ${name}.`,
    'inventory-tab': 'Открой раздел с оружием.',
    equip: `Нажми «Надеть» у ${name}.`,
    setup: `Нажми «Настроить» у ${name}.`,
    'fill-damage': 'Нажми «Все очки в урон».',
    save: 'Нажми «Сохранить».',
    'stat-plus': 'Нажми «+» у Силы.',
    'stat-confirm': 'Нажми «Подтвердить».',
  }

  if (lesson === 'unavailable') {
    return <TourSpotlight target={null} title={TITLES[lesson]} onClose={close}
      text="На витрине сейчас нет оружия для обучения. Продолжим, когда оно появится." />
  }
  if (lesson === 'buy' && weapon?.canAfford === false) {
    return <TourSpotlight target={null} title={TITLES[lesson]} step={counter} onClose={close}
      text={`Не хватает рублей на ${name}. Вернись сюда, когда заработаешь.`} />
  }
  if (step) {
    return <TourSpotlight target={step.el} title={TITLES[lesson]} step={counter} onClose={close}
      text={TEXT[step.key] ?? TEXT[lesson] ?? ''} />
  }
  if (lesson === 'stats' && location.pathname === '/stats') {
    return <TourSpotlight target={null} title="Готово" step={counter} onClose={close}
      text="Оружие в руке, урон настроен. Бывалый ждёт с письмом и наградой.">
      <button type="button" className="btn tour__action" autoFocus disabled={finish.isPending}
        onClick={() => finish.mutate()}>Завершить обучение</button>
      {finish.isError && <p role="alert">{finish.error.message}</p>}
    </TourSpotlight>
  }
  return null
}
