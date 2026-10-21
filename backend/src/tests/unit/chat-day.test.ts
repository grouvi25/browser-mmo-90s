import { describe, expect, it, vi } from 'vitest'
import { chatDayStart } from '../../modules/chat/chat.formulas'
import { chatDayStart as clientDayStart, todayChatLines, startChatDayClock } from '../../../../frontend/src/shared/lib/chat-day'

const cases = [
  ['2026-10-21T20:59:59.999Z', '2026-10-20T21:00:00.000Z'],
  ['2026-10-21T21:00:00.000Z', '2026-10-21T21:00:00.000Z'],
  ['2026-10-21T21:00:00.001Z', '2026-10-21T21:00:00.000Z'],
  ['2026-10-22T00:00:00.000Z', '2026-10-21T21:00:00.000Z'],
  ['2027-01-01T00:00:00+03:00', '2026-12-31T21:00:00.000Z'],
  ['2028-03-01T00:00:00+03:00', '2028-02-29T21:00:00.000Z'],
  ['2026-10-21T14:00:00-07:00', '2026-10-21T21:00:00.000Z'],
]

describe('daily chat reset at midnight Moscow time', () => {
  it.each(cases)('%s starts at %s on both server and client', (now, expected) => {
    expect(chatDayStart(new Date(now)).toISOString()).toBe(expected)
    expect(new Date(clientDayStart(Date.parse(now))).toISOString()).toBe(expected)
  })

  it('uses Moscow midnight rather than the process timezone', () => {
    const previous = process.env.TZ
    try {
      for (const tz of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles']) {
        process.env.TZ = tz
        expect(chatDayStart(new Date('2026-10-21T21:00:00Z')).toISOString()).toBe('2026-10-21T21:00:00.000Z')
        expect(clientDayStart(Date.parse('2026-10-21T21:00:00Z'))).toBe(Date.parse('2026-10-21T21:00:00Z'))
      }
    } finally {
      if (previous === undefined) delete process.env.TZ
      else process.env.TZ = previous
    }
  })

  it('filters cached messages, notices and delayed replies without dropping new-day lines', () => {
    const lines = [
      { id: 'yesterday', createdAt: '2026-10-21T20:59:59.999Z' },
      { id: 'midnight', createdAt: '2026-10-21T21:00:00.000Z' },
      { id: 'today', createdAt: '2026-10-21T21:00:01.000Z' },
      { id: 'invalid', createdAt: 'invalid' },
    ]
    const cutoff = clientDayStart(Date.parse('2026-10-21T21:00:00Z'))
    expect(todayChatLines(lines, cutoff).map(line => line.id)).toEqual(['midnight', 'today'])
    // A pre-midnight HTTP/socket response arriving after the reset cannot resurrect it.
    expect(todayChatLines([lines[0]], cutoff)).toEqual([])
    expect(lines).toHaveLength(4)
  })

  it('catches up after a suspended tab misses more than one midnight', () => {
    const stale = [{ createdAt: '2026-10-21T21:00:01Z' }]
    expect(todayChatLines(stale, clientDayStart(Date.parse('2026-10-25T10:00:00Z')))).toEqual([])
  })
})


describe('open-tab chat day clock', () => {
  it('fires at midnight, reschedules once, catches up on resume and stops on unmount', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-21T20:59:59.999Z'))
      const onDay = vi.fn()
      const clock = startChatDayClock(onDay)
      expect(onDay).toHaveBeenLastCalledWith(Date.parse('2026-10-20T21:00:00Z'))
      expect(vi.getTimerCount()).toBe(1)
      vi.advanceTimersByTime(1)
      expect(onDay).toHaveBeenLastCalledWith(Date.parse('2026-10-21T21:00:00Z'))
      expect(vi.getTimerCount()).toBe(1)
      // StrictMode/focus/pageshow must not multiply timers.
      clock.refresh()
      clock.refresh()
      expect(vi.getTimerCount()).toBe(1)
      vi.setSystemTime(new Date('2026-10-25T10:00:00Z'))
      clock.refresh()
      expect(onDay).toHaveBeenLastCalledWith(Date.parse('2026-10-24T21:00:00Z'))
      clock.stop()
      const calls = onDay.mock.calls.length
      clock.refresh()
      vi.advanceTimersByTime(3 * 86_400_000)
      expect(onDay).toHaveBeenCalledTimes(calls)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
