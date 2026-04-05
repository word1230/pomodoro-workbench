import type { AppSnapshot, Priority, Project, Todo } from '../types'

const priorityWeight: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2,
}

export interface FocusStartSuggestion {
  todoId: string | null
  isResume: boolean
  reason: string
}

export function getFocusStartTodos(snapshot: AppSnapshot, projectId: string | null): Todo[] {
  const projectMap = new Map(snapshot.projects.map((project) => [project.id, project]))
  const resumeTodoId = getResumeTodoId(snapshot, projectId)

  return snapshot.todos
    .filter((todo) => isLaunchableTodo(todo, projectMap.get(todo.projectId), projectId))
    .sort((left, right) => compareFocusStartTodo(left, right, projectMap, resumeTodoId))
}

export function getFocusStartSuggestion(
  snapshot: AppSnapshot,
  projectId: string | null,
): FocusStartSuggestion {
  const todos = getFocusStartTodos(snapshot, projectId)
  const todo = todos[0]
  if (!todo) {
    return {
      todoId: null,
      isResume: false,
      reason: '当前没有可直接开工的任务',
    }
  }

  const resumeTodoId = getResumeTodoId(snapshot, projectId)
  if (todo.id === resumeTodoId) {
    return {
      todoId: todo.id,
      isResume: true,
      reason: '继续刚才那件事，最容易马上找回状态',
    }
  }

  if (todo.isToday) {
    return {
      todoId: todo.id,
      isResume: false,
      reason: '它已经进入今天清单，最适合先动起来',
    }
  }

  if (todo.priority === 'high') {
    return {
      todoId: todo.id,
      isResume: false,
      reason: '这是当前最重要的高优先级任务',
    }
  }

  if (todo.quickStartStep.trim()) {
    return {
      todoId: todo.id,
      isResume: false,
      reason: '它已经有最简启动步骤，开始阻力最低',
    }
  }

  return {
    todoId: todo.id,
    isResume: false,
    reason: '它的体量更小，更适合作为当前启动点',
  }
}

function getResumeTodoId(snapshot: AppSnapshot, projectId: string | null): string | null {
  const projectMap = new Map(snapshot.projects.map((project) => [project.id, project]))
  const launchableTodoIds = new Set(
    snapshot.todos
      .filter((todo) => isLaunchableTodo(todo, projectMap.get(todo.projectId), projectId))
      .map((todo) => todo.id),
  )

  const focusSessions = [...snapshot.sessions]
    .filter(
      (session): session is Extract<(typeof snapshot.sessions)[number], { type: 'focus' }> =>
        session.type === 'focus' && launchableTodoIds.has(session.todoId),
    )
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))

  const recentResumableSession = focusSessions.find(
    (session) => session.result === 'interrupted' || session.result === 'completed',
  )

  return recentResumableSession?.todoId ?? null
}

function compareFocusStartTodo(
  left: Todo,
  right: Todo,
  projectMap: Map<string, Project>,
  resumeTodoId: string | null,
): number {
  if (left.id === resumeTodoId || right.id === resumeTodoId) {
    return left.id === resumeTodoId ? -1 : 1
  }

  const leftProject = projectMap.get(left.projectId)
  const rightProject = projectMap.get(right.projectId)
  if (leftProject?.status !== rightProject?.status) {
    return projectStatusWeight(leftProject?.status) - projectStatusWeight(rightProject?.status)
  }

  if (left.isToday !== right.isToday) {
    return left.isToday ? -1 : 1
  }

  if (left.priority !== right.priority) {
    return priorityWeight[left.priority] - priorityWeight[right.priority]
  }

  const leftHasQuickStart = Boolean(left.quickStartStep.trim())
  const rightHasQuickStart = Boolean(right.quickStartStep.trim())
  if (leftHasQuickStart !== rightHasQuickStart) {
    return leftHasQuickStart ? -1 : 1
  }

  if (left.estimatedPomodoros !== right.estimatedPomodoros) {
    return left.estimatedPomodoros - right.estimatedPomodoros
  }

  if (left.dueDate !== right.dueDate) {
    return (left.dueDate ?? '9999-12-31').localeCompare(right.dueDate ?? '9999-12-31')
  }

  return left.createdAt.localeCompare(right.createdAt)
}

function isLaunchableTodo(todo: Todo, project: Project | undefined, projectId: string | null): boolean {
  if (!project || project.status === 'archived') {
    return false
  }

  if (projectId && todo.projectId !== projectId) {
    return false
  }

  return todo.status === 'todo' || todo.status === 'in_progress'
}

function projectStatusWeight(status: Project['status'] | undefined): number {
  switch (status) {
    case 'active':
      return 0
    case 'paused':
      return 1
    case 'archived':
      return 2
    default:
      return 3
  }
}
