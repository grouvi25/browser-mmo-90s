/** Номера страниц: первая, последняя и соседи текущей; длинный бой не
 *  растягивает ряд на сотню кнопок. */
export function pageNumbers(current: number, pages: number): (number | null)[] {
  const keep = new Set([1, pages, current - 1, current, current + 1, current - 2, current + 2])
  const out: (number | null)[] = []
  for (let n = 1; n <= pages; n++) {
    if (!keep.has(n)) continue
    if (out.length && (out[out.length - 1] ?? 0) < n - 1) out.push(null)
    out.push(n)
  }
  return out
}
