import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AI_REVIEW_MINIMUM_FOCUS_SESSIONS,
  buildAiReviewDraftTitle,
  formatAiReviewScopeLabel,
  formatAiReviewTimeframeLabel,
  getAiReviewEligibility,
  sortAiReviews,
} from '../src/lib/ai-review.ts'
import type { AiReviewRecord, AppSnapshot } from '../src/types.ts'

const baseSnapshot: AppSnapshot = {
  settings: {
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
    aiBaseUrl: 'https://api.example.com/v1',
    aiApiKeyConfigured: true,
    aiModelId: 'gpt-test',
  },
  projects: [
    {
      id: 'project-1',
      name: '项目一',
      color: '#0071E3',
      icon: 'book',
      status: 'active',
      createdAt: '2026-04-01T00:00:00.000Z',
      archivedAt: null,
    },
  ],
  todos: [
    {
      id: 'todo-1',
      projectId: 'project-1',
      title: '整理信息架构',
      quickStartStep: '先列页面',
      description: '梳理层级',
      notes: '',
      status: 'in_progress',
      priority: 'high',
      estimatedPomodoros: 3,
      completedPomodoros: 1,
      dueDate: null,
      isToday: true,
      createdAt: '2026-04-01T00:00:00.000Z',
      completedAt: null,
    },
  ],
  sessions: Array.from({ length: AI_REVIEW_MINIMUM_FOCUS_SESSIONS }, (_, index) => ({
    id: `session-${index}`,
    projectId: 'project-1',
    todoId: 'todo-1',
    type: 'focus' as const,
    plannedDurationSec: 1500,
    actualDurationSec: 1500,
    startedAt: `2026-04-0${index + 1}T10:00:00.000Z`,
    endedAt: `2026-04-0${index + 1}T10:25:00.000Z`,
    result: 'completed' as const,
    interruptReason: null,
  })),
}

test('getAiReviewEligibility requires enough recent completed focus sessions', () => {
  const truncated = {
    ...baseSnapshot,
    sessions: baseSnapshot.sessions.slice(0, 2),
  }

  const result = getAiReviewEligibility(truncated, 'project-1', new Date('2026-04-07T12:00:00.000Z'))
  assert.equal(result.canGenerate, false)
  assert.match(result.reason ?? '', /至少完成/)
})

test('getAiReviewEligibility passes when current scope has enough data', () => {
  const result = getAiReviewEligibility(baseSnapshot, 'project-1', new Date('2026-04-07T12:00:00.000Z'))
  assert.equal(result.canGenerate, true)
  assert.equal(result.reason, null)
})

test('getAiReviewEligibility excludes sessions completed on the calendar day before the trailing 7-day window', () => {
  const boundarySnapshot = {
    ...baseSnapshot,
    sessions: [
      ...baseSnapshot.sessions.slice(0, AI_REVIEW_MINIMUM_FOCUS_SESSIONS - 1),
      {
        ...baseSnapshot.sessions[0],
        id: 'session-before-window',
        startedAt: new Date(2026, 2, 31, 23, 30, 0, 0).toISOString(),
        endedAt: new Date(2026, 2, 31, 23, 55, 0, 0).toISOString(),
      },
    ],
  }

  const result = getAiReviewEligibility(boundarySnapshot, 'project-1', new Date('2026-04-07T12:00:00.000Z'))

  assert.equal(result.canGenerate, false)
  assert.equal(result.focusCount, AI_REVIEW_MINIMUM_FOCUS_SESSIONS - 1)
})

test('getAiReviewEligibility still passes when todos in scope no longer exist', () => {
  const snapshotWithoutTodos = {
    ...baseSnapshot,
    todos: [],
  }

  const result = getAiReviewEligibility(snapshotWithoutTodos, 'project-1', new Date('2026-04-07T12:00:00.000Z'))
  assert.equal(result.canGenerate, true)
  assert.equal(result.reason, null)
})

test('getAiReviewEligibility counts sessions when completed focus has null endedAt', () => {
  const sessionWithNullEnd = {
    ...baseSnapshot.sessions[0],
    id: 'session-null-ended-at',
    startedAt: '2026-04-07T11:40:00.000Z',
    endedAt: null,
  }
  const snapshotWithNullEndedAt = {
    ...baseSnapshot,
    sessions: [sessionWithNullEnd, ...baseSnapshot.sessions.slice(1)],
  }

  const result = getAiReviewEligibility(snapshotWithNullEndedAt, 'project-1', new Date('2026-04-07T12:00:00.000Z'))
  assert.equal(result.canGenerate, true)
  assert.equal(result.focusCount, AI_REVIEW_MINIMUM_FOCUS_SESSIONS)
})

test('format review labels uses scope and timeframe', () => {
  assert.equal(formatAiReviewScopeLabel({ scope: 'all', projectName: null }), '全部项目')
  assert.equal(formatAiReviewScopeLabel({ scope: 'project', projectName: '项目一' }), '项目：项目一')
  assert.equal(formatAiReviewTimeframeLabel('last_7_days'), '近 7 天')
  assert.equal(buildAiReviewDraftTitle('项目一'), 'AI 复盘 · 项目一')
})

test('sortAiReviews keeps newest records first', () => {
  const records: AiReviewRecord[] = [
    {
      id: 'older',
      scope: 'all',
      projectId: null,
      projectName: null,
      timeframe: 'last_7_days',
      createdAt: '2026-04-01T00:00:00.000Z',
      summary: ['older'],
      issues: ['older'],
      suggestions: ['older'],
    },
    {
      id: 'newer',
      scope: 'project',
      projectId: 'project-1',
      projectName: '项目一',
      timeframe: 'last_7_days',
      createdAt: '2026-04-02T00:00:00.000Z',
      summary: ['newer'],
      issues: ['newer'],
      suggestions: ['newer'],
    },
  ]

  assert.deepEqual(
    sortAiReviews(records).map((record) => record.id),
    ['newer', 'older'],
  )
})
