import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildTodoActivationReliefDraft,
  buildTodoAiApplyDrafts,
  getEnhanceableTodos,
  hasAiCompletionConfig,
  mergeActivationFallback,
  pruneSelectedTodoIds,
} from '../src/lib/todo-ai.ts'
import type { AppSettings, Todo } from '../src/types.ts'

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
  aiBaseUrl: 'https://api.example.com/v1',
  aiApiKey: 'test-key',
  aiModelId: 'gpt-test',
}

const baseTodo: Todo = {
  id: 'todo-1',
  projectId: 'project-1',
  title: '整理信息架构',
  quickStartStep: '先列出当前页面。',
  description: '梳理页面层级。',
  notes: '注意保留现有导航结构。',
  status: 'todo',
  priority: 'high',
  estimatedPomodoros: 3,
  completedPomodoros: 0,
  dueDate: null,
  isToday: true,
  createdAt: '2026-04-02T00:00:00.000Z',
  completedAt: null,
}

test('hasAiCompletionConfig requires base url, api key and model id', () => {
  assert.equal(hasAiCompletionConfig(baseSettings), true)
  assert.equal(hasAiCompletionConfig({ ...baseSettings, aiApiKey: '   ' }), false)
  assert.equal(hasAiCompletionConfig({ ...baseSettings, aiBaseUrl: '' }), false)
})

test('getEnhanceableTodos only includes todo and in-progress items from the target project', () => {
  const todos: Todo[] = [
    baseTodo,
    { ...baseTodo, id: 'todo-2', status: 'in_progress' },
    { ...baseTodo, id: 'todo-3', status: 'done' },
    { ...baseTodo, id: 'todo-4', projectId: 'project-2', status: 'todo' },
  ]

  assert.deepEqual(
    getEnhanceableTodos(todos, 'project-1').map((todo) => todo.id),
    ['todo-1', 'todo-2'],
  )
})

test('pruneSelectedTodoIds removes ids that are no longer eligible', () => {
  assert.deepEqual(
    pruneSelectedTodoIds(['todo-1', 'todo-3', 'missing'], [baseTodo, { ...baseTodo, id: 'todo-3' }]),
    ['todo-1', 'todo-3'],
  )
})

test('buildTodoAiApplyDrafts preserves non-description fields while applying AI suggestions', () => {
  const drafts = buildTodoAiApplyDrafts([baseTodo], [
    {
      todoId: 'todo-1',
      title: '整理信息架构',
      originalQuickStartStep: '先列出当前页面。',
      updatedQuickStartStep: '先打开当前页面清单。',
      originalDescription: '梳理页面层级。',
      updatedDescription: '1. 归类页面。\\n2. 合并重复节点。',
    },
  ])

  assert.equal(drafts.length, 1)
  assert.deepEqual(drafts[0], {
    id: 'todo-1',
    projectId: 'project-1',
    title: '整理信息架构',
    quickStartStep: '先打开当前页面清单。',
    description: '1. 归类页面。\\n2. 合并重复节点。',
    notes: '注意保留现有导航结构。',
    status: 'todo',
    priority: 'high',
    estimatedPomodoros: 3,
    dueDate: null,
    isToday: true,
  })
})

test('buildTodoAiApplyDrafts rejects missing or duplicated todo suggestions', () => {
  assert.throws(
    () =>
      buildTodoAiApplyDrafts([baseTodo], [
        {
          todoId: 'missing',
          title: '未知代办',
          originalQuickStartStep: '',
          updatedQuickStartStep: '先确认任务边界。',
          originalDescription: '',
          updatedDescription: '再补上执行顺序。',
        },
      ]),
    /重新生成 AI 预览/,
  )

  assert.throws(
    () =>
      buildTodoAiApplyDrafts([baseTodo], [
        {
          todoId: 'todo-1',
          title: '整理信息架构',
          originalQuickStartStep: '',
          updatedQuickStartStep: '先整理当前页面。',
          originalDescription: '',
          updatedDescription: '梳理一级分组。',
        },
        {
          todoId: 'todo-1',
          title: '整理信息架构',
          originalQuickStartStep: '',
          updatedQuickStartStep: '再补充步骤。',
          originalDescription: '',
          updatedDescription: '再细化页面流转。',
        },
      ]),
    /重复的代办结果/,
  )
})

test('mergeActivationFallback keeps fallback as the first actionable line', () => {
  assert.equal(
    mergeActivationFallback('1. 梳理页面层级。', '先只列出 3 个页面'),
    '如果还是卡住：先只列出 3 个页面\n\n1. 梳理页面层级。',
  )

  assert.equal(
    mergeActivationFallback('如果还是卡住：先只列出 3 个页面\n\n1. 梳理页面层级。', '先只列出 3 个页面'),
    '如果还是卡住：先只列出 3 个页面\n\n1. 梳理页面层级。',
  )
})

test('buildTodoActivationReliefDraft updates quick start and aligned follow-up steps', () => {
  const draft = buildTodoActivationReliefDraft(baseTodo, {
    todoId: 'todo-1',
    title: '整理信息架构',
    quickStartStep: '先打开当前页面清单。',
    updatedDescription: '1. 先写下 3 个核心概念。\\n2. 再给每个概念补一个最小示例。',
    fallbackStep: '如果还是卡住，就只列出首页、列表页、详情页。',
  })

  assert.deepEqual(draft, {
    id: 'todo-1',
    projectId: 'project-1',
    title: '整理信息架构',
    quickStartStep: '先打开当前页面清单。',
    description:
      '如果还是卡住：如果还是卡住，就只列出首页、列表页、详情页。\n\n1. 先写下 3 个核心概念。\\n2. 再给每个概念补一个最小示例。',
    notes: '注意保留现有导航结构。',
    status: 'todo',
    priority: 'high',
    estimatedPomodoros: 3,
    dueDate: null,
    isToday: true,
  })
})
