export type PageId = 'focus' | 'manage' | 'stats'
export type ProjectStatus = 'active' | 'paused' | 'archived'
export type TodoStatus = 'todo' | 'in_progress' | 'done' | 'cancelled'
export type Priority = 'low' | 'medium' | 'high'
export type SessionType = 'focus' | 'short_break' | 'long_break'
export type SessionResult = 'completed' | 'interrupted' | 'skipped'

export interface Project {
  id: string
  name: string
  color: string
  icon: string
  status: ProjectStatus
  createdAt: string
  archivedAt: string | null
}

export interface Todo {
  id: string
  projectId: string
  title: string
  description: string
  notes: string
  status: TodoStatus
  priority: Priority
  estimatedPomodoros: number
  completedPomodoros: number
  dueDate: string | null
  isToday: boolean
  createdAt: string
  completedAt: string | null
}

export interface FocusSession {
  id: string
  projectId: string
  todoId: string
  type: SessionType
  plannedDurationSec: number
  actualDurationSec: number
  startedAt: string
  endedAt: string | null
  result: SessionResult
  interruptReason: string | null
}

export interface AppSettings {
  focusMinutes: number
  shortBreakMinutes: number
  longBreakMinutes: number
  longBreakInterval: number
  autoStartBreaks: boolean
  autoStartFocus: boolean
  notificationsEnabled: boolean
  minimizeToTray: boolean
  launchOnStartup: boolean
  soundEnabled: boolean
}

export interface AppSnapshot {
  settings: AppSettings
  projects: Project[]
  todos: Todo[]
  sessions: FocusSession[]
}

export interface ProjectDraft {
  id?: string
  name: string
  color: string
  icon: string
  status: ProjectStatus
}

export interface TodoDraft {
  id?: string
  projectId: string
  title: string
  description: string
  notes: string
  status: TodoStatus
  priority: Priority
  estimatedPomodoros: number
  dueDate: string | null
  isToday: boolean
}

export interface FocusSessionDraft {
  projectId: string
  todoId: string
  type: SessionType
  plannedDurationSec: number
  actualDurationSec: number
  startedAt: string
  endedAt: string | null
  result: SessionResult
  interruptReason: string | null
}

export interface TimerState {
  phase: 'idle' | SessionType
  running: boolean
  remainingSec: number
  targetPomodoros: number
  completedPomodoros: number
  todoId: string | null
  projectId: string | null
  phaseStartedAt: string | null
}
