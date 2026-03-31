import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow, UserAttentionType } from '@tauri-apps/api/window'
import type { AppSettings, AppSnapshot, FocusSessionDraft, ProjectDraft, TodoDraft } from '../types'

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
  }
}

const STORAGE_KEY = 'pomodoro-workbench:snapshot'

export type TrayAction = 'open' | 'toggle-timer' | 'skip-break'

export function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && typeof window.__TAURI_INTERNALS__ !== 'undefined'
}

export async function loadSnapshot(): Promise<AppSnapshot> {
  if (isTauriEnvironment()) {
    return invoke<AppSnapshot>('load_snapshot')
  }
  return readSnapshot()
}

export async function saveProject(project: ProjectDraft): Promise<AppSnapshot> {
  if (isTauriEnvironment()) {
    return invoke<AppSnapshot>('save_project', { project })
  }
  const snapshot = readSnapshot()
  const timestamp = nowIso()
  if (project.id) {
    snapshot.projects = snapshot.projects.map((item) =>
      item.id === project.id
        ? {
            ...item,
            name: project.name,
            color: project.color,
            icon: project.icon,
            status: project.status,
            archivedAt: project.status === 'archived' ? timestamp : null,
          }
        : item,
    )
  } else {
    snapshot.projects.unshift({
      id: crypto.randomUUID(),
      name: project.name,
      color: project.color,
      icon: project.icon,
      status: project.status,
      createdAt: timestamp,
      archivedAt: project.status === 'archived' ? timestamp : null,
    })
  }
  return writeSnapshot(snapshot)
}

export async function archiveProject(projectId: string, archived: boolean): Promise<AppSnapshot> {
  if (isTauriEnvironment()) {
    return invoke<AppSnapshot>('archive_project', { projectId, archived })
  }
  const snapshot = readSnapshot()
  snapshot.projects = snapshot.projects.map((project) =>
    project.id === projectId
      ? {
          ...project,
          status: archived ? 'archived' : 'active',
          archivedAt: archived ? nowIso() : null,
        }
      : project,
  )
  return writeSnapshot(snapshot)
}

export async function deleteProject(projectId: string): Promise<AppSnapshot> {
  if (isTauriEnvironment()) {
    return invoke<AppSnapshot>('delete_project', { projectId })
  }
  const snapshot = readSnapshot()
  const todoIds = new Set(snapshot.todos.filter((todo) => todo.projectId === projectId).map((todo) => todo.id))
  snapshot.projects = snapshot.projects.filter((project) => project.id !== projectId)
  snapshot.todos = snapshot.todos.filter((todo) => todo.projectId !== projectId)
  snapshot.sessions = snapshot.sessions.filter(
    (session) => session.projectId !== projectId && !todoIds.has(session.todoId),
  )
  return writeSnapshot(snapshot)
}

export async function saveTodo(todo: TodoDraft): Promise<AppSnapshot> {
  if (isTauriEnvironment()) {
    return invoke<AppSnapshot>('save_todo', { todo })
  }
  const snapshot = readSnapshot()
  const timestamp = nowIso()
  if (todo.id) {
    snapshot.todos = snapshot.todos.map((item) =>
      item.id === todo.id
        ? {
            ...item,
            ...todo,
            completedAt: todo.status === 'done' ? item.completedAt ?? timestamp : null,
          }
        : item,
    )
  } else {
    snapshot.todos.unshift({
      id: crypto.randomUUID(),
      projectId: todo.projectId,
      title: todo.title,
      description: todo.description,
      notes: todo.notes,
      status: todo.status,
      priority: todo.priority,
      estimatedPomodoros: todo.estimatedPomodoros,
      completedPomodoros: 0,
      dueDate: todo.dueDate,
      isToday: todo.isToday,
      createdAt: timestamp,
      completedAt: todo.status === 'done' ? timestamp : null,
    })
  }
  return writeSnapshot(snapshot)
}

export async function deleteTodo(todoId: string): Promise<AppSnapshot> {
  if (isTauriEnvironment()) {
    return invoke<AppSnapshot>('delete_todo', { todoId })
  }
  const snapshot = readSnapshot()
  snapshot.todos = snapshot.todos.filter((todo) => todo.id !== todoId)
  return writeSnapshot(snapshot)
}

export async function saveSettings(settings: AppSettings): Promise<AppSnapshot> {
  if (isTauriEnvironment()) {
    return invoke<AppSnapshot>('save_settings', { settings })
  }
  const snapshot = readSnapshot()
  snapshot.settings = settings
  return writeSnapshot(snapshot)
}

export async function recordFocusSession(session: FocusSessionDraft): Promise<AppSnapshot> {
  if (isTauriEnvironment()) {
    return invoke<AppSnapshot>('record_focus_session', { session })
  }
  const snapshot = readSnapshot()
  snapshot.sessions.unshift({
    id: crypto.randomUUID(),
    ...session,
  })
  if (session.type === 'focus' && session.result === 'completed') {
    snapshot.todos = snapshot.todos.map((todo) => {
      if (todo.id !== session.todoId) {
        return todo
      }
      const nextCompleted = todo.completedPomodoros + 1
      const done = nextCompleted >= todo.estimatedPomodoros
      return {
        ...todo,
        completedPomodoros: nextCompleted,
        status: done ? 'done' : 'in_progress',
        completedAt: done ? session.endedAt : todo.completedAt,
      }
    })
  } else if (session.type === 'focus' && session.result === 'interrupted') {
    snapshot.todos = snapshot.todos.map((todo) =>
      todo.id === session.todoId && todo.status === 'todo'
        ? {
            ...todo,
            status: 'in_progress',
          }
        : todo,
    )
  }
  return writeSnapshot(snapshot)
}

export async function notifyPhaseChange(title: string, body: string): Promise<void> {
  try {
    if (isTauriEnvironment()) {
      await invoke('notify_phase', { title, body })
      return
    }
    if (typeof Notification === 'undefined') {
      return
    }
    if (Notification.permission === 'granted') {
      new Notification(title, { body })
      return
    }
    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission()
      if (permission === 'granted') {
        new Notification(title, { body })
      }
    }
  } catch (error) {
    console.warn('notifyPhaseChange failed', error)
  }
}

export async function updateTrayStatus(status: string): Promise<void> {
  if (!isTauriEnvironment()) {
    return
  }
  try {
    await invoke('update_tray_status', { status })
  } catch (error) {
    console.warn('updateTrayStatus failed', error)
  }
}

export async function showMainWindow(): Promise<void> {
  if (!isTauriEnvironment()) {
    return
  }
  await invoke('show_main_window')
}

export async function requestWindowAttention(active: boolean): Promise<void> {
  if (!isTauriEnvironment()) {
    return
  }
  try {
    await getCurrentWindow().requestUserAttention(active ? UserAttentionType.Critical : null)
  } catch (error) {
    console.warn('requestWindowAttention failed', error)
  }
}

export async function surfacePhaseAlertWindow(): Promise<void> {
  if (!isTauriEnvironment()) {
    return
  }

  try {
    const currentWindow = getCurrentWindow()
    const [visible, minimized, focused] = await Promise.all([
      currentWindow.isVisible(),
      currentWindow.isMinimized(),
      currentWindow.isFocused(),
    ])

    if (!visible || minimized) {
      await showMainWindow()
      return
    }

    if (!focused) {
      await requestWindowAttention(true)
    }
  } catch (error) {
    console.warn('surfacePhaseAlertWindow failed', error)
  }
}

export async function listenTrayActions(
  handler: (action: TrayAction) => void,
): Promise<() => void> {
  if (!isTauriEnvironment()) {
    return () => {}
  }
  const unlisten = await listen<string>('tray-action', (event) => {
    handler(event.payload as TrayAction)
  })
  return () => {
    void unlisten()
  }
}

function readSnapshot(): AppSnapshot {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw) {
    return JSON.parse(raw) as AppSnapshot
  }
  const seeded = buildSeedSnapshot()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
  return seeded
}

function writeSnapshot(snapshot: AppSnapshot): AppSnapshot {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  return snapshot
}

function buildSeedSnapshot(): AppSnapshot {
  const now = new Date()
  const projectStudyId = crypto.randomUUID()
  const projectProductId = crypto.randomUUID()
  const projectHealthId = crypto.randomUUID()
  const todoReadingId = crypto.randomUUID()
  const todoPrototypeId = crypto.randomUUID()
  const todoReviewId = crypto.randomUUID()
  const todoRunId = crypto.randomUUID()

  const settings: AppSettings = {
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
  }

  const projects = [
    {
      id: projectStudyId,
      name: '资格考试冲刺',
      color: '#C65D3D',
      icon: 'book',
      status: 'active',
      createdAt: shiftIso(now, -12),
      archivedAt: null,
    },
    {
      id: projectProductId,
      name: '桌面产品设计',
      color: '#1E4F5F',
      icon: 'spark',
      status: 'active',
      createdAt: shiftIso(now, -7),
      archivedAt: null,
    },
    {
      id: projectHealthId,
      name: '体能恢复计划',
      color: '#5A6A31',
      icon: 'leaf',
      status: 'paused',
      createdAt: shiftIso(now, -18),
      archivedAt: null,
    },
  ] as AppSnapshot['projects']

  const todos = [
    {
      id: todoReadingId,
      projectId: projectStudyId,
      title: '真题阅读 2 套',
      description: '按题型拆解错题，记录生词。',
      notes: '结束后整理高频词到单词本。',
      status: 'in_progress',
      priority: 'high',
      estimatedPomodoros: 4,
      completedPomodoros: 2,
      dueDate: shiftDate(now, 2),
      isToday: true,
      createdAt: shiftIso(now, -5),
      completedAt: null,
    },
    {
      id: todoPrototypeId,
      projectId: projectProductId,
      title: '整理桌面端信息架构',
      description: '把导航、卡片和统计逻辑统一。',
      notes: '优先确定执行页信息密度。',
      status: 'todo',
      priority: 'high',
      estimatedPomodoros: 3,
      completedPomodoros: 0,
      dueDate: shiftDate(now, 1),
      isToday: true,
      createdAt: shiftIso(now, -3),
      completedAt: null,
    },
    {
      id: todoReviewId,
      projectId: projectProductId,
      title: '补统计页图表文案',
      description: '把趋势图和项目占比的文案补齐。',
      notes: '',
      status: 'todo',
      priority: 'medium',
      estimatedPomodoros: 2,
      completedPomodoros: 0,
      dueDate: shiftDate(now, 3),
      isToday: false,
      createdAt: shiftIso(now, -2),
      completedAt: null,
    },
    {
      id: todoRunId,
      projectId: projectHealthId,
      title: '轻量跑步 30 分钟',
      description: '恢复心肺，不追配速。',
      notes: '',
      status: 'todo',
      priority: 'low',
      estimatedPomodoros: 2,
      completedPomodoros: 0,
      dueDate: null,
      isToday: false,
      createdAt: shiftIso(now, -4),
      completedAt: null,
    },
  ] as AppSnapshot['todos']

  const sessions = [
    {
      id: crypto.randomUUID(),
      projectId: projectStudyId,
      todoId: todoReadingId,
      type: 'focus',
      plannedDurationSec: 1500,
      actualDurationSec: 1500,
      startedAt: shiftIso(now, -4, -2),
      endedAt: shiftIso(now, -4, -1.5),
      result: 'completed',
      interruptReason: null,
    },
    {
      id: crypto.randomUUID(),
      projectId: projectStudyId,
      todoId: todoReadingId,
      type: 'focus',
      plannedDurationSec: 1500,
      actualDurationSec: 1500,
      startedAt: shiftIso(now, -2, -3),
      endedAt: shiftIso(now, -2, -2.5),
      result: 'completed',
      interruptReason: null,
    },
    {
      id: crypto.randomUUID(),
      projectId: projectProductId,
      todoId: todoPrototypeId,
      type: 'focus',
      plannedDurationSec: 1500,
      actualDurationSec: 1500,
      startedAt: shiftIso(now, -1, -5),
      endedAt: shiftIso(now, -1, -4.5),
      result: 'completed',
      interruptReason: null,
    },
    {
      id: crypto.randomUUID(),
      projectId: projectProductId,
      todoId: todoPrototypeId,
      type: 'focus',
      plannedDurationSec: 1500,
      actualDurationSec: 900,
      startedAt: shiftIso(now, -1, -2),
      endedAt: shiftIso(now, -1, -1.7),
      result: 'interrupted',
      interruptReason: '被临时会议打断',
    },
    {
      id: crypto.randomUUID(),
      projectId: projectStudyId,
      todoId: todoReadingId,
      type: 'focus',
      plannedDurationSec: 1500,
      actualDurationSec: 1500,
      startedAt: shiftIso(now, 0, -4),
      endedAt: shiftIso(now, 0, -3.5),
      result: 'completed',
      interruptReason: null,
    },
  ] as AppSnapshot['sessions']

  return { settings, projects, todos, sessions }
}

function nowIso(): string {
  return new Date().toISOString()
}

function shiftIso(base: Date, dayOffset: number, hourOffset = 0): string {
  const next = new Date(base)
  next.setDate(next.getDate() + dayOffset)
  next.setHours(next.getHours() + hourOffset)
  return next.toISOString()
}

function shiftDate(base: Date, dayOffset: number): string {
  const next = new Date(base)
  next.setDate(next.getDate() + dayOffset)
  const year = next.getFullYear()
  const month = String(next.getMonth() + 1).padStart(2, '0')
  const day = String(next.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
