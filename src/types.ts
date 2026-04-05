export type PageId = 'focus' | 'manage' | 'stats'
export type ProjectStatus = 'active' | 'paused' | 'archived'
export type TodoStatus = 'todo' | 'in_progress' | 'done' | 'cancelled'
export type Priority = 'low' | 'medium' | 'high'
export type SessionType = 'focus' | 'short_break' | 'long_break'
export type SessionResult = 'completed' | 'interrupted' | 'skipped'
export type AiReviewScope = 'all' | 'project'
export type AiReviewTimeframe = 'last_7_days'
export type ActivationBlockReason =
  | 'unclear_start'
  | 'task_too_big'
  | 'details_too_fuzzy'
  | 'context_switch'
export type TodoActivationReliefMode = 'initial' | 'need_smaller' | 'need_alternative'

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
  quickStartStep: string
  description: string
  notes: string
  status: TodoStatus
  priority: Priority
  estimatedPomodoros: number
  completedPomodoros: number
  dueDate: string | null
  isToday: boolean
  steps: string[]
  currentStepIndex: number
  createdAt: string
  completedAt: string | null
}

export interface FocusWorkSession {
  id: string
  projectId: string
  todoId: string
  type: 'focus'
  plannedDurationSec: number
  actualDurationSec: number
  startedAt: string
  endedAt: string | null
  result: SessionResult
  interruptReason: string | null
}

export interface BreakSession {
  id: string
  type: 'short_break' | 'long_break'
  plannedDurationSec: number
  actualDurationSec: number
  startedAt: string
  endedAt: string | null
  result: SessionResult
  interruptReason: string | null
}

export type FocusSession = FocusWorkSession | BreakSession

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
  aiBaseUrl: string
  aiApiKeyConfigured: boolean
  aiModelId: string
}

export interface SaveAppSettingsInput extends AppSettings {
  aiApiKey: string
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
  quickStartStep: string
  description: string
  notes: string
  status: TodoStatus
  priority: Priority
  estimatedPomodoros: number
  dueDate: string | null
  isToday: boolean
  steps: string[]
  currentStepIndex: number
}

export interface FocusWorkSessionDraft {
  projectId: string
  todoId: string
  type: 'focus'
  plannedDurationSec: number
  actualDurationSec: number
  startedAt: string
  endedAt: string | null
  result: SessionResult
  interruptReason: string | null
}

export interface BreakSessionDraft {
  type: 'short_break' | 'long_break'
  plannedDurationSec: number
  actualDurationSec: number
  startedAt: string
  endedAt: string | null
  result: SessionResult
  interruptReason: string | null
}

export type FocusSessionDraft = FocusWorkSessionDraft | BreakSessionDraft

export interface TimerState {
  phase: 'idle' | SessionType
  running: boolean
  remainingSec: number
  plannedDurationSec: number
  targetPomodoros: number
  completedPomodoros: number
  todoId: string | null
  projectId: string | null
  phaseStartedAt: string | null
  deadlineAt: string | null
}

export interface ActivationSession {
  running: boolean
  remainingSec: number
  todoId: string | null
  projectId: string | null
  startedAt: string | null
  deadlineAt: string | null
}

export interface TodoAiSuggestion {
  todoId: string
  title: string
  originalQuickStartStep: string
  updatedQuickStartStep: string
  originalDescription: string
  updatedDescription: string
}

export interface TodoActivationRelief {
  todoId: string
  title: string
  quickStartStep: string
  updatedDescription: string
  fallbackStep: string
  originalQuickStartStep?: string
  originalDescription?: string
}

export interface TodoActivationReliefRequest {
  todoId: string
  blockReason: ActivationBlockReason
  mode: TodoActivationReliefMode
  previousRelief: TodoActivationRelief | null
}

export interface FocusFeedbackDraft {
  projectId: string
  todoId: string
  sessionId: string | null
  completedText: string
  issueText: string
  riskText: string
}

export interface FocusFeedbackLog extends FocusFeedbackDraft {
  id: string
  createdAt: string
}

export interface FocusContinuationSuggestion {
  quickStartStep: string
  nextSteps: string[]
  fallbackStep: string
}

export interface AiReviewSummary {
  summary: string[]
  issues: string[]
  suggestions: string[]
}

export interface AiReviewRecordDraft extends AiReviewSummary {
  scope: AiReviewScope
  projectId: string | null
  projectName: string | null
  timeframe: AiReviewTimeframe
}

export interface AiReviewRecord extends AiReviewRecordDraft {
  id: string
  createdAt: string
}
