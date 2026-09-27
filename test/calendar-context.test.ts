import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { describe, expect, it, vi } from 'vite-plus/test'
import registerCalendarContext, {
  getChinaCalendarContext,
} from '../agents/nyako/extensions/calendar-context.ts'

function chinaNoon(date: string): Date {
  return new Date(`${date}T04:00:00.000Z`)
}

describe('Nyako China calendar context', () => {
  it.each([
    ['2026-09-28', '星期一'],
    ['2026-01-04', '星期日·调休补班'],
    ['2026-09-25', '星期五·中秋节第一天'],
    ['2026-09-26', '星期六·中秋节第二天'],
    ['2026-10-08', '星期四·寒露'],
    ['2025-10-08', '星期三·国庆节第八天·寒露'],
  ])('formats %s as %s', (date, label) => {
    expect(getChinaCalendarContext(chinaNoon(date))).toEqual({
      date,
      time: '12:00:00',
      label,
      timeZone: 'Asia/Shanghai',
      holidayDataAvailable: true,
    })
  })

  it('omits unsupported statutory arrangements instead of guessing', () => {
    expect(getChinaCalendarContext(chinaNoon('2027-01-03'))).toEqual({
      date: '2027-01-03',
      time: '12:00:00',
      label: '星期日',
      timeZone: 'Asia/Shanghai',
      holidayDataAvailable: false,
    })
  })

  it.each([
    ['2026-09-27T01:02:03.000Z', '2026-09-27', '09:02:03', '星期日·中秋节第三天'],
    ['2026-09-27T15:59:59.000Z', '2026-09-27', '23:59:59', '星期日·中秋节第三天'],
    ['2026-09-27T16:00:00.000Z', '2026-09-28', '00:00:00', '星期一'],
  ])('formats %s using the Shanghai date and 24-hour time', (instant, date, time, label) => {
    expect(getChinaCalendarContext(new Date(instant))).toEqual({
      date,
      time,
      label,
      timeZone: 'Asia/Shanghai',
      holidayDataAvailable: true,
    })
  })

  it('registers one hidden persistent context message before every turn', async () => {
    let handler: ((event: { prompt: string }) => unknown) | undefined
    registerCalendarContext({
      registerTool() {},
      on(event, candidate) {
        expect(event).toBe('before_agent_start')
        handler = candidate
        return () => {}
      },
    } as ExtensionAPI)

    const result = (await handler?.({ prompt: 'new conversation message' })) as {
      message: {
        content: string
        customType: string
        details: unknown
        display: boolean
      }
    }
    expect(result.message).toMatchObject({
      customType: 'china-calendar-context',
      display: false,
      details: {
        timeZone: 'Asia/Shanghai',
      },
    })
    expect(result.message.content).toMatch(
      /^\[中国日历 \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} Asia\/Shanghai\] 星期/u
    )
  })

  it('refreshes the time on each new turn', async () => {
    let handler: ((event: { prompt: string }) => unknown) | undefined
    registerCalendarContext({
      registerTool() {},
      on(_event, candidate) {
        handler = candidate
        return () => {}
      },
    } as ExtensionAPI)

    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-27T12:08:34.000Z'))
      expect(await handler?.({ prompt: 'first message' })).toMatchObject({
        message: {
          content: '[中国日历 2026-09-27 20:08:34 Asia/Shanghai] 星期日·中秋节第三天',
          details: { date: '2026-09-27', time: '20:08:34' },
        },
      })
      vi.setSystemTime(new Date('2026-09-27T16:00:00.000Z'))
      expect(await handler?.({ prompt: 'next message' })).toMatchObject({
        message: {
          content: '[中国日历 2026-09-28 00:00:00 Asia/Shanghai] 星期一',
          details: { date: '2026-09-28', time: '00:00:00' },
        },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not duplicate context when retrying the same NNP message', async () => {
    let handler: ((event: { prompt: string }) => unknown) | undefined
    registerCalendarContext({
      registerTool() {},
      on(_event, candidate) {
        handler = candidate
        return () => {}
      },
    } as ExtensionAPI)

    expect(await handler?.({ prompt: '[NNP recovery] request from peer' })).toBeUndefined()
  })
})
