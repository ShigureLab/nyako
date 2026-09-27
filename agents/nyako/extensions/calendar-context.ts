import chineseDays from 'chinese-days'
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'

const TIME_ZONE = 'Asia/Shanghai'
const FIRST_HOLIDAY_DATA_YEAR = 2004
const LAST_HOLIDAY_DATA_YEAR = 2026
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_HOLIDAY_SPAN_DAYS = 20

const COMMON_LUNAR_FESTIVALS = new Set([
  '春节',
  '元宵节',
  '端午节',
  '中秋节',
  '重阳节',
  '腊八节',
  '除夕',
])

const HOLIDAY_NAMES: Record<string, string> = {
  元旦: '元旦',
  春节: '春节',
  清明: '清明节',
  劳动节: '劳动节',
  端午: '端午节',
  国庆节: '国庆节',
  中秋: '中秋节',
}

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'long',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

export type ChinaCalendarContext = {
  date: string
  time: string
  label: string
  timeZone: typeof TIME_ZONE
  holidayDataAvailable: boolean
}

type DateParts = {
  date: string
  time: string
  weekday: string
  year: number
}

type HolidayDetail = {
  name: string
}

function chinaDateParts(instant: Date): DateParts {
  const parts = new Map(
    dateFormatter
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  )
  const year = Number(parts.get('year'))
  const month = parts.get('month')!
  const day = parts.get('day')!
  return {
    date: `${year}-${month}-${day}`,
    time: `${parts.get('hour')!}:${parts.get('minute')!}:${parts.get('second')!}`,
    weekday: parts.get('weekday')!,
    year,
  }
}

function parseHolidayDetail(value: string): HolidayDetail | null {
  const [, chineseName, days] = value.split(',')
  if (!chineseName || !days || !Number.isInteger(Number(days))) return null
  return { name: HOLIDAY_NAMES[chineseName] ?? chineseName }
}

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

function chineseNumber(value: number): string {
  const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  if (value < 10) return digits[value]!
  if (value === 10) return '十'
  if (value < 20) return `十${digits[value - 10]}`
  const tens = Math.floor(value / 10)
  const ones = value % 10
  return `${digits[tens]}十${digits[ones]}`
}

function holidayDayIndex(date: string, holidayName: string): number {
  let firstMatchingDate = date
  let cursor = date
  for (let offset = 1; offset < MAX_HOLIDAY_SPAN_DAYS; offset += 1) {
    cursor = shiftDate(cursor, -1)
    const detail = chineseDays.getDayDetail(cursor)
    if (detail.work) break
    const holiday = parseHolidayDetail(detail.name)
    if (!holiday) break
    if (holiday.name === holidayName) firstMatchingDate = cursor
  }
  return Math.round((Date.parse(date) - Date.parse(firstMatchingDate)) / DAY_MS) + 1
}

function eventAlreadyPresent(labels: string[], event: string): boolean {
  const normalized = event.replace(/节$/u, '')
  return labels.some((label) => {
    const withoutDayIndex = label.replace(/第[\u4e00-\u9fa5]+天$/u, '')
    return withoutDayIndex.replace(/节$/u, '') === normalized
  })
}

function addDistinctEvent(labels: string[], event: string): void {
  if (!eventAlreadyPresent(labels, event)) labels.push(event)
}

export function getChinaCalendarContext(instant = new Date()): ChinaCalendarContext {
  const { date, time, weekday, year } = chinaDateParts(instant)
  const labels = [weekday]
  const holidayDataAvailable = year >= FIRST_HOLIDAY_DATA_YEAR && year <= LAST_HOLIDAY_DATA_YEAR

  if (holidayDataAvailable) {
    const detail = chineseDays.getDayDetail(date)
    const holiday = parseHolidayDetail(detail.name)
    if (detail.work && holiday) {
      labels.push('调休补班')
    } else if (!detail.work && holiday) {
      const index = holidayDayIndex(date, holiday.name)
      labels.push(`${holiday.name}第${chineseNumber(index)}天`)
    }
  }

  for (const festival of chineseDays.getLunarFestivals(date).flatMap((item) => item.name)) {
    if (COMMON_LUNAR_FESTIVALS.has(festival)) addDistinctEvent(labels, festival)
  }
  for (const term of chineseDays.getSolarTerms(date)) {
    addDistinctEvent(labels, term.name)
  }

  return {
    date,
    time,
    label: labels.join('·'),
    timeZone: TIME_ZONE,
    holidayDataAvailable,
  }
}

export default function registerCalendarContext(pi: ExtensionAPI): void {
  pi.on('before_agent_start', (event) => {
    if (event.prompt.startsWith('[NNP recovery]')) return undefined

    const calendar = getChinaCalendarContext()
    return {
      message: {
        customType: 'china-calendar-context',
        content: `[中国日历 ${calendar.date} ${calendar.time} ${calendar.timeZone}] ${calendar.label}`,
        display: false,
        details: calendar,
      },
    }
  })
}
