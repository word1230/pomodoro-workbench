import type { Todo, TodoDraft } from '../types'

type TodoStepSource = {
  quickStartStep: string
  description: string
  steps?: string[]
  currentStepIndex?: number
}

function stripLeadingListMarker(item: string): string {
  return item
    .replace(/^\s*(?:[-*•]\s+|\d+[.)、]\s*)/, '')
    .trim()
}

function parseMultilineListItems(lines: string[]): string[] | null {
  if (lines.length < 2) {
    return null
  }

  if (lines.every((line) => /^\s*[-*•]\s+/.test(line))) {
    return lines.map((line) => stripLeadingListMarker(line)).filter(Boolean)
  }

  const numberedMatches = lines.map((line) => line.match(/^\s*(\d+)([.)、])\s*(.+)$/))
  if (!numberedMatches.every(Boolean)) {
    return null
  }

  const firstMarker = numberedMatches[0]?.[2]
  const isSequentialList = numberedMatches.every(
    (match, index) => Number(match?.[1]) === index + 1 && match?.[2] === firstMarker,
  )
  if (!isSequentialList) {
    return null
  }

  return numberedMatches.map((match) => match?.[3]?.trim() ?? '').filter(Boolean)
}

function findFirstMultilineListIndex(lines: string[]): number {
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (parseMultilineListItems(lines.slice(index))?.length) {
      return index
    }
  }

  return -1
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
    .map((item) => item.trim())
    .filter(Boolean)

  if (lineItems.length > 1) {
    const firstListItemIndex = findFirstMultilineListIndex(lineItems)

    if (firstListItemIndex === 0) {
      const multilineListItems = parseMultilineListItems(lineItems)
      if (multilineListItems?.length) {
        return multilineListItems
      }
    }

    if (firstListItemIndex > 0) {
      const leadingItems = lineItems.slice(0, firstListItemIndex)
      const trailingListItems = parseMultilineListItems(lineItems.slice(firstListItemIndex))
      if (trailingListItems?.length) {
        return [...leadingItems, ...trailingListItems]
      }
    }

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
