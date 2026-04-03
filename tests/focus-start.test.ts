import assert from 'node:assert/strict'
import test from 'node:test'

import { getFocusStartSuggestion, getFocusStartTodos } from '../src/lib/focus-start.ts'
import type { AppSnapshot } from '../src/types.ts'

function buildSnapshot(): AppSnapshot {
  return {
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
      aiBaseUrl: '',
      aiApiKey: '',
      aiModelId: '',
    },
    projects: [
      {
        id: 'project-1',
        name: '产品设计',
        color: '#0071E3',
        icon: 'book',
        status: 'active',
        createdAt: '2026-04-01T00:00:00.000Z',
        archivedAt: null,
      },
      {
        id: 'project-2',
        name: '复盘整理',
        color: '#34A853',
        icon: 'spark',
        status: 'paused',
        createdAt: '2026-04-01T00:00:00.000Z',
        archivedAt: null,
      },
    ],
    todos: [
      {
        id: 'todo-1',
        projectId: 'project-1',
        title: '重构首页信息结构',
        quickStartStep: '先列出当前首页模块。',
        description: '补齐层级。',
        notes: '',
        status: 'todo',
        priority: 'high',
        estimatedPomodoros: 3,
        completedPomodoros: 0,
        dueDate: '2026-04-03',
        isToday: true,
        createdAt: '2026-04-02T00:00:00.000Z',
        completedAt: null,
      },
      {
        id: 'todo-2',
        projectId: 'project-1',
        title: '补图表说明',
        quickStartStep: '',
        description: '补图表文案。',
        notes: '',
        status: 'in_progress',
        priority: 'medium',
        estimatedPomodoros: 2,
        completedPomodoros: 0,
        dueDate: null,
        isToday: false,
        createdAt: '2026-04-01T00:00:00.000Z',
        completedAt: null,
      },
      {
        id: 'todo-3',
        projectId: 'project-2',
        title: '整理本周结论',
        quickStartStep: '先把本周记录拉出来。',
        description: '整理要点。',
        notes: '',
        status: 'todo',
        priority: 'low',
        estimatedPomodoros: 1,
        completedPomodoros: 0,
        dueDate: null,
        isToday: false,
        createdAt: '2026-04-01T00:00:00.000Z',
        completedAt: null,
      },
    ],
    sessions: [
      {
        id: 'session-1',
        projectId: 'project-1',
        todoId: 'todo-2',
        type: 'focus',
        plannedDurationSec: 1500,
        actualDurationSec: 900,
        startedAt: '2026-04-02T11:00:00.000Z',
        endedAt: '2026-04-02T11:15:00.000Z',
        result: 'interrupted',
        interruptReason: '被会议打断',
      },
    ],
  }
}

test('getFocusStartSuggestion prioritizes recently interrupted work as resume candidate', () => {
  const snapshot = buildSnapshot()
  const suggestion = getFocusStartSuggestion(snapshot, 'project-1')

  assert.equal(suggestion.todoId, 'todo-2')
  assert.equal(suggestion.isResume, true)
})

test('getFocusStartTodos falls back to today and priority ordering when there is no resume candidate', () => {
  const snapshot = buildSnapshot()
  snapshot.sessions = []

  const todos = getFocusStartTodos(snapshot, 'project-1')

  assert.deepEqual(
    todos.map((todo) => todo.id),
    ['todo-1', 'todo-2'],
  )
})

test('getFocusStartTodos keeps active projects ahead of paused projects in the global queue', () => {
  const snapshot = buildSnapshot()
  snapshot.sessions = []

  const todos = getFocusStartTodos(snapshot, null)

  assert.deepEqual(
    todos.map((todo) => todo.id),
    ['todo-1', 'todo-2', 'todo-3'],
  )
})
