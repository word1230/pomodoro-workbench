import type { Todo, TodoDraft } from '../types'

type TodoStepSource = {
  quickStartStep: string
  description: string
  steps?: string[]
  currentStepIndex?: number
}

function cleanStepList(steps: string[] | undefined): string[] {
  if (!Array.isArray(steps)) {
    return []
  }

  return steps.map((step) => step.trim()).filter(Boolean)
}

export function parseTodoSteps(value: string): string[] {
  const normalized = value.trim()
  if (!normalized) {
    return []
  }

  const lineItems = normalized
    .split(/\r?\n+/)
    .map((item) => item.replace(/^[\s\-*•\d.、)]+/, '').trim())
    .filter(Boolean)
  if (lineItems.length > 1) {
    return lineItems
  }

  const numberedItems = Array.from(
    normalized.matchAll(/(?:^|\s)\d+[.)、]\s*([^]+?)(?=(?:\s+\d+[.)、]\s)|$)/g),
  )
    .map((match) => match[1]?.trim() ?? '')
    .filter(Boolean)
  if (numberedItems.length > 1) {
    return numberedItems
  }

  return [normalized.replace(/\s+/g, ' ')]
}

export function getResolvedTodoSteps(todo: TodoStepSource): string[] {
  const explicitSteps = cleanStepList(todo.steps)
  if (explicitSteps.length) {
    return explicitSteps
  }

  return parseTodoSteps(todo.description)
}

export function clampTodoCurrentStepIndex(todo: Pick<TodoStepSource, 'description' | 'steps' | 'currentStepIndex'>): number {
  const resolvedSteps = getResolvedTodoSteps({
    quickStartStep: '',
    description: todo.description,
    steps: todo.steps,
    currentStepIndex: todo.currentStepIndex,
  })

  if (!resolvedSteps.length) {
    return 0
  }

  const rawIndex =
    typeof todo.currentStepIndex === 'number' && Number.isFinite(todo.currentStepIndex)
      ? Math.trunc(todo.currentStepIndex)
      : 0

  return Math.max(0, Math.min(rawIndex, resolvedSteps.length - 1))
}

export function getCurrentTodoStep(todo: TodoStepSource): string {
  const resolvedSteps = getResolvedTodoSteps(todo)
  if (resolvedSteps.length) {
    return resolvedSteps[clampTodoCurrentStepIndex(todo)] ?? todo.quickStartStep.trim()
  }

  return todo.quickStartStep.trim()
}

export function normalizeTodoDraft(todo: TodoDraft): TodoDraft {
  const steps = cleanStepList(todo.steps)

  return {
    ...todo,
    steps,
    currentStepIndex: clampTodoCurrentStepIndex({
      description: todo.description,
      steps,
      currentStepIndex: todo.currentStepIndex,
    }),
  }
}

export function normalizeTodo(todo: Todo): Todo {
  const steps = cleanStepList(todo.steps)

  return {
    ...todo,
    steps,
    currentStepIndex: clampTodoCurrentStepIndex({
      description: todo.description,
      steps,
      currentStepIndex: todo.currentStepIndex,
    }),
  }
}

export function buildTodoDraftFromTodo(todo: Todo, overrides: Partial<TodoDraft> = {}): TodoDraft {
  return normalizeTodoDraft({
    id: overrides.id ?? todo.id,
    projectId: overrides.projectId ?? todo.projectId,
    title: overrides.title ?? todo.title,
    quickStartStep: overrides.quickStartStep ?? todo.quickStartStep,
    description: overrides.description ?? todo.description,
    notes: overrides.notes ?? todo.notes,
    status: overrides.status ?? todo.status,
    priority: overrides.priority ?? todo.priority,
    estimatedPomodoros: overrides.estimatedPomodoros ?? todo.estimatedPomodoros,
    dueDate: overrides.dueDate ?? todo.dueDate,
    isToday: overrides.isToday ?? todo.isToday,
    steps: overrides.steps ?? todo.steps,
    currentStepIndex: overrides.currentStepIndex ?? todo.currentStepIndex,
  })
}
