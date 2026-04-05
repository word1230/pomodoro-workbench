import type { AppSnapshot, FocusSession, Priority, Project, SessionType, Todo } from '../types'

export interface DailyTrendPoint {
  dateKey: string
  label: string
  focusCount: number
  focusDurationSec: number
}

export interface ProjectMetric {
  project: Project
  focusCount: number
  focusDurationSec: number
  interruptedCount: number
  estimatedPomodoros: number
  completedPomodoros: number
  openTodos: number
  doneTodos: number
}

export interface AnalyticsBundle {
  todayFocusCount: number
  todayFocusDurationSec: number
  weekFocusCount: number
  monthFocusCount: number
  weekInterruptCount: number
  projectMetrics: ProjectMetric[]
  dailyTrend: DailyTrendPoint[]
  completionRate: number
  topProjectName: string
  topProjectColor: string
}

const priorityWeight: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2,
}

export const priorityLabels: Record<Priority, string> = {
  low: '低优先级',
  medium: '中优先级',
  high: '高优先级',
}

export const statusLabels: Record<Todo['status'], string> = {
  todo: '待开始',
  in_progress: '进行中',
  done: '已完成',
  cancelled: '已取消',
}

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds)
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds)
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

export function getRemainingPomodoros(todo: Todo): number {
  return Math.max(0, todo.estimatedPomodoros - todo.completedPomodoros)
}

export function sortTodosForFocus(todos: Todo[]): Todo[] {
  return [...todos].sort((left, right) => {
    if (left.isToday !== right.isToday) {
      return left.isToday ? -1 : 1
    }
    if (left.status !== right.status) {
      return todoStatusWeight(left.status) - todoStatusWeight(right.status)
    }
    if (left.priority !== right.priority) {
      return priorityWeight[left.priority] - priorityWeight[right.priority]
    }
    if (left.dueDate !== right.dueDate) {
      return (left.dueDate ?? '9999-12-31').localeCompare(right.dueDate ?? '9999-12-31')
    }
    return left.createdAt.localeCompare(right.createdAt)
  })
}

export function buildAnalytics(snapshot: AppSnapshot): AnalyticsBundle {
  const completedFocusSessions = snapshot.sessions.filter(
    (session): session is Extract<FocusSession, { type: 'focus' }> =>
      session.type === 'focus' && session.result === 'completed',
  )
  const interruptedFocusSessions = snapshot.sessions.filter(
    (session): session is Extract<FocusSession, { type: 'focus' }> =>
      session.type === 'focus' && session.result === 'interrupted',
  )
  const todayKey = toDateKey(new Date())
  const todayFocusSessions = completedFocusSessions.filter(
    (session) => getCompletedFocusDateKey(session) === todayKey,
  )
  const last7Keys = getTrailingDateKeys(7)
  const last30Keys = new Set(getTrailingDateKeys(30))
  const dailyTrend = last7Keys.map((dateKey) => {
    const matches = completedFocusSessions.filter(
      (session) => getCompletedFocusDateKey(session) === dateKey,
    )
    return {
      dateKey,
      label: formatTrendLabel(dateKey),
      focusCount: matches.length,
      focusDurationSec: matches.reduce((sum, session) => sum + session.actualDurationSec, 0),
    }
  })
  const projectMetrics = snapshot.projects
    .map((project) => {
      const todos = snapshot.todos.filter((todo) => todo.projectId === project.id)
      const completed = completedFocusSessions.filter((session) => session.projectId === project.id)
      const interrupted = interruptedFocusSessions.filter((session) => session.projectId === project.id)
      return {
        project,
        focusCount: completed.length,
        focusDurationSec: completed.reduce((sum, session) => sum + session.actualDurationSec, 0),
        interruptedCount: interrupted.length,
        estimatedPomodoros: todos.reduce((sum, todo) => sum + todo.estimatedPomodoros, 0),
        completedPomodoros: completed.length,
        openTodos: todos.filter((todo) => !['done', 'cancelled'].includes(todo.status)).length,
        doneTodos: todos.filter((todo) => todo.status === 'done').length,
      }
    })
    .sort((left, right) => right.focusDurationSec - left.focusDurationSec)

  const weekFocusSessions = completedFocusSessions.filter((session) =>
    last7Keys.includes(getCompletedFocusDateKey(session)),
  )
  const monthFocusSessions = completedFocusSessions.filter((session) =>
    last30Keys.has(getCompletedFocusDateKey(session)),
  )
  const weekInterruptCount = interruptedFocusSessions.filter((session) =>
    last7Keys.includes(toDateKey(session.startedAt)),
  ).length
  const totalPlanned = snapshot.todos.reduce((sum, todo) => sum + todo.estimatedPomodoros, 0)
  const totalCompleted = completedFocusSessions.length
  const topProject = projectMetrics[0]

  return {
    todayFocusCount: todayFocusSessions.length,
    todayFocusDurationSec: todayFocusSessions.reduce(
      (sum, session) => sum + session.actualDurationSec,
      0,
    ),
    weekFocusCount: weekFocusSessions.length,
    monthFocusCount: monthFocusSessions.length,
    weekInterruptCount,
    projectMetrics,
    dailyTrend,
    completionRate: totalPlanned > 0 ? Math.min(1, totalCompleted / totalPlanned) : 0,
    topProjectName: topProject?.project.name ?? '尚未开始',
    topProjectColor: topProject?.project.color ?? '#D96C4E',
  }
}

export function projectSharePercent(metric: ProjectMetric, metrics: ProjectMetric[]): number {
  const total = metrics.reduce((sum, item) => sum + item.focusDurationSec, 0)
  if (total <= 0) {
    return 0
  }
  return Math.round((metric.focusDurationSec / total) * 100)
}

export function focusSessionsForType(
  sessions: FocusSession[],
  type: SessionType,
): FocusSession[] {
  return sessions.filter((session) => session.type === type && session.result === 'completed')
}

function todoStatusWeight(status: Todo['status']): number {
  switch (status) {
    case 'in_progress':
      return 0
    case 'todo':
      return 1
    case 'done':
      return 2
    case 'cancelled':
      return 3
  }
}

function getTrailingDateKeys(days: number): string[] {
  const items: string[] = []
  for (let index = days - 1; index >= 0; index -= 1) {
    const current = new Date()
    current.setDate(current.getDate() - index)
    items.push(toDateKey(current))
  }
  return items
}

function formatTrendLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  }).format(new Date(year, month - 1, day))
}

function getCompletedFocusDateKey(session: FocusSession): string {
  const endedAtKey = toValidDateKey(session.endedAt)
  return endedAtKey ?? toDateKey(session.startedAt)
}

function toValidDateKey(value: string | Date | null): string | null {
  if (!value) {
    return null
  }
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : toDateKey(date)
}

function toDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
