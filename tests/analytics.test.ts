import assert from 'node:assert/strict'
import test from 'node:test'

import { buildAnalytics } from '../src/lib/analytics.ts'
import type { AppSnapshot, AppSettings, FocusSession, Project, Todo } from '../src/types.ts'

const baseSettings: AppSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakInterval: 4,
  autoStartBreaks: true,
  autoStartFocus: false,
  notificationsEnabled: true,
  minimizeToTray: true,
  launchOnStartup: false,
  soundEnabled: true,
  aiBaseUrl: '',
  aiApiKeyConfigured: false,
  aiModelId: '',
}

const baseProject: Project = {
  id: 'project-1',
  name: '专注统计',
  color: '#0071E3',
  icon: 'book',
  status: 'active',
  createdAt: '2026-04-01T00:00:00.000Z',
  archivedAt: null,
}

const baseTodo: Todo = {
  id: 'todo-1',
  projectId: 'project-1',
  title: '修复统计归属日期',
  quickStartStep: '先补回归测试。',
  description: '确保 completed focus 按完成时间归属。',
  notes: '',
  status: 'in_progress',
  priority: 'high',
  estimatedPomodoros: 3,
  completedPomodoros: 0,
  dueDate: null,
  isToday: true,
  steps: [],
  currentStepIndex: 0,
  createdAt: '2026-04-01T00:00:00.000Z',
  completedAt: null,
}

function buildSnapshot(sessions: FocusSession[]): AppSnapshot {
  return {
    settings: baseSettings,
    projects: [baseProject],
    todos: [baseTodo],
    sessions,
  }
}

function atLocalTime(dayOffset: number, hours: number, minutes: number): string {
  const now = new Date()
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + dayOffset,
    hours,
    minutes,
    0,
    0,
  ).toISOString()
}

function toDateKey(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

test('buildAnalytics attributes completed focus to endedAt for today and daily trend', () => {
  const analytics = buildAnalytics(
    buildSnapshot([
      {
        id: 'session-cross-day',
        projectId: 'project-1',
        todoId: 'todo-1',
        type: 'focus',
        plannedDurationSec: 1500,
        actualDurationSec: 1200,
        startedAt: atLocalTime(-1, 23, 50),
        endedAt: atLocalTime(0, 0, 10),
        result: 'completed',
        interruptReason: null,
      },
    ]),
  )

  const todayKey = toDateKey(new Date())
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayKey = toDateKey(yesterday)
  const trendMap = new Map(analytics.dailyTrend.map((point) => [point.dateKey, point]))

  assert.equal(analytics.todayFocusCount, 1)
  assert.equal(analytics.todayFocusDurationSec, 1200)
  assert.equal(trendMap.get(todayKey)?.focusCount, 1)
  assert.equal(trendMap.get(yesterdayKey)?.focusCount, 0)
})

test('buildAnalytics includes completed focus sessions in week and month windows by endedAt', () => {
  const analytics = buildAnalytics(
    buildSnapshot([
      {
        id: 'session-week-boundary',
        projectId: 'project-1',
        todoId: 'todo-1',
        type: 'focus',
        plannedDurationSec: 1500,
        actualDurationSec: 1200,
        startedAt: atLocalTime(-7, 23, 50),
        endedAt: atLocalTime(-6, 0, 10),
        result: 'completed',
        interruptReason: null,
      },
      {
        id: 'session-month-boundary',
        projectId: 'project-1',
        todoId: 'todo-1',
        type: 'focus',
        plannedDurationSec: 1500,
        actualDurationSec: 1500,
        startedAt: atLocalTime(-30, 23, 50),
        endedAt: atLocalTime(-29, 0, 10),
        result: 'completed',
        interruptReason: null,
      },
    ]),
  )

  assert.equal(analytics.weekFocusCount, 1)
  assert.equal(analytics.monthFocusCount, 2)
})

test('buildAnalytics falls back to startedAt when endedAt is missing or invalid', () => {
  const analytics = buildAnalytics(
    buildSnapshot([
      {
        id: 'session-missing-ended-at',
        projectId: 'project-1',
        todoId: 'todo-1',
        type: 'focus',
        plannedDurationSec: 1500,
        actualDurationSec: 900,
        startedAt: atLocalTime(0, 9, 0),
        endedAt: null,
        result: 'completed',
        interruptReason: null,
      },
      {
        id: 'session-invalid-ended-at',
        projectId: 'project-1',
        todoId: 'todo-1',
        type: 'focus',
        plannedDurationSec: 1500,
        actualDurationSec: 600,
        startedAt: atLocalTime(0, 11, 0),
        endedAt: 'not-a-date',
        result: 'completed',
        interruptReason: null,
      },
    ]),
  )

  assert.equal(analytics.todayFocusCount, 2)
})
