// =============================================================
// Содержимое центрального вьюпорта: «бумажная» подложка и заголовок
// раздела. Все игровые экраны рендерятся через этот компонент.
//
// Кнопки «← ЦЕНТР» сверху справа больше нет (правка заказчика 21.10:
// «в меню есть кнопка В ЦЕНТР, но так же сверху справа появляется —
// убрать справа сверху везде»): в город ведёт ЦЕНТР нижней полосы.
// =============================================================
import type { ReactNode } from 'react'

export function ViewportPanel({
  title, subtitle, children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <div className="viewport__content" tabIndex={0} role="region" aria-label={title}>
      <div className="viewport__head">
        <h1 className="viewport__title">{title}</h1>
        {subtitle && <span className="viewport__subtitle">{subtitle}</span>}
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
        <p className="locked-note__text locked-note__meta">
          Раздел появится в Этапе {stage}. Место в интерфейсе уже отведено.
        </p>
      </div>
    </ViewportPanel>
  )
}

