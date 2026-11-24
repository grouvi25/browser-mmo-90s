// =============================================================
// Засада из списка «онлайн» — травмы v8, раздел 12. Место игрока — страница,
// на которой он стоит, поэтому засада не уводит со страницы: значок у ника
// и окно подтверждения. Значок виден, только если в карманах есть бинокль и
// игрок стоит там же, где вы.
// =============================================================
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ambushApi } from '../../shared/api/ambush.api'
import type { OnlinePlayer } from '../../shared/api/chat.api'
import './ambush.css'

export function useBinoculars() {
  return useQuery({ queryKey: ['ambush', 'pockets'], queryFn: ambushApi.pockets, staleTime: 60_000, retry: false })
}

export function AmbushButton({ player }: { player: OnlinePlayer }) {
  const { pathname } = useLocation()
  const pockets = useBinoculars()
  const [open, setOpen] = useState(false)
  // Окно живёт отдельно от значка: после засады бинокля нет и значок пропадает,
  // а итог игрок должен увидеть.
  const visible = !!pockets.data?.binoculars && !player.resident && player.location === pathname
  if (!visible && !open) return null
  return <>
    {visible && <button type="button" className="ambush-btn" aria-label={`Засада на ${player.nickname}`} title={`Засада на ${player.nickname}`}
      onClick={event => { event.stopPropagation(); setOpen(true) }}>🔭</button>}
    {/* В корень страницы: сцена города масштабируется, и окно внутри неё уезжало в угол. */}
    {open && createPortal(<AmbushDialog player={player} onClose={() => setOpen(false)} />, document.body)}
  </>
}

function AmbushDialog({ player, onClose }: { player: OnlinePlayer; onClose: () => void }) {
  const qc = useQueryClient()
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])
  const attack = useMutation({
    mutationFn: () => ambushApi.ambush(player.characterId),
    onSettled: () => Promise.all([
      qc.invalidateQueries({ queryKey: ['ambush'] }),
      qc.invalidateQueries({ queryKey: ['character'] }),
      qc.invalidateQueries({ queryKey: ['city'] }),
      qc.invalidateQueries({ queryKey: ['hospital'] }),
    ]),
  })
  const result = attack.data

  return (
    <dialog ref={dialog} className="ambush-dialog" aria-label={`Засада на ${player.nickname}`} onClose={onClose}
      // Окно в корне страницы, но по дереву React клик всплыл бы к строке списка и открыл профиль.
      onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget && !attack.isPending) dialog.current?.close() }}>
      <article>
        <h2>Засада на {player.nickname}</h2>
        {!result && <>
          <p>Бинокль будет потрачен. Удача — цель уедет в реанимацию. Провал — туда попадёте вы.</p>
          {attack.error && <p className="ambush-dialog__error" role="alert">{attack.error.message}</p>}
          <div className="ambush-dialog__actions">
            <button type="button" className="btn btn-primary" disabled={attack.isPending} onClick={() => attack.mutate()}>
              {attack.isPending ? 'Подкрадываюсь…' : 'Напасть'}
            </button>
            <button type="button" className="btn" disabled={attack.isPending} onClick={() => dialog.current?.close()}>Отмена</button>
          </div>
        </>}
        {result && <>
          <p role="status">{result.success
            ? `Засада удалась: ${result.target} в реанимации.`
            : `Засада провалилась: ${result.target} ушёл, вы попали под встречный удар.`}</p>
          <button type="button" className="btn" onClick={() => dialog.current?.close()}>Закрыть</button>
        </>}
      </article>
    </dialog>
  )
}
