// =============================================================
// Границы ошибок вокруг содержимого раздела.
//
// Без них любое исключение при отрисовке гасит всё приложение:
// React размонтирует дерево целиком, и игрок видит пустой экран
// вместо города. Поле боя и экономика ходят в живые данные, форма
// которых менялась не раз, поэтому падение одной панели не должно
// уносить с собой навигацию и остальные разделы.
// =============================================================
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** что показать вместо упавшего блока; по умолчанию — карточка с ошибкой */
  fallback?: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Консоль — единственный канал диагностики на клиенте.
    console.error('Раздел упал:', error, info.componentStack)
  }

  private reset = () => this.setState({ error: null })

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback

    return (
      <div className="section-error">
        <div className="section-error__title">Раздел не открылся</div>
        <p className="section-error__text">
          Что-то пошло не так при отрисовке. Остальная игра работает — можно
          вернуться в город или попробовать ещё раз.
        </p>
        <p className="section-error__detail">{error.message}</p>
        <button type="button" className="btn btn-sm" onClick={this.reset}>
          Попробовать снова
        </button>
      </div>
    )
  }
}
