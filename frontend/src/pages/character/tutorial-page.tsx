import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../shared/api/client'
import { Fault, Note } from '../stage3/stage3-ui'
import './tutorial.css'

const lessons = [
  { action: 'buy-jacket', place: 'Госмагазин', title: 'Купить экипировку', text: 'Зайди в Госмагазин и выбери броню. Для начала подойдет куртка: она защищает корпус.', button: 'Купить куртку' },
  { action: 'equip-jacket', place: 'Склад', title: 'Надеть купленную вещь', text: 'Покупка попадет на Склад. Открой карточку вещи и нажми «Надеть», чтобы броня начала действовать.', button: 'Надеть куртку' },
  { action: 'assign-endurance', place: 'Навыки', title: 'Распределить характеристики', text: 'Свободные очки тратятся в разделе «Навыки». Попробуй добавить очко выносливости и сохранить выбор. Выносливость повышает здоровье.', button: 'Добавить 1 к выносливости' },
  { action: 'buy-bandage', place: 'Госмагазин', title: 'Купить лечение', text: 'В Госмагазине открой «Расходники» и купи бинт. Со Склада его можно использовать или положить в боевой карман, чтобы взять в бой.', button: 'Купить бинт' },
  { action: 'choose-strike', place: 'Тренировочный бой', title: 'Выбрать удар', text: 'В бою выбери противника и зону удара. С кулаками сначала подойди на соседнюю клетку. Попробуй указать корпус.', button: 'Удар в корпус' },
  { action: 'choose-block', place: 'Тренировочный бой', title: 'Поставить блок', text: 'Выбери зону, которую будешь защищать в этом раунде. Например, голову.', button: 'Закрыть голову' },
  { action: 'end-turn', place: 'Тренировочный бой', title: 'Завершить ход', text: 'Когда действия выбраны, заверши ход. Игра разыграет раунд после ходов бойцов или по таймеру. Результат появится в хронике.', button: 'Завершить ход' },
] as const

type Progress = { step: number | null; completed: boolean; reward: { rubles: number; dollars: number } }
const queryKey = ['character', 'tutorial']
const path = '/api/characters/tutorial'

export function TutorialPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const dialog = useRef<HTMLDialogElement>(null)
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
  const step = state?.step ?? -1
  const lesson = lessons[step]
  const reward = state ? state.reward.rubles.toLocaleString('ru-RU') + ' ₽ и ' + state.reward.dollars + ' игровых $' : ''
  return createPortal(
    <dialog className="tutorial" ref={dialog} aria-labelledby="tutorial-title"
      onCancel={event => { event.preventDefault(); navigate('/') }}>
      <h1 id="tutorial-title">Первые шаги в городе</h1>
      {progress.isLoading && <p role="status">Загружаем обучение…</p>}
      {progress.isError && <Fault retry={() => progress.refetch()} />}
      {state?.step === null && <p>Это обучение доступно новым персонажам. О правилах города можно почитать в Библиотеке.</p>}
      {lesson && <>
        <p>Лучше пройти обучение перед первым настоящим боем. Действия здесь учебные, деньги за покупки не списываются.</p>
        <p>Награда за прохождение: <b>{reward}</b></p>
        <section className="tutorial__lesson" aria-label={lesson.place}>
          <p className="tutorial__place">{lesson.place} · {step + 1} из {lessons.length}</p>
          <h2>{lesson.title}</h2>
          <p>{lesson.text}</p>
          <button type="button" className="btn tutorial__target" autoFocus disabled={advance.isPending}
            onClick={() => advance.mutate(lesson.action)}>{lesson.button}</button>
        </section>
        <Note kind="bad" text={advance.error?.message ?? ''} />
      </>}
      {state?.completed && <div role="status">
        <h2>Обучение пройдено</h2>
        <p>На игровой счет зачислено {reward}. Первый настоящий тренировочный бой можно начать на арене.</p>
      </div>}
      <div className="tutorial__actions">
        {state?.completed && <Link className="btn" to="/pvp">На арену</Link>}
        {state?.step === null && <Link className="btn" to="/library">В Библиотеку</Link>}
        <Link to="/" className="btn">{lesson ? 'Пропустить обучение' : 'На площадь'}</Link>
      </div>
    </dialog>,
    document.body,
  )
}
