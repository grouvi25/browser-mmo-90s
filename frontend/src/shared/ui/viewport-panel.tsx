// =============================================================
// Содержимое центрального вьюпорта: «бумажная» подложка,
// заголовок раздела и кнопка возврата в город.
// Все игровые экраны рендерятся через этот компонент.
// =============================================================
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

export function ViewportPanel({
  title, subtitle, children, onBack,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  onBack?: () => void
}) {
  const navigate = useNavigate()
  return (
    <div className="viewport__content">
      <div className="viewport__head">
        <h1 className="viewport__title">{title}</h1>
        {subtitle && <span className="viewport__subtitle">{subtitle}</span>}
        <button
          type="button"
          className="viewport__back"
          onClick={onBack ?? (() => navigate('/'))}
        >
          ← в город
        </button>
      </div>
      {children}
    </div>
  )
}

/** Раздел, который откроется на следующих этапах. */
export function LockedSection({ title, stage, what }: {
  title: string; stage: number; what: string
}) {
  return (
    <ViewportPanel title={title} subtitle={`Этап ${stage}`}>
      <div className="locked-note">
        <div className="locked-note__title">Пока закрыто</div>
        <p className="locked-note__text">{what}</p>
        <p className="locked-note__text" style={{ marginTop: 10, opacity: .8 }}>
          Раздел появится в Этапе {stage}. Место в интерфейсе уже отведено.
        </p>
      </div>
    </ViewportPanel>
  )
}
