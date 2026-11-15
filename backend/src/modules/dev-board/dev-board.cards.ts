// Экраны доски разработчиков на Rich Messages: чистые функции, данные на
// входе — HTML на выходе. Стиль и значки как в Grouvi Radar (набор SFSymbols,
// работает, пока у владельца бота есть Premium; без него — обычные эмодзи).
import type { DevBoardItem } from '@prisma/client'

export const ICONS: Record<string, string> = {
  ok: '6019175208240289774',
  undo: '6035297458907519073',
  start: '5807414083388971488',
  stop: '5807842691060341877',
  spark: '6021425109678429764',
  list: '6021435576513730578',
  user: '6024039683904772353',
  chat: '6030863729808120196',
  time: '6032604359794104706',
  gauge: '6026006551293074961',
  bolt: '6023761060786346622',
  brain: '6021733363776231718',
  open: '5807928135139728476',
}
const PLAIN: Record<string, string> = {
  ok: '✅', undo: '↩️', start: '▶️', stop: '⏹', spark: '✨', list: '📋', user: '👤', chat: '💬', time: '🕐', gauge: '📊', bolt: '⚡', brain: '🧠', open: '🌐',
}

export type Icons = Record<string, string>

export const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function icon(role: string, icons: Icons): string {
  const custom = icons[role]
  return custom ? `<tg-emoji emoji-id="${custom}">${PLAIN[role]}</tg-emoji>` : PLAIN[role]
}

function button(kind: 'callback_data' | 'disabled', content: string, style?: 'success' | 'primary' | 'danger', data?: string): string {
  return `<tg-button type="${kind}"${style ? ` style="${style}"` : ''}${data ? ` data="${esc(data)}"` : ''}>${content}</tg-button>`
}

const link = (content: string, url: string) => `<tg-button type="url" url="${esc(url)}">${content}</tg-button>`

const row = (...buttons: string[]) => `<tg-button-row align="center">${buttons.join('')}</tg-button-row>`
const since = (date: Date) => `<tg-time unix="${Math.floor(date.getTime() / 1000)}" format="r">недавно</tg-time>`

function table(rows: [string, string, string][], icons: Icons): string {
  return `<table bordered>${rows.map(([role, label, value]) => `<tr><td>${icon(role, icons)} ${label}</td><td><b>${value}</b></td></tr>`).join('')}</table>`
}

/** Карточка: тикет пишется как «ник · тема» в title, текст игрока — в note. */
export function cardHtml(item: DevBoardItem, icons: Icons, adminUrl?: string | null): string {
  const isTicket = item.ticketNumber != null
  const [who, ...subjectParts] = isTicket ? item.title.split(' · ') : ['', item.title]
  const subject = isTicket ? subjectParts.join(' · ') : item.title
  const head = isTicket ? `Обращение №${item.ticketNumber} · ${esc(who)}` : `Задача ${item.id}`
  const mark = item.status === 'DONE' ? icon('ok', icons) : item.status === 'TAKEN' ? icon('user', icons) : icon('spark', icons)
  const status = item.status === 'TAKEN' ? `в работе: ${esc(item.takenBy ?? '')}` : item.status === 'DONE' ? `готово${item.doneBy ? `: ${esc(item.doneBy)}` : ''}` : 'свободно'
  const [note, context] = (item.note ?? '').split(/\n\nКОНТЕКСТ:\s*/)
  const parts = [
    `<h3>${mark} ${item.status === 'DONE' ? `<s>${head}</s>` : head}</h3>`,
    table([
      ['chat', isTicket ? 'Тема' : 'Что', esc(subject)],
      ['bolt', 'Статус', status],
      ['time', isTicket ? 'Пришло' : 'Заведено', `${since(item.createdAt)}${!isTicket && item.createdBy ? ` · ${esc(item.createdBy)}` : ''}`],
    ], icons),
  ]
  if (item.status !== 'DONE') {
    if (note?.trim()) parts.push(`<details><summary>${icon('list', icons)} ${isTicket ? 'Текст обращения' : 'Подробности'}</summary><p>${esc(note.trim()).replace(/\n/g, '<br>')}</p></details>`)
    if (context?.trim()) parts.push(`<blockquote>${icon('brain', icons)} ${esc(context.trim()).replace(/\n/g, '<br>')}</blockquote>`)
  }
  // Неактивное не исчезает: раскладка не прыгает, видно, что кнопка есть.
  const take = item.status === 'OPEN'
    ? button('callback_data', `${icon('start', icons)} Беру`, 'success', `take:${item.id}`)
    : button('disabled', `${icon('start', icons)} Беру`)
  const done = item.status === 'TAKEN'
    ? button('callback_data', `${icon('ok', icons)} Готово`, 'primary', `done:${item.id}`)
    : button('disabled', `${icon('ok', icons)} Готово`)
  const free = item.status === 'TAKEN'
    ? button('callback_data', `${icon('stop', icons)} Отпустить`, 'danger', `free:${item.id}`)
    : button('disabled', `${icon('stop', icons)} Отпустить`)
  parts.push(item.status === 'DONE'
    ? row(button('callback_data', `${icon('undo', icons)} Вернуть в работу`, undefined, `free:${item.id}`))
    : row(take, done, free))
  if (adminUrl) parts.push(row(link(`${icon('open', icons)} Открыть в админке`, adminUrl)))
  return parts.join('')
}

/** Ссылка на сообщение в супергруппе: t.me/c/<id без -100>/<сообщение>. */
export function messageLink(chatId: string, messageId: number | null): string | null {
  if (!messageId) return null
  const internal = chatId.replace(/^-100/, '')
  return `https://t.me/c/${internal}/${messageId}`
}

/** Закреплённая сводка доски: сколько свободно и у кого что. */
export function summaryHtml(active: DevBoardItem[], doneToday: number, chatId: string, icons: Icons): string {
  const free = active.filter(item => item.status === 'OPEN')
  const taken = active.filter(item => item.status === 'TAKEN')
  const byWho = new Map<string, number>()
  for (const item of taken) byWho.set(item.takenBy ?? '?', (byWho.get(item.takenBy ?? '?') ?? 0) + 1)
  const label = (item: DevBoardItem) => {
    const text = item.ticketNumber ? `№${item.ticketNumber}` : `Задача ${item.id}`
    const link = messageLink(chatId, item.messageId)
    return link ? `<a href="${link}">${text}</a>` : text
  }
  const line = (item: DevBoardItem, withWho: boolean) => `<li>${label(item)} · ${esc(item.title)}${withWho ? ` · <b>${esc(item.takenBy ?? '')}</b>` : ''}</li>`
  return [
    `<h3>${icon('gauge', icons)} Доска</h3>`,
    table([
      ['spark', 'Свободно', String(free.length)],
      ...[...byWho.entries()].map(([who, n]) => ['user', `У ${esc(who)}`, String(n)] as [string, string, string]),
      ['ok', 'Готово за сутки', String(doneToday)],
    ], icons),
    free.length ? `<h4>${icon('spark', icons)} Свободно</h4><ul>${free.map(item => line(item, false)).join('')}</ul>` : '',
    taken.length ? `<h4>${icon('user', icons)} В работе</h4><ul>${taken.map(item => line(item, true)).join('')}</ul>` : '',
    `<p><i>Обновлено ${`<tg-time unix="${Math.floor(Date.now() / 1000)}" format="r">только что</tg-time>`}</i></p>`,
  ].join('')
}
