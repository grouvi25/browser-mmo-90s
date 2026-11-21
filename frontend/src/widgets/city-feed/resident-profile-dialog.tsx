import { useEffect, useRef } from 'react'
import type { ResidentProfile } from '../../shared/api/chat.api'
import './resident-profile-dialog.css'

export function ResidentProfileDialog({ nickname, level, profile, onClose }: {
  nickname: string
  level: number
  profile: ResidentProfile
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])

  return <dialog ref={dialog} aria-label={nickname} className="resident-profile" onClose={onClose}
    onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation() }}
    onClick={event => { if (event.target === event.currentTarget) dialog.current?.close() }}>
    <article>
      <header className="resident-profile__header">
        <h2>{nickname}</h2>
        <button className="btn btn-sm" type="button" onClick={() => dialog.current?.close()}>Закрыть</button>
      </header>
      <p>{profile.occupation} · городской персонаж</p>
      <dl className="resident-profile__stats">
        <div><dt>Боевой уровень</dt><dd>{level}</dd></div>
        <div><dt>Уровень производства</dt><dd>{profile.productionLevel}</dd></div>
        <div><dt>Сила</dt><dd>{profile.stats.str}</dd></div>
        <div><dt>Ловкость</dt><dd>{profile.stats.agi}</dd></div>
        <div><dt>Выносливость</dt><dd>{profile.stats.end}</dd></div>
        <div><dt>Меткость</dt><dd>{profile.stats.acc}</dd></div>
      </dl>
    </article>
  </dialog>
}
