export function gini(values: number[]): number {
  const sorted = values.filter(value => value >= 0).sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const total = sorted.reduce((sum, value) => sum + value, 0)
  if (total === 0) return 0
  const weighted = sorted.reduce((sum, value, index) => sum + (index + 1) * value, 0)
  return (2 * weighted) / (sorted.length * total) - (sorted.length + 1) / sorted.length
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle]
}

export function msUntilNextUtcHour(now: Date, hour: number): number {
  const next = new Date(now)
  next.setUTCHours(hour, 0, 0, 0)
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
  return next.getTime() - now.getTime()
}

export function workToolBlockedKey(date: string): string {
  return `economy:work:tool-blocked:${date}`
}
