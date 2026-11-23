import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../app/providers/auth-provider'
import { NewcomerLetterModal } from '../welcome/newcomer-letter'
import { tutorialKey, tutorialWeaponTab, updateTutorial, useCityTutorial } from './use-city-tutorial'
import './city-tutorial.css'

const scenes = new Set(['/', '/shop', '/inventory', '/stats', '/district/market'])
const labels = {
  buy: 'Купи оружие',
  equip: 'Надень оружие',
  allocate: 'Вложи очко в урон',
  stats: 'Характеристики персонажа',
  unavailable: 'Стартовое оружие',
}

export function CityTutorialGuide() {
  const { userId } = useAuth()
  const location = useLocation()
  const qc = useQueryClient()
  const { data } = useCityTutorial()
  const [paused, setPaused] = useState(false)
  const finish = useMutation({
    mutationFn: () => updateTutorial('complete'),
    onSuccess: value => {
      qc.setQueryData(tutorialKey(userId), value)
      void qc.invalidateQueries({ queryKey: ['character', 'me'] })
      void qc.invalidateQueries({ queryKey: ['character'], exact: true })
      void qc.invalidateQueries({ queryKey: ['dollars'] })
      void qc.invalidateQueries({ queryKey: ['chat', 'notices'] })
    },
  })

  useEffect(() => { if (location.state?.resumeTutorial) setPaused(false) }, [location.key, location.state])
  const lesson = data?.lesson
  const shown = !!data?.active && !!lesson && !paused && scenes.has(location.pathname)
  useEffect(() => {
    document.body.toggleAttribute('data-city-tutorial', shown)
    if (!shown) return
    const frame = requestAnimationFrame(() => {
      document.querySelector('[data-tutorial-focus]')?.scrollIntoView({ block: 'center', inline: 'nearest' })
    })
    return () => {
      cancelAnimationFrame(frame)
      document.body.removeAttribute('data-city-tutorial')
    }
  }, [shown, lesson, data?.weapon?.id, data?.weapon?.itemId, location.key])

  if (data?.letterPending) return <NewcomerLetterModal />
  if (!shown || !lesson) return null

  const weapon = data?.weapon
  const query = tutorialWeaponTab(weapon?.weaponType) === 'ranged' ? '?tab=ranged' : '?tab=melee'
  const destination = lesson === 'buy' ? '/shop' : lesson === 'stats' ? '/stats' : '/inventory'
  const atStep = location.pathname === destination
  const copy = {
    buy: weapon?.canAfford === false
      ? 'Сейчас не хватает рублей на ' + weapon.name + '. Вернись сюда, когда заработаешь.'
      : 'В Госмагазине найди «' + weapon?.name + '» и нажми «Купить».',
    equip: 'На Складе открой карточку «' + weapon?.name + '» и нажми «Надеть».',
    allocate: 'Нажми «Настроить», впиши хотя бы одно очко в «Макс. урон» и сохрани.',
    stats: 'Здесь растут характеристики персонажа. Если есть свободное очко, нажми «+», посмотри, что изменилось, и подтверди выбор.',
    unavailable: 'На витрине сейчас нет доступного оружия с очками для распределения. Сможешь продолжить, когда оно появится.',
  }
  const jump = lesson !== 'unavailable' && (!atStep || ((lesson === 'buy' || lesson === 'equip' || lesson === 'allocate') && location.search !== query))
  return createPortal(
    <aside className="city-tutorial" aria-label="Обучение в городе">
      <div className="city-tutorial__header">
        <strong>{labels[lesson]}</strong>
        <button type="button" className="city-tutorial__dismiss" onClick={() => setPaused(true)} aria-label="Свернуть подсказки">×</button>
      </div>
      <p aria-live="polite">{copy[lesson]}</p>
      {jump && <Link className="btn" to={destination + (lesson === 'stats' ? '' : query)}>
        {lesson === 'buy' ? 'В Госмагазин' : lesson === 'stats' ? 'К характеристикам' : 'На Склад'}
      </Link>}
      {lesson === 'stats' && atStep && <button type="button" className="btn" disabled={finish.isPending}
        onClick={() => finish.mutate()}>Завершить обучение</button>}
      {finish.isError && <p role="alert">{finish.error.message}</p>}
    </aside>,
    document.body,
  )
}
