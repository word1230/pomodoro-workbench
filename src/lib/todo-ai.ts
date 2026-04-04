import type {
  AppSettings,
  Todo,
  TodoActivationRelief,
  TodoAiSuggestion,
  TodoDraft,
} from '../types'
import { normalizeTodoDraft } from './todo-steps'

export function hasAiCompletionConfig(settings: AppSettings): boolean {
  return Boolean(settings.aiBaseUrl.trim() && settings.aiApiKey.trim() && settings.aiModelId.trim())
}

export function getEnhanceableTodos(todos: Todo[], projectId: string): Todo[] {
  return todos.filter(
    (todo) => todo.projectId === projectId && (todo.status === 'todo' || todo.status === 'in_progress'),
  )
}

export function pruneSelectedTodoIds(selectedTodoIds: string[], todos: Todo[]): string[] {
  const validTodoIds = new Set(todos.map((todo) => todo.id))
  return selectedTodoIds.filter((todoId) => validTodoIds.has(todoId))
}

export function buildTodoAiApplyDrafts(todos: Todo[], suggestions: TodoAiSuggestion[]): TodoDraft[] {
  const todoMap = new Map(todos.map((todo) => [todo.id, todo]))
  const seenTodoIds = new Set<string>()

  return suggestions.map((suggestion) => {
    if (seenTodoIds.has(suggestion.todoId)) {
      throw new Error('AI 预览中存在重复的代办结果，请重新生成')
    }

    const todo = todoMap.get(suggestion.todoId)
    if (!todo) {
      throw new Error('有代办已被修改或删除，请重新生成 AI 预览')
    }

    const nextDescription = suggestion.updatedDescription.trim()
    const nextQuickStartStep = suggestion.updatedQuickStartStep.trim()
    if (!nextQuickStartStep) {
      throw new Error(`AI 未为「${todo.title}」生成有效的最简启动步骤`)
    }
    if (!nextDescription) {
      throw new Error(`AI 未为「${todo.title}」生成有效描述`)
    }

    seenTodoIds.add(suggestion.todoId)

    return normalizeTodoDraft({
      id: todo.id,
      projectId: todo.projectId,
      title: todo.title,
      quickStartStep: nextQuickStartStep,
      description: nextDescription,
      notes: todo.notes,
      status: todo.status,
      priority: todo.priority,
      estimatedPomodoros: todo.estimatedPomodoros,
      dueDate: todo.dueDate,
      isToday: todo.isToday,
      steps: todo.steps,
      currentStepIndex: 0,
    })
  })
}

export function buildTodoActivationReliefDraft(
  todo: Todo,
  relief: TodoActivationRelief,
): TodoDraft {
  if (todo.id !== relief.todoId) {
    throw new Error('当前任务已切换，请重新生成 AI 解阻建议')
  }

  const nextQuickStartStep = relief.quickStartStep.trim()
  const nextDescription = relief.updatedDescription.trim()
  const nextFallbackStep = relief.fallbackStep.trim()

  if (!nextQuickStartStep) {
    throw new Error(`AI 未为「${todo.title}」生成有效的最简启动步骤`)
  }

  if (!nextDescription) {
    throw new Error(`AI 未为「${todo.title}」生成有效的后续推进步骤`)
  }

  if (!nextFallbackStep) {
    throw new Error(`AI 未为「${todo.title}」生成有效的备用动作`)
  }

  return normalizeTodoDraft({
    id: todo.id,
    projectId: todo.projectId,
    title: todo.title,
    quickStartStep: nextQuickStartStep,
    description: mergeActivationFallback(nextDescription, nextFallbackStep),
    notes: todo.notes,
    status: todo.status,
    priority: todo.priority,
    estimatedPomodoros: todo.estimatedPomodoros,
    dueDate: todo.dueDate,
    isToday: todo.isToday,
    steps: todo.steps,
    currentStepIndex: todo.currentStepIndex,
  })
}

export function mergeActivationFallback(description: string, fallbackStep: string): string {
  const nextFallbackStep = fallbackStep
    .trim()
    .replace(/^如果还是卡住[：:]\s*/, '')
  const currentDescription = description.trim()
  const fallbackLine = `如果还是卡住：${nextFallbackStep}`

  if (!currentDescription) {
    return fallbackLine
  }

  if (currentDescription.startsWith(fallbackLine)) {
    return currentDescription
  }

  return `${fallbackLine}\n\n${currentDescription}`
}
