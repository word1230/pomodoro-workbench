function parseDate(value: string | null): Date | null {
  if (!value) {
    return null
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function isSameCalendarDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

function formatMonthDay(value: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  }).format(value)
}

function formatYearMonthDay(value: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(value)
}

function formatTime(value: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value)
}

export function formatSessionRange(startedAt: string, endedAt: string | null): string {
  const start = parseDate(startedAt)
  const end = parseDate(endedAt) ?? start

  if (!start || !end) {
    return '时间未知'
  }

  const startDateText = formatMonthDay(start)
  const startTime = formatTime(start)
  const endTime = formatTime(end)
  const endLabel = isSameCalendarDay(start, end) ? endTime : `${formatMonthDay(end)} ${endTime}`

  return `${startDateText} ${startTime} - ${endLabel}`
}

export function formatSessionGroupLabel(value: string): string {
  const current = new Date()
  const target = parseDate(value)

  if (!target) {
    return '未知日期'
  }

  const todayKey = [
    current.getFullYear(),
    current.getMonth(),
    current.getDate(),
  ].join('-')
  const targetKey = [
    target.getFullYear(),
    target.getMonth(),
    target.getDate(),
  ].join('-')

  if (todayKey === targetKey) {
    return '今天'
  }

  const yesterday = new Date(current)
  yesterday.setDate(current.getDate() - 1)
  const yesterdayKey = [
    yesterday.getFullYear(),
    yesterday.getMonth(),
    yesterday.getDate(),
  ].join('-')

  if (yesterdayKey === targetKey) {
    return '昨天'
  }

  return formatYearMonthDay(target)
}
