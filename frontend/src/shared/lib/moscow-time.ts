// Время города по Москве (№110): по нему обнуляются смены и считаются общие события.
import { useEffect, useState } from 'react'

const format = () => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' }).format(new Date())

export function useMoscowTime(): string {
  const [time, setTime] = useState(format)
  useEffect(() => {
    const timer = window.setInterval(() => setTime(format()), 15_000)
    return () => window.clearInterval(timer)
  }, [])
  return time
}
