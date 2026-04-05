import type {
  AppSettings,
  Todo,
  TodoActivationRelief,
  TodoAiSuggestion,
  TodoDraft,
} from '../types'
import { normalizeTodoDraft, parseTodoSteps } from './todo-steps.ts'

export function hasAiCompletionConfig(settings: AppSettings): boolean {
  return Boolean(settings.aiBaseUrl.trim() && settings.aiApiKeyConfigured && settings.aiModelId.trim())
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

    if (
      todo.quickStartStep.trim() !== suggestion.originalQuickStartStep.trim() ||
      todo.description.trim() !== suggestion.originalDescription.trim()
    ) {
      throw new Error(`任务「${todo.title}」内容已变更，请重新生成 AI 预览后再应用`)
    }

    const nextDescription = suggestion.updatedDescription.trim()
    const nextQuickStartStep = suggestion.updatedQuickStartStep.trim()
    if (!nextQuickStartStep) {
      throw new Error(`AI 未为「${todo.title}」生成有效的最简启动步骤`)
    }
    if (!nextDescription) {
      throw new Error(`AI 未为「${todo.title}」生成有效的任务上下文`)
    }

    seenTodoIds.add(suggestion.todoId)

    const previousDerivedSteps = parseTodoSteps(todo.description)
    const currentSteps = todo.steps.map((step) => step.trim()).filter(Boolean)
    const shouldRefreshDerivedSteps =
      currentSteps.length > 0 && areSameSteps(currentSteps, previousDerivedSteps)
    const nextSteps = shouldRefreshDerivedSteps ? parseTodoSteps(nextDescription) : todo.steps
    const nextCurrentStepIndex = shouldRefreshDerivedSteps
      ? alignDerivedCurrentStepIndex(todo.currentStepIndex, previousDerivedSteps, nextSteps)
      : todo.currentStepIndex

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
      steps: nextSteps,
      currentStepIndex: nextCurrentStepIndex,
    })
  })
}

function areSameSteps(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((step, index) => step === right[index])
}

function alignDerivedCurrentStepIndex(
  currentStepIndex: number,
  previousSteps: string[],
  nextSteps: string[],
): number {
  if (!previousSteps.length || !nextSteps.length) {
    return 0
  }

  const safeCurrentStepIndex = Number.isFinite(currentStepIndex) ? Math.trunc(currentStepIndex) : 0
  const clampedCurrentStepIndex = Math.max(0, Math.min(safeCurrentStepIndex, previousSteps.length - 1))
  const currentStep = previousSteps[clampedCurrentStepIndex]
  const alignedIndex = currentStep ? nextSteps.indexOf(currentStep) : -1

  return alignedIndex >= 0 ? alignedIndex : 0
}

export function shouldApplyActivationReliefResult(options: {
  requestedTodoId: string
  currentSelectedTodoId: string | null
  reliefTodoId: string
  requestId?: number
  latestRequestId?: number
}): boolean {
  const {
    requestedTodoId,
    currentSelectedTodoId,
    reliefTodoId,
    requestId,
    latestRequestId,
  } = options

  if (
    typeof requestId === 'number' &&
    typeof latestRequestId === 'number' &&
    requestId !== latestRequestId
  ) {
    return false
  }

  return currentSelectedTodoId === requestedTodoId && reliefTodoId === requestedTodoId
}

export function buildTodoActivationReliefDraft(
  todo: Todo,
  relief: TodoActivationRelief,
): TodoDraft {
  if (todo.id !== relief.todoId) {
    throw new Error('当前任务已切换，请重新生成 AI 解阻建议')
  }

  if (
    relief.originalQuickStartStep !== undefined &&
    todo.quickStartStep.trim() !== relief.originalQuickStartStep.trim()
  ) {
    throw new Error(`任务「${todo.title}」内容已变更，请重新生成 AI 解阻建议后再应用`)
  }

  if (
    relief.originalDescription !== undefined &&
    todo.description.trim() !== relief.originalDescription.trim()
  ) {
    throw new Error(`任务「${todo.title}」内容已变更，请重新生成 AI 解阻建议后再应用`)
  }

  const nextQuickStartStep = relief.quickStartStep.trim()
  const nextDescription = relief.updatedDescription.trim()
  const nextFallbackStep = relief.fallbackStep.trim()
  const normalizedFallbackStep = nextFallbackStep.replace(
    /^如果还是卡住(?:[：:]|，|,)?(?:\s*就)?\s*/,
    '',
  )

  if (!nextQuickStartStep) {
    throw new Error(`AI 未为「${todo.title}」生成有效的最简启动步骤`)
  }

  if (!nextDescription) {
    throw new Error(`AI 未为「${todo.title}」生成有效的任务上下文`)
  }

  if (!normalizedFallbackStep) {
    throw new Error(`AI 未为「${todo.title}」生成有效的备用动作`)
  }

  const mergedDescription = mergeActivationFallback(nextDescription, nextFallbackStep)

  return normalizeTodoDraft({
    id: todo.id,
    projectId: todo.projectId,
    title: todo.title,
    quickStartStep: nextQuickStartStep,
    description: mergedDescription,
    notes: todo.notes,
    status: todo.status,
    priority: todo.priority,
    estimatedPomodoros: todo.estimatedPomodoros,
    dueDate: todo.dueDate,
    isToday: todo.isToday,
    steps: todo.steps,
    currentStepIndex: getActivationReliefCurrentStepIndex(todo, nextDescription, mergedDescription),
  })
}

function getActivationReliefCurrentStepIndex(
  todo: Pick<Todo, 'description' | 'steps' | 'currentStepIndex'>,
  nextDescription: string,
  mergedDescription: string,
): number {
  const explicitSteps = Array.isArray(todo.steps)
    ? todo.steps.map((step) => step.trim()).filter(Boolean)
    : []

  if (explicitSteps.length > 0) {
    return todo.currentStepIndex
  }

  const previousDerivedSteps = parseTodoSteps(todo.description)
  const nextDerivedSteps = parseTodoSteps(nextDescription)
  const mergedDerivedSteps = parseTodoSteps(mergedDescription)
  const rawIndex =
    typeof todo.currentStepIndex === 'number' && Number.isFinite(todo.currentStepIndex)
      ? Math.trunc(todo.currentStepIndex)
      : 0
  const clampedPreviousIndex = Math.max(0, Math.min(rawIndex, previousDerivedSteps.length - 1))

  if (!previousDerivedSteps.length) {
    return todo.currentStepIndex
  }

  const currentStep = previousDerivedSteps[clampedPreviousIndex]
  const alignedIndex = currentStep ? mergedDerivedSteps.indexOf(currentStep) : -1

  if (alignedIndex >= 0 && nextDerivedSteps[clampedPreviousIndex] === currentStep) {
    return alignedIndex
  }

  return todo.currentStepIndex
}

export function mergeActivationFallback(description: string, fallbackStep: string): string {
  const nextFallbackStep = fallbackStep
    .trim()
    .replace(/^如果还是卡住(?:[：:]|，|,)?(?:\s*就)?\s*/, '')
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
