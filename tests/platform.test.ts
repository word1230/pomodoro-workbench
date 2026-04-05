import assert from 'node:assert/strict'
import test from 'node:test'

import { deleteTodo, loadSnapshot, recordFocusSession, saveSettings, showMainWindow } from '../src/lib/platform.ts'
import type { AppSnapshot, FocusSessionDraft } from '../src/types.ts'

const STORAGE_KEY = 'pomodoro-workbench:snapshot'

class MemoryStorage {
  #store = new Map<string, string>()

  getItem(key: string): string | null {
    return this.#store.has(key) ? this.#store.get(key)! : null
  }

  setItem(key: string, value: string): void {
    this.#store.set(key, value)
  }

  removeItem(key: string): void {
    this.#store.delete(key)
  }

  clear(): void {
    this.#store.clear()
  }
}

const localStorage = new MemoryStorage()

globalThis.localStorage = localStorage as unknown as Storage

test.beforeEach(() => {
  localStorage.clear()
})

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
      aiApiKeyConfigured: false,
      aiModelId: '',
    },
    projects: [
      {
        id: 'project-1',
        name: '主项目',
        color: '#0071E3',
        icon: 'book',
        status: 'active',
        createdAt: '2026-04-01T00:00:00.000Z',
        archivedAt: null,
      },
      {
        id: 'project-2',
        name: '其他项目',
        color: '#34A853',
        icon: 'spark',
        status: 'active',
        createdAt: '2026-04-01T00:00:00.000Z',
        archivedAt: null,
      },
    ],
    todos: [
      {
        id: 'todo-delete',
        projectId: 'project-1',
        title: '要删除的任务',
        quickStartStep: '先打开草稿。',
        description: '删除后不应再有历史残留。',
        notes: '',
        status: 'in_progress',
        priority: 'high',
        estimatedPomodoros: 2,
        completedPomodoros: 1,
        dueDate: null,
        isToday: true,
        steps: [],
        currentStepIndex: 0,
        createdAt: '2026-04-02T00:00:00.000Z',
        completedAt: null,
      },
      {
        id: 'todo-keep-same-project',
        projectId: 'project-1',
        title: '同项目保留任务',
        quickStartStep: '继续当前步骤。',
        description: '同项目其他 session 应保留。',
        notes: '',
        status: 'todo',
        priority: 'medium',
        estimatedPomodoros: 1,
        completedPomodoros: 0,
        dueDate: null,
        isToday: false,
        steps: [],
        currentStepIndex: 0,
        createdAt: '2026-04-02T00:00:00.000Z',
        completedAt: null,
      },
      {
        id: 'todo-keep-other-project',
        projectId: 'project-2',
        title: '跨项目保留任务',
        quickStartStep: '先确认边界。',
        description: '其他项目 session 也应保留。',
        notes: '',
        status: 'todo',
        priority: 'low',
        estimatedPomodoros: 1,
        completedPomodoros: 0,
        dueDate: null,
        isToday: false,
        steps: [],
        currentStepIndex: 0,
        createdAt: '2026-04-02T00:00:00.000Z',
        completedAt: null,
      },
    ],
    sessions: [
      {
        id: 'session-delete-1',
        projectId: 'project-1',
        todoId: 'todo-delete',
        type: 'focus',
        plannedDurationSec: 1500,
        actualDurationSec: 1500,
        startedAt: '2026-04-02T09:00:00.000Z',
        endedAt: '2026-04-02T09:25:00.000Z',
        result: 'completed',
        interruptReason: null,
      },
      {
        id: 'session-delete-2',
        projectId: 'project-1',
        todoId: 'todo-delete',
        type: 'focus',
        plannedDurationSec: 1500,
        actualDurationSec: 900,
        startedAt: '2026-04-02T10:00:00.000Z',
        endedAt: '2026-04-02T10:15:00.000Z',
        result: 'interrupted',
        interruptReason: '被打断',
      },
      {
        id: 'session-keep-same-project',
        projectId: 'project-1',
        todoId: 'todo-keep-same-project',
        type: 'focus',
        plannedDurationSec: 1500,
        actualDurationSec: 1200,
        startedAt: '2026-04-02T11:00:00.000Z',
        endedAt: '2026-04-02T11:20:00.000Z',
        result: 'completed',
        interruptReason: null,
      },
      {
        id: 'session-keep-other-project',
        projectId: 'project-2',
        todoId: 'todo-keep-other-project',
        type: 'focus',
        plannedDurationSec: 1500,
        actualDurationSec: 1500,
        startedAt: '2026-04-02T12:00:00.000Z',
        endedAt: '2026-04-02T12:25:00.000Z',
        result: 'completed',
        interruptReason: null,
      },
    ],
  }
}

test('buildSnapshot keeps public settings redacted by default', () => {
  const snapshot = buildSnapshot()

  assert.equal(snapshot.settings.aiApiKeyConfigured, false)
  assert.equal('aiApiKey' in snapshot.settings, false)
})

test('loadSnapshot recovers from invalid localStorage JSON by reseeding snapshot', async () => {
  localStorage.setItem(STORAGE_KEY, '{invalid json')

  const snapshot = await loadSnapshot()
  const persistedRaw = localStorage.getItem(STORAGE_KEY)

  assert.ok(persistedRaw)
  assert.doesNotThrow(() => JSON.parse(persistedRaw!))
  assert.equal(snapshot.projects.length > 0, true)
  assert.equal(snapshot.todos.length > 0, true)
})

test('showMainWindow swallows backend invoke failures in tauri mode', async () => {
  const originalWindow = globalThis.window
  const originalWarn = console.warn
  const warnings: unknown[][] = []

  console.warn = (...args: unknown[]) => {
    warnings.push(args)
  }
  globalThis.window = { __TAURI_INTERNALS__: {} } as Window & typeof globalThis

  try {
    await assert.doesNotReject(() => showMainWindow())
    assert.equal(warnings.length, 1)
    assert.equal(String(warnings[0]?.[0]), 'showMainWindow failed')
  } finally {
    console.warn = originalWarn
    globalThis.window = originalWindow
  }
})

test('loadSnapshot removes legacy plaintext API keys from persisted local snapshot state', async () => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...buildSnapshot(),
      settings: {
        ...buildSnapshot().settings,
        aiBaseUrl: 'https://api.example.com/v1',
        aiApiKeyConfigured: false,
        aiApiKey: 'legacy-secret',
        aiModelId: 'gpt-4.1-mini',
      },
    }),
  )

  const snapshot = await loadSnapshot()
  const persistedRaw = localStorage.getItem(STORAGE_KEY)

  assert.equal(snapshot.settings.aiApiKeyConfigured, true)
  assert.equal('aiApiKey' in snapshot.settings, false)
  assert.ok(persistedRaw)
  assert.equal(persistedRaw!.includes('legacy-secret'), false)
  assert.equal(JSON.parse(persistedRaw!).settings.aiApiKeyConfigured, true)
  assert.equal('aiApiKey' in JSON.parse(persistedRaw!).settings, false)
})

test('saveSettings does not persist plaintext API keys in public local snapshot state', async () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(buildSnapshot()))

  const snapshot = await saveSettings({
    ...buildSnapshot().settings,
    aiBaseUrl: 'https://api.example.com/v1',
    aiModelId: 'gpt-4.1-mini',
    aiApiKey: 'secret-key',
  })
  const persistedRaw = localStorage.getItem(STORAGE_KEY)

  assert.equal(snapshot.settings.aiApiKeyConfigured, true)
  assert.equal('aiApiKey' in snapshot.settings, false)
  assert.ok(persistedRaw)
  assert.equal(persistedRaw!.includes('secret-key'), false)
  assert.equal(JSON.parse(persistedRaw!).settings.aiApiKeyConfigured, true)
  assert.equal('aiApiKey' in JSON.parse(persistedRaw!).settings, false)
})

test('saveSettings preserves configured API key state when password field is submitted empty', async () => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...buildSnapshot(),
      settings: {
        ...buildSnapshot().settings,
        aiBaseUrl: 'https://api.example.com/v1',
        aiModelId: 'gpt-4.1-mini',
        aiApiKeyConfigured: true,
      },
    }),
  )

  const snapshot = await saveSettings({
    ...buildSnapshot().settings,
    aiBaseUrl: 'https://api.example.com/v1',
    aiModelId: 'gpt-4.1-mini',
    aiApiKey: '',
  })

  assert.equal(snapshot.settings.aiApiKeyConfigured, true)
  assert.equal('aiApiKey' in snapshot.settings, false)
})

test('recordFocusSession stores break sessions without fake IDs and preserves todos in localStorage mode', async () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(buildSnapshot()))

  const breakSession: FocusSessionDraft = {
    type: 'short_break',
    plannedDurationSec: 300,
    actualDurationSec: 300,
    startedAt: '2026-04-02T12:30:00.000Z',
    endedAt: '2026-04-02T12:35:00.000Z',
    result: 'completed',
    interruptReason: null,
  }

  const snapshot = await recordFocusSession(breakSession)
  const persisted = await loadSnapshot()

  assert.equal(snapshot.todos.length, buildSnapshot().todos.length)
  assert.deepEqual(
    snapshot.todos.map((todo) => ({ id: todo.id, completedPomodoros: todo.completedPomodoros, status: todo.status })),
    buildSnapshot().todos.map((todo) => ({ id: todo.id, completedPomodoros: todo.completedPomodoros, status: todo.status })),
  )
  assert.equal(snapshot.sessions[0]?.type, 'short_break')
  assert.equal('projectId' in snapshot.sessions[0]!, false)
  assert.equal('todoId' in snapshot.sessions[0]!, false)
  assert.deepEqual(persisted, snapshot)
})

test('deleteTodo removes the target todo and only its related sessions in localStorage mode', async () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(buildSnapshot()))

  const snapshot = await deleteTodo('todo-delete')
  const persisted = await loadSnapshot()

  assert.deepEqual(snapshot.todos.map((todo) => todo.id), ['todo-keep-same-project', 'todo-keep-other-project'])
  assert.deepEqual(
    snapshot.sessions.map((session) => session.id),
    ['session-keep-same-project', 'session-keep-other-project'],
  )
  assert.deepEqual(persisted, snapshot)
})
