import assert from 'node:assert/strict'
import test from 'node:test'

import { getCurrentTodoStep } from '../src/lib/todo-steps.ts'
import {
  buildTodoActivationReliefDraft,
  buildTodoAiApplyDrafts,
  getEnhanceableTodos,
  hasAiCompletionConfig,
  mergeActivationFallback,
  pruneSelectedTodoIds,
  shouldApplyActivationReliefResult,
} from '../src/lib/todo-ai.ts'
import type { AppSettings, SaveAppSettingsInput, Todo } from '../src/types.ts'

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
  aiApiKeyConfigured: true,
  aiModelId: 'gpt-test',
}

const baseSaveSettings: SaveAppSettingsInput = {
  ...baseSettings,
  aiApiKey: 'test-key',
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
  steps: [],
  currentStepIndex: 0,
  createdAt: '2026-04-02T00:00:00.000Z',
  completedAt: null,
}

test('hasAiCompletionConfig requires base url, configured api key and model id', () => {
  assert.equal(hasAiCompletionConfig(baseSettings), true)
  assert.equal(hasAiCompletionConfig({ ...baseSettings, aiApiKeyConfigured: false }), false)
  assert.equal(hasAiCompletionConfig({ ...baseSettings, aiBaseUrl: '' }), false)
})

test('save settings payload can carry a replacement API key without exposing it in public settings', () => {
  assert.equal(baseSaveSettings.aiApiKey, 'test-key')
  assert.equal(baseSettings.aiApiKeyConfigured, true)
  assert.equal('aiApiKey' in baseSettings, false)
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
    steps: [],
    currentStepIndex: 0,
  })
})

test('buildTodoAiApplyDrafts rejects stale previews when todo content changed after generation', () => {
  assert.throws(
    () =>
      buildTodoAiApplyDrafts(
        [
          {
            ...baseTodo,
            quickStartStep: '先打开新的页面清单。',
          },
        ],
        [
          {
            todoId: 'todo-1',
            title: '整理信息架构',
            originalQuickStartStep: '先列出当前页面。',
            updatedQuickStartStep: '先打开当前页面清单。',
            originalDescription: '梳理页面层级。',
            updatedDescription: '1. 归类页面。\\n2. 合并重复节点。',
          },
        ],
      ),
    /重新生成 AI 预览/,
  )

  assert.throws(
    () =>
      buildTodoAiApplyDrafts(
        [
          {
            ...baseTodo,
            description: '先补充新的上下文。',
          },
        ],
        [
          {
            todoId: 'todo-1',
            title: '整理信息架构',
            originalQuickStartStep: '先列出当前页面。',
            updatedQuickStartStep: '先打开当前页面清单。',
            originalDescription: '梳理页面层级。',
            updatedDescription: '1. 归类页面。\\n2. 合并重复节点。',
          },
        ],
      ),
    /重新生成 AI 预览/,
  )
})

test('buildTodoAiApplyDrafts refreshes stale derived steps from the AI-updated description', () => {
  const drafts = buildTodoAiApplyDrafts(
    [
      {
        ...baseTodo,
        description: '1. 收集当前问题\n2. 写出一个最小复现\n3. 记录阻塞点',
        steps: ['收集当前问题', '写出一个最小复现', '记录阻塞点'],
        currentStepIndex: 1,
      },
    ],
    [
      {
        todoId: 'todo-1',
        title: '整理信息架构',
        originalQuickStartStep: '先列出当前页面。',
        updatedQuickStartStep: '先把当前问题写成一句话。',
        originalDescription: '1. 收集当前问题\n2. 写出一个最小复现\n3. 记录阻塞点',
        updatedDescription: '1. 写出一个最小复现\n2. 记录阻塞点\n3. 整理下一步',
      },
    ],
  )

  assert.deepEqual(drafts[0]?.steps, ['写出一个最小复现', '记录阻塞点', '整理下一步'])
  assert.equal(drafts[0]?.currentStepIndex, 0)
})

test('buildTodoAiApplyDrafts preserves explicit custom steps when applying AI suggestions', () => {
  const drafts = buildTodoAiApplyDrafts(
    [
      {
        ...baseTodo,
        description: '1. 收集当前问题\n2. 写出一个最小复现\n3. 记录阻塞点',
        steps: ['先联系设计同学确认范围', '再更新流程图'],
        currentStepIndex: 1,
      },
    ],
    [
      {
        todoId: 'todo-1',
        title: '整理信息架构',
        originalQuickStartStep: '先列出当前页面。',
        updatedQuickStartStep: '先把当前问题写成一句话。',
        originalDescription: '1. 收集当前问题\n2. 写出一个最小复现\n3. 记录阻塞点',
        updatedDescription: '1. 写出一个最小复现\n2. 记录阻塞点\n3. 整理下一步',
      },
    ],
  )

  assert.deepEqual(drafts[0]?.steps, ['先联系设计同学确认范围', '再更新流程图'])
  assert.equal(drafts[0]?.currentStepIndex, 1)
})

test('buildTodoAiApplyDrafts preserves current step progress when applying AI suggestions', () => {
  const drafts = buildTodoAiApplyDrafts(
    [
      {
        ...baseTodo,
        steps: ['归类页面', '合并重复节点', '补充导航说明'],
        currentStepIndex: 2,
      },
    ],
    [
      {
        todoId: 'todo-1',
        title: '整理信息架构',
        originalQuickStartStep: '先列出当前页面。',
        updatedQuickStartStep: '先打开当前页面清单。',
        originalDescription: '梳理页面层级。',
        updatedDescription: '1. 归类页面。\\n2. 合并重复节点。',
      },
    ],
  )

  assert.equal(drafts[0]?.currentStepIndex, 2)
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
          originalQuickStartStep: '先列出当前页面。',
          updatedQuickStartStep: '先整理当前页面。',
          originalDescription: '梳理页面层级。',
          updatedDescription: '梳理一级分组。',
        },
        {
          todoId: 'todo-1',
          title: '整理信息架构',
          originalQuickStartStep: '先列出当前页面。',
          updatedQuickStartStep: '再补充步骤。',
          originalDescription: '梳理页面层级。',
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

  assert.equal(
    mergeActivationFallback('1. 梳理页面层级。', '如果还是卡住，就只列出首页、列表页、详情页。'),
    '如果还是卡住：只列出首页、列表页、详情页。\n\n1. 梳理页面层级。',
  )
})

test('buildTodoActivationReliefDraft rejects fallback steps that only contain the blocker prefix', () => {
  for (const fallbackStep of ['如果还是卡住：', '如果还是卡住，就', '如果还是卡住, 就']) {
    assert.throws(
      () =>
        buildTodoActivationReliefDraft(baseTodo, {
          todoId: 'todo-1',
          title: '整理信息架构',
          quickStartStep: '先打开当前页面清单。',
          updatedDescription: '1. 先写下 3 个核心概念。\\n2. 再给每个概念补一个最小示例。',
          fallbackStep,
        }),
      /有效的备用动作/,
    )
  }
})

test('buildTodoActivationReliefDraft rejects stale relief when todo content changed after generation', () => {
  assert.throws(
    () =>
      buildTodoActivationReliefDraft(
        {
          ...baseTodo,
          description: '先补充最新的任务背景。',
        },
        {
          todoId: 'todo-1',
          title: '整理信息架构',
          quickStartStep: '先打开当前页面清单。',
          updatedDescription: '1. 先写下 3 个核心概念。\\n2. 再给每个概念补一个最小示例。',
          fallbackStep: '如果还是卡住，就只列出首页、列表页、详情页。',
          originalQuickStartStep: '先列出当前页面。',
          originalDescription: '梳理页面层级。',
        },
      ),
    /重新生成 AI 解阻建议/,
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
      '如果还是卡住：只列出首页、列表页、详情页。\n\n1. 先写下 3 个核心概念。\\n2. 再给每个概念补一个最小示例。',
    notes: '注意保留现有导航结构。',
    status: 'todo',
    priority: 'high',
    estimatedPomodoros: 3,
    dueDate: null,
    isToday: true,
    steps: [],
    currentStepIndex: 0,
  })
})

test('buildTodoActivationReliefDraft preserves derived current step when fallback prepends description-only first step', () => {
  const todo = {
    ...baseTodo,
    description: '1. 收集当前问题\n2. 写出一个最小复现\n3. 记录阻塞点',
    currentStepIndex: 0,
  }

  const draft = buildTodoActivationReliefDraft(todo, {
    todoId: 'todo-1',
    title: '整理信息架构',
    quickStartStep: '先把当前问题写成一句话。',
    updatedDescription: '1. 收集当前问题\n2. 写出一个最小复现\n3. 记录阻塞点',
    fallbackStep: '如果还是卡住，就先只写出一个最小复现的输入和输出。',
  })

  assert.equal(getCurrentTodoStep(todo), '收集当前问题')
  assert.equal(draft.currentStepIndex, 1)
  assert.equal(getCurrentTodoStep(draft), '收集当前问题')
})

test('shouldApplyActivationReliefResult only accepts results for the same selected todo', () => {
  assert.equal(
    shouldApplyActivationReliefResult({
      requestedTodoId: 'todo-1',
      currentSelectedTodoId: 'todo-1',
      reliefTodoId: 'todo-1',
    }),
    true,
  )

  assert.equal(
    shouldApplyActivationReliefResult({
      requestedTodoId: 'todo-1',
      currentSelectedTodoId: 'todo-2',
      reliefTodoId: 'todo-1',
    }),
    false,
  )

  assert.equal(
    shouldApplyActivationReliefResult({
      requestedTodoId: 'todo-1',
      currentSelectedTodoId: 'todo-1',
      reliefTodoId: 'todo-2',
    }),
    false,
  )
})

test('shouldApplyActivationReliefResult rejects stale request ids even when todo ids still match', () => {
  assert.equal(
    shouldApplyActivationReliefResult({
      requestedTodoId: 'todo-1',
      currentSelectedTodoId: 'todo-1',
      reliefTodoId: 'todo-1',
      requestId: 1,
      latestRequestId: 2,
    }),
    false,
  )
})
