// =============================================================
// Правила объявлений. Всё, что проверяется без базы.
// =============================================================

/** Длиннее в колонки и не влезет: VARCHAR(120) и VARCHAR(2000). */
export const MAX_TITLE = 120
export const MAX_BODY = 2000

/**
 * Чистит строку и обрезает по длине колонки. Обрезаем молча и по
 * границе слова: объявление пишет администратор, ему важнее увидеть
 * опубликованный текст, чем получить отказ из-за лишнего абзаца.
 */
export function trimTo(raw: string, max: number): string {
  const cleaned = raw.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (cleaned.length <= max) return cleaned
  const cut = cleaned.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  // Слово рвём только если оно само длиннее четверти всей выдержки —
  // иначе обрезка съела бы половину строки ради красоты.
  return (lastSpace > max * 0.75 ? cut.slice(0, lastSpace) : cut).trimEnd()
}
