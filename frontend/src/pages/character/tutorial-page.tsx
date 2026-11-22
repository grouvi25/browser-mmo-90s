import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../shared/api/client'
import { SHOP_IMAGES } from '../../shared/assets/shop/shop-images'
import { Fault, Note } from '../stage3/stage3-ui'
import './tutorial.css'

type Lesson = {
  action: string
  place: string
  title: string
  text: string
  button: string
  item?: { code: string; name: string; hint: string }
}

const lessons: readonly Lesson[] = [
  {
    action: 'buy-jacket', place: 'Госмагазин', title: 'Купи первую броню',
    text: 'В Госмагазине открой раздел брони и выбери вещь своего уровня. Куртка защищает корпус.',
    button: 'Купить куртку', item: { code: 'armor_jacket_basic', name: 'Стёганая куртка', hint: 'Броня корпуса' },
  },
  {
    action: 'equip-jacket', place: 'Склад', title: 'Надень купленную вещь',
    text: 'Покупка лежит на Складе. Открой карточку вещи и нажми «Надеть». Броня начинает защищать после экипировки.',
    button: 'Надеть куртку', item: { code: 'armor_jacket_basic', name: 'Стёганая куртка', hint: 'Покупка уже на Складе' },
  },
  {
    action: 'assign-endurance', place: 'Навыки', title: 'Распредели очки',
    text: 'В «Навыках» нажми плюс рядом с нужной характеристикой, затем сохрани выбор. Для начала попробуй выносливость: она повышает здоровье.',
    button: '+1 к выносливости',
  },
  {
    action: 'buy-bandage', place: 'Госмагазин → Расходники', title: 'Возьми лечение в бой',
    text: 'Купи бинт. На Складе его можно использовать сразу или положить в боевой карман, чтобы он был доступен в бою.',
    button: 'Купить бинт', item: { code: 'consumable_bandage', name: 'Бинт', hint: 'Восстанавливает здоровье' },
  },
  {
    action: 'choose-strike', place: 'Учебный бой', title: 'Подойди и выбери удар',
    text: 'Кулаки достают до соседней клетки. Выбери клетку и отправь ход движения. В следующем раунде выбери цель, руку и зону удара.',
    button: 'Удар левой в корпус',
  },
  {
    action: 'choose-block', place: 'Учебный бой', title: 'Выставь защиту',
    text: 'В стойке «1 удар + 2 блока» нужно выбрать два блока. Твой удар уже готов. Закрой голову и корпус.',
    button: 'Закрыть корпус',
  },
  {
    action: 'end-turn', place: 'Учебный бой', title: 'Отправь ход',
    text: 'Удар в корпус и два блока готовы. Заверши ход. В настоящем бою итог раунда появится в хронике, когда бойцы сходят или выйдет время.',
    button: 'Завершить ход',
  },
]

type Progress = { step: number | null; completed: boolean; reward: { rubles: number; dollars: number } }
const queryKey = ['character', 'tutorial']
const path = '/api/characters/tutorial'

function PracticeLesson({ lesson, step, busy, advance }: {
  lesson: Lesson; step: number; busy: boolean; advance: () => void
}) {
  const [part, setPart] = useState(0)
  const movementStep = lesson.action === 'choose-strike'
  const near = part === 2
  const chooseCell = movementStep && part === 0
  const submitMove = movementStep && part === 1
  const firstBlock = lesson.action === 'choose-block' && part === 0
  const button = chooseCell ? 'Выбрать соседнюю клетку' : submitMove ? 'Завершить ход движения' : firstBlock ? 'Закрыть голову' : lesson.button
  return <section className="tutorial__lesson" aria-label={lesson.place}>
    <p className="tutorial__place">{lesson.place} · {step + 1} из {lessons.length}</p>
    <h2>{lesson.title}</h2>
    <p>{lesson.text}</p>
    {lesson.item && <div className="tutorial__item">
      <img src={SHOP_IMAGES[lesson.item.code]} alt="" />
      <span><b>{lesson.item.name}</b><small>{lesson.item.hint}</small></span>
    </div>}
    {movementStep && <div className="tutorial__distance" role="img" aria-label={near ? 'До противника одна клетка' : submitMove ? 'До противника две клетки. Клетка для движения выбрана' : 'До противника две клетки'}>
      <span>{!near && 'Ты'}</span><span className={submitMove ? 'is-selected' : undefined}>{near && 'Ты'}</span><span>Хулиган</span>
    </div>}
    {firstBlock === false && lesson.action === 'choose-block' && <p>Первый блок: голова.</p>}
    <button type="button" className="btn tutorial__target" autoFocus disabled={busy}
      onClick={chooseCell || submitMove || firstBlock ? () => setPart(part + 1) : advance}>{button}</button>
  </section>
}

export function TutorialPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const dialog = useRef<HTMLDialogElement>(null)
  const [practiceStep, setPracticeStep] = useState<number | null>(null)
  const progress = useQuery({ queryKey, queryFn: () => api.get<Progress>(path), retry: false })
  const advance = useMutation({
    mutationFn: (action: string) => api.post<Progress>(path, { action }),
    onSuccess: value => {
      qc.setQueryData(queryKey, value)
      if (value.completed) {
        void qc.invalidateQueries({ queryKey: ['character', 'me'] })
        void qc.invalidateQueries({ queryKey: ['dollars'] })
      }
    },
  })
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    element.showModal()
    return () => element.close()
  }, [])

  const state = progress.data
  const step = practiceStep ?? state?.step ?? -1
  const lesson = lessons[step]
  const replay = practiceStep !== null
  const completed = step === lessons.length
  const needsStart = state?.step === null && !replay
  const earnsReward = !replay && !needsStart && !!state
  const reward = state ? state.reward.rubles.toLocaleString('ru-RU') + ' ₽ и ' + state.reward.dollars + ' игровых $' : ''
  return createPortal(
    <dialog className="tutorial" ref={dialog} aria-labelledby="tutorial-title"
      onCancel={event => { event.preventDefault(); navigate('/') }}>
      <h1 id="tutorial-title">Первые шаги в городе</h1>
      {progress.isLoading && <p role="status">Загружаем обучение…</p>}
      {progress.isError && <Fault retry={() => progress.refetch()} />}
      {needsStart && <>
        <p>Здесь можно потренироваться с экипировкой и разыграть учебный ход. Игровой баланс и характеристики останутся прежними.</p>
        <button type="button" className="btn tutorial__target" onClick={() => setPracticeStep(0)}>Начать практику</button>
      </>}
      {lesson && <>
        {step === 0 && <p>Лучше пройти практику перед первым боем. Покупки и экипировка здесь учебные.</p>}
        {earnsReward && <p>За прохождение: <b>{reward}</b></p>}
        <PracticeLesson key={lesson.action} lesson={lesson} step={step} busy={advance.isPending}
          advance={() => replay ? setPracticeStep(step + 1) : advance.mutate(lesson.action)} />
        <Note kind="bad" text={advance.error?.message ?? ''} />
      </>}
      {completed && <div role="status">
        <h2>{replay ? 'Практика завершена' : 'Обучение пройдено'}</h2>
        {earnsReward && <p>На игровой счёт зачислено {reward}.</p>}
        <p>Перед первым боем надень экипировку, проверь здоровье и положи бинт в карман. На Стрелках выбери «Тренировочного хулигана» первого уровня.</p>
      </div>}
      <div className="tutorial__actions">
        {completed && <>
          <Link className="btn tutorial__target" to="/pvp?opponent=bot">К боям с ботами</Link>
          <Link className="btn" to="/shop">В Госмагазин</Link>
          <button type="button" className="btn" onClick={() => setPracticeStep(0)}>Повторить практику</button>
        </>}
        {needsStart && <Link className="btn" to="/library">В Библиотеку</Link>}
        <Link to="/" className="btn">{lesson ? 'Пропустить обучение' : 'На площадь'}</Link>
      </div>
    </dialog>,
    document.body,
  )
}
