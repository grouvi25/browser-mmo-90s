import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { useCityTutorial } from '../../widgets/city-tutorial/use-city-tutorial'
import { reachGoal } from '../../shared/lib/attribution'
import './tutorial.css'

type Lesson = {
  action: string
  place: string
  title: string
  text: string
  button: string
}

const lessons: readonly Lesson[] = [
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

function PracticeLesson({ lesson, step, advance }: {
  lesson: Lesson; step: number; advance: () => void
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
    {movementStep && <div className="tutorial__distance" role="img" aria-label={near ? 'До противника одна клетка' : submitMove ? 'До противника две клетки. Клетка для движения выбрана' : 'До противника две клетки'}>
      <span>{!near && 'Ты'}</span><span className={submitMove ? 'is-selected' : undefined}>{near && 'Ты'}</span><span>Хулиган</span>
    </div>}
    {firstBlock === false && lesson.action === 'choose-block' && <p>Первый блок: голова.</p>}
    <button type="button" className="btn tutorial__target" autoFocus
      onClick={chooseCell || submitMove || firstBlock ? () => setPart(part + 1) : advance}>{button}</button>
  </section>
}

export function TutorialPage() {
  const navigate = useNavigate()
  const dialog = useRef<HTMLDialogElement>(null)
  const [practiceStep, setPracticeStep] = useState<number | null>(null)
  const progress = useCityTutorial()
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    element.showModal()
    return () => element.close()
  }, [])

  // Цели Метрики по шагам учебного боя: видно, где бросают (Дима 25.11).
  useEffect(() => {
    if (practiceStep !== null) reachGoal(`tutorial_practice_${practiceStep === lessons.length ? 'done' : lessons[practiceStep].action}`)
  }, [practiceStep])

  const lesson = practiceStep === null ? undefined : lessons[practiceStep]
  const completed = practiceStep === lessons.length
  return createPortal(
    <dialog className="tutorial" ref={dialog} aria-labelledby="tutorial-title"
      onCancel={event => { event.preventDefault(); navigate('/') }}>
      <h1 id="tutorial-title">Первые шаги в городе</h1>
      {practiceStep === null && <>
        {progress.data?.active
          ? <p>На площади тебя ждут подсказки. Они покажут, где купить оружие, как взять его в руку и вложить очки в урон.</p>
          : <p>Здесь можно потренироваться с движением, ударами и блоками перед настоящим боем.</p>}
        <div className="tutorial__actions">
          <Link className="btn tutorial__target" to="/" state={{ resumeTutorial: true }}>
            {progress.data?.active ? 'Продолжить на площади' : 'На площадь'}
          </Link>
          <button type="button" className="btn" onClick={() => setPracticeStep(0)}>Учебный бой</button>
        </div>
      </>}
      {lesson && practiceStep !== null && <PracticeLesson key={lesson.action} lesson={lesson} step={practiceStep}
        advance={() => setPracticeStep(practiceStep + 1)} />}
      {completed && <div role="status">
        <h2>Практика завершена</h2>
        <p>На Стрелках выбери «Тренировочного хулигана» первого уровня, когда будешь готов.</p>
      </div>}
      {practiceStep !== null && <div className="tutorial__actions">
        {completed && <Link className="btn tutorial__target" to="/pvp?opponent=bot">К боям с ботами</Link>}
        <Link to="/" className="btn" state={{ resumeTutorial: true }}>На площадь</Link>
      </div>}
    </dialog>,
    document.body,
  )
}
