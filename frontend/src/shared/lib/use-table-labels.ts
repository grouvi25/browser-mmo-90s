// =============================================================
// На узком экране таблицы разделов показываются строками-карточками
// (styles/mobile.css), и каждой ячейке нужна подпись своей колонки.
//
// Проставляем её из заголовка таблицы прямо в DOM, а не руками в
// одиннадцати страницах: подписи тогда не разъедутся с колонками
// при любой правке разметки. React атрибут data-label не
// контролирует, а пересоздание узлов ловит MutationObserver.
// =============================================================
import { useEffect, type RefObject } from 'react'

function stamp(root: HTMLElement): void {
  root.querySelectorAll('table.data-table').forEach(table => {
    const heads = [...table.querySelectorAll('thead th')].map(th => th.textContent?.trim() ?? '')
    if (!heads.length) return
    table.querySelectorAll('tbody tr').forEach(row => {
      row.querySelectorAll('td').forEach((cell, i) => {
        const label = heads[i] ?? ''
        if (label && cell.getAttribute('data-label') !== label) cell.setAttribute('data-label', label)
      })
    })
  })
}

export function useTableLabels(ref: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const root = ref.current
    if (!enabled || !root) return
    stamp(root)
    const observer = new MutationObserver(() => stamp(root))
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [ref, enabled])
}
