import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { MENU } from '../../shared/lib/layout-map'
import { FitText, type StageBox } from '../../shared/lib/stage'
import { useAuth } from '../../app/providers/auth-provider'
import { authApi } from '../../shared/api/auth.api'
import { charactersApi } from '../../shared/api/characters.api'

interface StageTab {
  key: string
  label: string
  to: string
}

/** Keeps the visual centre stable while only compressing labels that need it. */
function FittedNavLabel({ children }: { children: ReactNode }) {
  const shellRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const shell = shellRef.current
    const text = textRef.current
    if (!shell || !text) return

    const measure = () => {
      // Доступна ширина контента, то есть без собственных полей подписи.
      // Раньше здесь стояло фиксированное «минус 14» под абсолютную
      // раскладку; с полями в потоке оно поджимало текст на ровном месте.
      const style = getComputedStyle(shell)
      const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      const available = Math.max(0, shell.clientWidth - padding)
      const natural = text.scrollWidth
      setScale(natural > 0 ? Math.min(1, available / natural) : 1)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(shell)
    if (document.fonts?.ready) void document.fonts.ready.then(measure)
    return () => observer.disconnect()
  }, [children])

  return (
    <span ref={shellRef} className="stage-nav__label">
      <span
        ref={textRef}
        className="stage-nav__label-text"
        style={{ transform: `scaleX(${scale})` }}
      >
        {children}
      </span>
    </span>
  )
}

/** Frame and label share one grid cell, so neither can drift from the other. */
function FramedTabs({
  tabs, box, gap, fontSize, activeKey, onSelect, variant,
}: {
  tabs: readonly StageTab[]
  box: StageBox
  gap: number
  fontSize: number
  activeKey: string
  onSelect: (tab: StageTab) => void
  /** Ряд комнат в макете залит белым, ряд районов — прозрачный. */
  variant?: 'rooms'
}) {
  return (
    <nav
      className={'stage-nav' + (variant ? ' stage-nav--' + variant : '')}
      style={{
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        gap,
      }}
    >
      {tabs.map(tab => {
        const locked = tab.to.startsWith('/soon/')
        return (
          <button
            type="button"
            key={tab.key}
            className={'stage-nav__button t-sign'
              + (locked ? ' is-locked' : '')
              + (activeKey === tab.key ? ' is-active' : '')}
            style={{ fontSize }}
            onClick={() => onSelect(tab)}
            title={locked ? 'Откроется на следующих этапах' : tab.label}
            data-stage-nav={tab.key}
          >
            <span className="stage-nav__frame" aria-hidden="true" />
            <FittedNavLabel>{tab.label}</FittedNavLabel>
          </button>
        )
      })}
    </nav>
  )
}

/** Наличные в шапке. Тот же запрос, что у карточки персонажа, поэтому
 *  сумма и в шапке, и в «личном деле» обновляется одним ответом сервера. */
function NavMoney() {
  const { data: char } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
    retry: false,
    refetchInterval: 30_000,
  })
  const textRef = useRef<HTMLSpanElement>(null)
  const [scale, setScale] = useState(1)
  const money = char ? char.money.toLocaleString('ru') : ''

  // Сумма — единственная надпись шапки, длину которой задаёт не макет, а
  // игрок. Пока помещается в свою ячейку, кегль макетный; переросла —
  // ужимается по ширине, как подписи вкладок, и на соседей не наезжает.
  useEffect(() => {
    const text = textRef.current
    if (!text) return
    const measure = () => {
      const prev = text.style.transform
      text.style.transform = 'none'
      const natural = text.offsetWidth
      text.style.transform = prev
      setScale(natural > 0 ? Math.min(1, MENU.navMoney.w / natural) : 1)
    }
    measure()
    if (document.fonts?.ready) void document.fonts.ready.then(measure)
  }, [money])

  if (!char) return null
  return (
    <div
      className="t-sign stage-money"
      style={{
        left: MENU.navMoney.x, top: MENU.navMoney.y, width: MENU.navMoney.w,
        fontSize: MENU.navFontSize,
        // Тот же сдвиг, что у пунктов меню: они рисуются через FitText
        // с MENU.navDy, и без него сумма садилась на четыре пикселя ниже.
        transform: `translateY(${MENU.navDy}px)`,
      }}
      title={'Наличные: ' + money + ' рублей'}
    >
      <span
        ref={textRef}
        className="stage-money__text"
        style={{ transform: `scaleX(${scale})` }}
      >
        <span className="stage-money__sum">{money}</span>
        <span className="stage-money__cur">&#8381;</span>
      </span>
    </div>
  )
}

export function TopNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const { signOut } = useAuth()

  const handleLogout = async () => {
    try { await authApi.logout() } catch { /* Сессия могла истечь, выходим всё равно. */ }
    signOut()
    navigate('/login')
  }

  const go = (to: string) => {
    if (to === '/') { void qc.invalidateQueries(); navigate('/') }
    else navigate(to)
  }

  return (
    <>
      {MENU.nav.map(n => (
        <FitText
          key={n.key}
          x={n.x} y={n.y} w={n.w} size={MENU.navFontSize} dy={MENU.navDy}
          as="button"
          className={'t-sign stage-link'
            + (!n.action && location.pathname === n.to ? ' is-active' : '')}
          onClick={() => go(n.to)}
          title={n.label}
        >
          {n.label}
        </FitText>
      ))}
      <FitText
        x={MENU.navExit.x} y={MENU.navExit.y} w={MENU.navExit.w}
        size={MENU.navFontSize} dy={MENU.navDy}
        as="button"
        className="t-sign stage-link stage-link--exit"
        onClick={handleLogout}
        title="Выйти из игры"
      >
        {MENU.navExit.label}
      </FitText>
      <NavMoney />
    </>
  )
}

/** Какой район подсветить для текущего адреса. Порядок важен: более
 *  длинные пути проверяются раньше коротких, иначе /shops/private
 *  поймается на /shop. */
// Раньше сюда приходил pathname вместе с query: страница работы была
// комнатой сразу двух районов, и различить входы можно было только
// пометкой /work?from=agriculture. Аграрного района больше нет,
// спецслучай ушёл вместе с ним, и функция работает с чистым путём.
export function districtKey(path: string) {
  // Посадочная района называет его прямо — самый надёжный случай, поэтому
  // проверяется первым. Все остальные ветки разбирают адреса комнат.
  const landing = /^\/district\/([a-z]+)/.exec(path)
  if (landing) return landing[1]
  if (path === '/' || ['/inventory', '/skills', '/stats', '/battles/history', '/clans', '/premium'].some(x => path.startsWith(x))) return 'center'
  if (['/industrial', '/work', '/resources', '/objects', '/recipes', '/farm', '/plants', '/agriculture']
    .some(x => path.startsWith(x))) return 'industrial'
  if (['/garages', '/upgrades', '/repair'].some(x => path.startsWith(x))) return 'garages'
  if (['/market', '/shops/private', '/shop', '/bars'].some(x => path.startsWith(x))) return 'market'
  if (path.startsWith('/pvp') || path.startsWith('/territories')) return 'suburb'
  if (['/station', '/soon/logistics', '/soon/storage'].some(x => path.startsWith(x))) return 'station'
  return ''
}

export function DistrictTabs() {
  const navigate = useNavigate()
  const location = useLocation()
  const exact = MENU.districts.find(tab => tab.to === location.pathname)?.key
  const activeKey = districtKey(location.pathname + location.search) || exact || ''

  return (
    <FramedTabs
      tabs={MENU.districts}
      box={MENU.districtStrip}
      gap={MENU.districtGap}
      fontSize={MENU.navFontSize}
      activeKey={activeKey}
      onSelect={tab => navigate(tab.to)}
    />
  )
}

export function BottomTabs() {
  const navigate = useNavigate()
  const location = useLocation()
  const key = districtKey(location.pathname + location.search)
  const tabs = MENU.rooms[key]
  if (!tabs?.length) return null
  // Сначала точное совпадение с query — иначе «Колхозы» не подсветятся
  // никогда, их адрес отличается от пути только пометкой района.
  const activeKey = tabs.find(tab => tab.to === location.pathname + location.search)?.key
    ?? tabs.find(tab => tab.to === location.pathname)?.key ?? ''

  return (
    <FramedTabs
      tabs={tabs}
      variant="rooms"
      box={MENU.bottomStrip}
      gap={MENU.bottomGap}
      fontSize={MENU.bottomFontSize}
      activeKey={activeKey}
      onSelect={tab => navigate(tab.to)}
    />
  )
}
