import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'

import { MENU } from '../../shared/lib/layout-map'
import { FitText, type StageBox } from '../../shared/lib/stage'
import { SPRITES } from '../../shared/ui/sprite'
import { useAuth } from '../../app/providers/auth-provider'
import { authApi } from '../../shared/api/auth.api'

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
      const available = Math.max(0, shell.clientWidth - 14)
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
  tabs, box, gap, fontSize, activeKey, onSelect,
}: {
  tabs: readonly StageTab[]
  box: StageBox
  gap: number
  fontSize: number
  activeKey: string
  onSelect: (tab: StageTab) => void
}) {
  return (
    <nav
      className="stage-nav"
      style={{
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
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
            <img className="stage-nav__frame" src={SPRITES['nav-frame']} alt="" draggable={false} />
            <FittedNavLabel>{tab.label}</FittedNavLabel>
          </button>
        )
      })}
    </nav>
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
    </>
  )
}

/** Какой район подсветить для текущего адреса. Порядок важен: более
 *  длинные пути проверяются раньше коротких, иначе /shops/private
 *  поймается на /shop. */
// path — это pathname вместе с query. Query нужна ровно для одного случая:
// страница работы общая для промзоны и села, и по одному пути не понять,
// из какого района игрок в неё вошёл. Без пометки клик по «Колхозам»
// перекидывал подсветку в промзону и подменял нижний ряд комнат.
export function districtKey(path: string) {
  if (path.startsWith('/work?from=agriculture')) return 'agriculture'
  if (path === '/' || ['/inventory', '/skills', '/stats', '/battles/history', '/clans'].some(x => path.startsWith(x))) return 'center'
  if (['/industrial', '/work', '/resources', '/objects'].some(x => path.startsWith(x))) return 'industrial'
  if (['/agriculture', '/farm'].some(x => path.startsWith(x))) return 'agriculture'
  if (['/garages', '/upgrades', '/repair'].some(x => path.startsWith(x))) return 'garages'
  if (['/market', '/shops/private', '/shop', '/bars'].some(x => path.startsWith(x))) return 'market'
  if (path.startsWith('/pvp')) return 'suburb'
  if (path.startsWith('/station')) return 'station'
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
      box={MENU.bottomStrip}
      gap={MENU.bottomGap}
      fontSize={MENU.bottomFontSize}
      activeKey={activeKey}
      onSelect={tab => navigate(tab.to)}
    />
  )
}
