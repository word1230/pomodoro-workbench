import {
  type FormEvent,
  type ReactNode,
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from 'react'
import './App.css'
import {
  buildAnalytics,
  formatClock,
  formatDuration,
  getRemainingPomodoros,
  priorityLabels,
  projectSharePercent,
  sortTodosForFocus,
  statusLabels,
} from './lib/analytics'
import { formatSessionGroupLabel, formatSessionRange } from './lib/session-format'
import { idleTimer, resolveNextTimerTick, shouldFinalizeTimerPhase } from './lib/timer-tick'
import {
  archiveProject,
  deleteProject,
  deleteTodo,
  listenTrayActions,
  loadSnapshot,
  notifyPhaseChange,
  recordFocusSession,
  requestWindowAttention,
  saveProject,
  saveSettings,
  saveTodo,
  showMainWindow,
  surfacePhaseAlertWindow,
  updateTrayStatus,
} from './lib/platform'
import { playPhaseAlertSound, primePhaseAlertSound } from './lib/phase-alert'
import {
  PHASE_REMINDER_INITIAL_DELAY_MS,
  PHASE_REMINDER_INTERVAL_MS,
  buildBreakCompletionPrompt,
  buildFocusCompletionPrompt,
  type PhaseAlertPrompt,
} from './lib/phase-prompt'
import type {
  AppSettings,
  AppSnapshot,
  PageId,
  Priority,
  Project,
  ProjectDraft,
  TimerState,
  Todo,
  TodoDraft,
  TodoStatus,
} from './types'

const pageMeta: Array<{ id: PageId; label: string }> = [
  { id: 'focus', label: '专注' },
  { id: 'manage', label: '项目库' },
  { id: 'stats', label: '复盘' },
]

const projectColorOptions = ['#0071E3', '#34A853', '#FF9500', '#FF3B30', '#AF52DE', '#111827']

const emptyProjects: Project[] = []
const emptyTodos: Todo[] = []
const fallbackAnalytics = {
  todayFocusCount: 0,
  todayFocusDurationSec: 0,
  weekFocusCount: 0,
  monthFocusCount: 0,
  weekInterruptCount: 0,
  projectMetrics: [],
  dailyTrend: [],
  completionRate: 0,
  topProjectName: '尚未开始',
  topProjectColor: '#0071E3',
}

function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  const [page, setPage] = useState<PageId>('focus')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [manageProjectId, setManageProjectId] = useState<string | null>(null)
  const [statsProjectId, setStatsProjectId] = useState<string | null>(null)
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null)
  const [plannedPomodoros, setPlannedPomodoros] = useState(1)
  const [timer, setTimer] = useState<TimerState>(idleTimer)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, setMessage] = useState<string | null>(null)
  const [phaseAlertPrompt, setPhaseAlertPrompt] = useState<PhaseAlertPrompt | null>(null)
  const [settingsDraft, setSettingsDraft] = useState<AppSettings | null>(null)
  const [projectPickerMode, setProjectPickerMode] = useState<'focus' | 'stats' | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [projectEditorOpen, setProjectEditorOpen] = useState(false)
  const [projectEditorMode, setProjectEditorMode] = useState<'create' | 'edit'>('create')
  const [todoEditorOpen, setTodoEditorOpen] = useState(false)
  const [todoEditorMode, setTodoEditorMode] = useState<'create' | 'edit'>('create')
  const [colorPickerOpen, setColorPickerOpen] = useState(false)
  const [confirmState, setConfirmState] = useState<
    | { type: 'complete-todo'; todoId: string }
    | { type: 'archive-project'; projectId: string }
    | { type: 'delete-project'; projectId: string }
    | null
  >(null)
  const [focusDescriptionDraft, setFocusDescriptionDraft] = useState('')
  const [projectForm, setProjectForm] = useState<ProjectDraft>({
    name: '',
    color: projectColorOptions[0],
    icon: 'book',
    status: 'active',
  })
  const [todoForm, setTodoForm] = useState<TodoDraft>({
    projectId: '',
    title: '',
    description: '',
    notes: '',
    status: 'todo',
    priority: 'medium',
    estimatedPomodoros: 1,
    dueDate: null,
    isToday: false,
  })
  const deferredSnapshot = useDeferredValue(snapshot)

  const analytics = useMemo(
    () => (deferredSnapshot ? buildAnalytics(deferredSnapshot) : fallbackAnalytics),
    [deferredSnapshot],
  )

  const projects = snapshot?.projects ?? emptyProjects
  const todos = snapshot?.todos ?? emptyTodos
  const focusProjects = projects.filter((project) => project.status !== 'archived')
  const selectedProject =
    focusProjects.find((project) => project.id === selectedProjectId) ?? focusProjects[0] ?? null
  const manageProject = projects.find((project) => project.id === manageProjectId) ?? projects[0] ?? null
  const statsProject = projects.find((project) => project.id === statsProjectId) ?? null

  const projectTodos = useMemo(
    () =>
      selectedProject
        ? sortTodosForFocus(
            todos.filter(
              (todo) =>
                todo.projectId === selectedProject.id &&
                todo.status !== 'done' &&
                todo.status !== 'cancelled' &&
                (todo.status === 'todo' || todo.status === 'in_progress' || todo.isToday),
            ),
          )
        : [],
    [selectedProject, todos],
  )

  const selectedTodo = projectTodos.find((todo) => todo.id === selectedTodoId) ?? projectTodos[0] ?? null
  const manageProjectTodos = useMemo(
    () => (manageProject ? todos.filter((todo) => todo.projectId === manageProject.id) : []),
    [manageProject, todos],
  )
  const statsSnapshot = useMemo(
    () =>
      snapshot
        ? statsProjectId
          ? {
              settings: snapshot.settings,
              projects: snapshot.projects.filter((project) => project.id === statsProjectId),
              todos: snapshot.todos.filter((todo) => todo.projectId === statsProjectId),
              sessions: snapshot.sessions.filter((session) => session.projectId === statsProjectId),
            }
          : snapshot
        : null,
    [snapshot, statsProjectId],
  )
  const statsAnalytics = useMemo(
    () => (statsSnapshot ? buildAnalytics(statsSnapshot) : analytics),
    [analytics, statsSnapshot],
  )
  const reviewMetric =
    statsProject
      ? statsAnalytics.projectMetrics.find((metric) => metric.project.id === statsProject.id) ?? null
      : null
  const recentFocusSessions = useMemo(
    () => snapshot?.sessions.filter((session) => session.type === 'focus').slice(0, 6) ?? [],
    [snapshot?.sessions],
  )
  const recentFocusGroups = useMemo(() => {
    const groups = new Map<string, typeof recentFocusSessions>()

    for (const session of recentFocusSessions) {
      const label = formatSessionGroupLabel(session.startedAt)
      const current = groups.get(label) ?? []
      current.push(session)
      groups.set(label, current)
    }

    return Array.from(groups.entries()).map(([label, sessions]) => ({ label, sessions }))
  }, [recentFocusSessions])

  const timerPhaseTotalSec = useMemo(() => {
    if (!settingsDraft) {
      return 0
    }
    switch (timer.phase) {
      case 'focus':
        return settingsDraft.focusMinutes * 60
      case 'short_break':
        return settingsDraft.shortBreakMinutes * 60
      case 'long_break':
        return settingsDraft.longBreakMinutes * 60
      case 'idle':
        return 0
    }
  }, [settingsDraft, timer.phase])

  const timerFaceProgress =
    timer.phase === 'idle' || timerPhaseTotalSec === 0
      ? 0
      : Math.round(((timerPhaseTotalSec - timer.remainingSec) / timerPhaseTotalSec) * 100)
  const timerDisplaySeconds = timer.phase === 'idle' ? (settingsDraft ? settingsDraft.focusMinutes * 60 : 0) : timer.remainingSec

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    loadSnapshot()
      .then((next) => {
        if (cancelled) {
          return
        }
        startTransition(() => setSnapshot(next))
        setSettingsDraft(next.settings)
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(extractError(reason))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBusy(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!focusProjects.length) {
      setSelectedProjectId(null)
    } else if (!selectedProjectId || !focusProjects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(focusProjects[0].id)
    }

    if (!projects.length) {
      setManageProjectId(null)
    } else if (!manageProjectId || !projects.some((project) => project.id === manageProjectId)) {
      setManageProjectId(projects[0].id)
    }

    if (statsProjectId && !projects.some((project) => project.id === statsProjectId)) {
      setStatsProjectId(null)
    }
  }, [focusProjects, manageProjectId, projects, selectedProjectId, statsProjectId])

  useEffect(() => {
    if (!selectedProject) {
      setSelectedTodoId(null)
      return
    }
    if (!selectedTodoId || !projectTodos.some((todo) => todo.id === selectedTodoId)) {
      setSelectedTodoId(projectTodos[0]?.id ?? null)
    }
  }, [projectTodos, selectedProject, selectedTodoId])

  useEffect(() => {
    setPlannedPomodoros(Math.max(1, selectedTodo?.estimatedPomodoros ?? 1))
  }, [selectedTodo?.estimatedPomodoros, selectedTodo?.id])

  useEffect(() => {
    setFocusDescriptionDraft(selectedTodo?.description ?? '')
  }, [selectedTodo?.description, selectedTodo?.id])

  useEffect(() => {
    if (!phaseAlertPrompt) {
      void requestWindowAttention(false)
      return
    }

    void surfacePhaseAlertWindow()

    return () => {
      void requestWindowAttention(false)
    }
  }, [phaseAlertPrompt])

  useEffect(() => {
    if (!phaseAlertPrompt || !settingsDraft?.soundEnabled) {
      return
    }

    let intervalId: number | null = null
    const initialTimeoutId = window.setTimeout(() => {
      void playPhaseAlertSound(phaseAlertPrompt.sound)
      intervalId = window.setInterval(() => {
        void playPhaseAlertSound(phaseAlertPrompt.sound)
      }, PHASE_REMINDER_INTERVAL_MS)
    }, PHASE_REMINDER_INITIAL_DELAY_MS)

    return () => {
      window.clearTimeout(initialTimeoutId)
      if (intervalId !== null) {
        window.clearInterval(intervalId)
      }
    }
  }, [phaseAlertPrompt, settingsDraft?.soundEnabled])

  const acknowledgePhaseAlert = () => {
    if (phaseAlertPrompt?.resumeTimerOnConfirm) {
      setTimer((current) => (current.phase === 'idle' ? current : { ...current, running: true }))
    }
    setPhaseAlertPrompt(null)
  }

  const syncSnapshot = async (
    operation: Promise<AppSnapshot>,
    options?: { message?: string; silent?: boolean },
  ) => {
    if (!options?.silent) {
      setBusy(true)
    }
    setError(null)
    try {
      const next = await operation
      startTransition(() => setSnapshot(next))
      setSettingsDraft(next.settings)
      if (options?.message) {
        setMessage(options.message)
      }
      return next
    } catch (reason) {
      setError(extractError(reason))
      return null
    } finally {
      if (!options?.silent) {
        setBusy(false)
      }
    }
  }

  const saveSettingsAndRefresh = async (next: AppSettings) => {
    setSettingsDraft(next)
    await syncSnapshot(saveSettings(next), { message: '偏好设置已保存' })
  }

  const startFocusRun = async () => {
    if (!selectedTodo || !selectedProject || !snapshot) {
      return
    }

    setPhaseAlertPrompt(null)
    void primePhaseAlertSound()

    const target = Math.max(1, plannedPomodoros)
    setTimer({
      phase: 'focus',
      running: true,
      remainingSec: snapshot.settings.focusMinutes * 60,
      targetPomodoros: target,
      completedPomodoros: 0,
      todoId: selectedTodo.id,
      projectId: selectedProject.id,
      phaseStartedAt: new Date().toISOString(),
    })

    if (selectedTodo.status === 'todo' || selectedTodo.estimatedPomodoros !== target) {
      await syncSnapshot(
        saveTodo({
          id: selectedTodo.id,
          projectId: selectedTodo.projectId,
          title: selectedTodo.title,
          description: selectedTodo.description,
          notes: selectedTodo.notes,
          status: selectedTodo.status === 'todo' ? 'in_progress' : selectedTodo.status,
          priority: selectedTodo.priority,
          estimatedPomodoros: target,
          dueDate: selectedTodo.dueDate,
          isToday: selectedTodo.isToday,
        }),
        { silent: true },
      )
    }

    setMessage(`已绑定「${selectedTodo.title}」并开启 ${target} 个番茄`)
  }

  const finishPhase = useEffectEvent(async (current: TimerState) => {
    try {
      if (!snapshot || !current.todoId || !current.projectId || current.phase === 'idle') {
        return
      }

      const now = new Date().toISOString()
      const todo = snapshot.todos.find((item) => item.id === current.todoId)
      if (!todo) {
        setTimer(idleTimer)
        return
      }

      if (current.phase === 'focus') {
        await syncSnapshot(
          recordFocusSession({
            projectId: current.projectId,
            todoId: current.todoId,
            type: 'focus',
            plannedDurationSec: snapshot.settings.focusMinutes * 60,
            actualDurationSec: snapshot.settings.focusMinutes * 60,
            startedAt: current.phaseStartedAt ?? now,
            endedAt: now,
            result: 'completed',
            interruptReason: null,
          }),
          { silent: true },
        )

        const nextCompleted = current.completedPomodoros + 1
        if (snapshot.settings.soundEnabled) {
          await playPhaseAlertSound('focus_complete')
        }
        if (snapshot.settings.notificationsEnabled) {
          await notifyPhaseChange(
            '一轮专注完成',
            `${todo.title} 已完成 ${nextCompleted}/${current.targetPomodoros} 个番茄`,
          )
        }

        if (nextCompleted >= current.targetPomodoros) {
          setTimer(idleTimer)
          setPhaseAlertPrompt(
            buildFocusCompletionPrompt({
              todoTitle: todo.title,
              completedPomodoros: nextCompleted,
              targetPomodoros: current.targetPomodoros,
              nextPhase: null,
              autoStarted: false,
            }),
          )
          setMessage(`「${todo.title}」的计划番茄已完成`)
          return
        }

        const nextPhase =
          nextCompleted % snapshot.settings.longBreakInterval === 0 ? 'long_break' : 'short_break'
        const nextSeconds =
          nextPhase === 'long_break'
            ? snapshot.settings.longBreakMinutes * 60
            : snapshot.settings.shortBreakMinutes * 60

        setTimer({
          ...current,
          phase: nextPhase,
          running: snapshot.settings.autoStartBreaks,
          remainingSec: nextSeconds,
          completedPomodoros: nextCompleted,
          phaseStartedAt: now,
        })
        setPhaseAlertPrompt(
          buildFocusCompletionPrompt({
            todoTitle: todo.title,
            completedPomodoros: nextCompleted,
            targetPomodoros: current.targetPomodoros,
            nextPhase,
            autoStarted: snapshot.settings.autoStartBreaks,
          }),
        )
        setMessage(nextPhase === 'long_break' ? '进入长休息' : '进入短休息')
        return
      }

      const plannedBreakSec =
        current.phase === 'short_break'
          ? snapshot.settings.shortBreakMinutes * 60
          : snapshot.settings.longBreakMinutes * 60

      await syncSnapshot(
        recordFocusSession({
          projectId: current.projectId,
          todoId: current.todoId,
          type: current.phase,
          plannedDurationSec: plannedBreakSec,
          actualDurationSec: plannedBreakSec,
          startedAt: current.phaseStartedAt ?? now,
          endedAt: now,
          result: 'completed',
          interruptReason: null,
        }),
        { silent: true },
      )

      if (snapshot.settings.soundEnabled) {
        await playPhaseAlertSound('break_complete')
      }
      if (snapshot.settings.notificationsEnabled) {
        await notifyPhaseChange('休息结束', `回到「${todo.title}」继续推进`)
      }

      setTimer({
        ...current,
        phase: 'focus',
        running: snapshot.settings.autoStartFocus,
        remainingSec: snapshot.settings.focusMinutes * 60,
        phaseStartedAt: now,
      })
      setPhaseAlertPrompt(
        buildBreakCompletionPrompt({
          todoTitle: todo.title,
          autoStarted: snapshot.settings.autoStartFocus,
        }),
      )
      setMessage('开始下一轮专注')
    } catch (reason) {
      console.error('finishPhase failed', reason)
      setTimer(idleTimer)
      setError(extractError(reason))
    }
  })

  useEffect(() => {
    if (timer.phase === 'idle' || !timer.running) {
      return
    }

    const interval = window.setInterval(() => {
      setTimer((current) => {
        return resolveNextTimerTick(current).nextTimer
      })
    }, 1000)

    return () => {
      window.clearInterval(interval)
    }
  }, [timer.phase, timer.running])

  useEffect(() => {
    if (!shouldFinalizeTimerPhase(timer)) {
      return
    }

    void finishPhase(timer)
  }, [timer])

  const handleInterrupt = async () => {
    if (!snapshot || !timer.todoId || !timer.projectId || timer.phase === 'idle') {
      return
    }

    setPhaseAlertPrompt(null)
    const now = new Date().toISOString()
    const plannedDurationSec =
      timer.phase === 'focus'
        ? snapshot.settings.focusMinutes * 60
        : timer.phase === 'short_break'
          ? snapshot.settings.shortBreakMinutes * 60
          : snapshot.settings.longBreakMinutes * 60
    const actualDurationSec = Math.max(0, plannedDurationSec - timer.remainingSec)

    await syncSnapshot(
      recordFocusSession({
        projectId: timer.projectId,
        todoId: timer.todoId,
        type: timer.phase,
        plannedDurationSec,
        actualDurationSec,
        startedAt: timer.phaseStartedAt ?? now,
        endedAt: now,
        result: timer.phase === 'focus' ? 'interrupted' : 'skipped',
        interruptReason: timer.phase === 'focus' ? '手动终止' : '主动跳过休息',
      }),
      { silent: true },
    )

    setTimer(idleTimer)
    setMessage(timer.phase === 'focus' ? '本轮已终止' : '已跳过休息并停止本次计划')
  }

  const handleSkipBreak = async () => {
    if (!snapshot || timer.phase === 'idle' || timer.phase === 'focus' || !timer.todoId || !timer.projectId) {
      return
    }

    setPhaseAlertPrompt(null)
    const now = new Date().toISOString()
    const plannedBreakSec =
      timer.phase === 'short_break'
        ? snapshot.settings.shortBreakMinutes * 60
        : snapshot.settings.longBreakMinutes * 60

    await syncSnapshot(
      recordFocusSession({
        projectId: timer.projectId,
        todoId: timer.todoId,
        type: timer.phase,
        plannedDurationSec: plannedBreakSec,
        actualDurationSec: Math.max(0, plannedBreakSec - timer.remainingSec),
        startedAt: timer.phaseStartedAt ?? now,
        endedAt: now,
        result: 'skipped',
        interruptReason: '用户主动跳过休息',
      }),
      { silent: true },
    )

    setTimer({
      ...timer,
      phase: 'focus',
      running: true,
      remainingSec: snapshot.settings.focusMinutes * 60,
      phaseStartedAt: now,
    })
    setMessage('已跳过休息，重新进入专注')
  }

  const onTrayAction = useEffectEvent((action: string) => {
    if (action === 'open') {
      void showMainWindow()
      return
    }
    if (action === 'toggle-timer') {
      if (timer.phase === 'idle') {
        void startFocusRun()
        return
      }
      setTimer((current) => ({ ...current, running: !current.running }))
      return
    }
    if (action === 'skip-break' && timer.phase !== 'idle' && timer.phase !== 'focus') {
      void handleSkipBreak()
    }
  })

  useEffect(() => {
    let dispose = () => {}
    void listenTrayActions((action) => onTrayAction(action)).then((unlisten) => {
      dispose = unlisten
    })
    return () => {
      dispose()
    }
  }, [])

  useEffect(() => {
    const text =
      timer.phase === 'idle'
        ? 'Pomodoro Workbench · 待机'
        : `Pomodoro Workbench · ${phaseLabel(timer.phase)} · ${formatClock(timer.remainingSec)}`
    void updateTrayStatus(text)
  }, [timer.phase, timer.remainingSec])

  useEffect(() => {
    setProjectPickerMode(null)
    setSettingsOpen(false)
    setProjectEditorOpen(false)
    setTodoEditorOpen(false)
    setColorPickerOpen(false)
    setConfirmState(null)
  }, [page])

  const openProjectEditor = (mode: 'create' | 'edit') => {
    setProjectEditorMode(mode)
    if (mode === 'edit' && manageProject) {
      setProjectForm({
        id: manageProject.id,
        name: manageProject.name,
        color: manageProject.color,
        icon: manageProject.icon,
        status: manageProject.status,
      })
    } else {
      setProjectForm({
        name: '',
        color: projectColorOptions[0],
        icon: 'book',
        status: 'active',
      })
    }
    setProjectEditorOpen(true)
  }

  const openTodoEditor = (todo?: Todo) => {
    setTodoEditorMode(todo ? 'edit' : 'create')
    if (todo) {
      setTodoForm({
        id: todo.id,
        projectId: todo.projectId,
        title: todo.title,
        description: todo.description,
        notes: todo.notes,
        status: todo.status,
        priority: todo.priority,
        estimatedPomodoros: todo.estimatedPomodoros,
        dueDate: todo.dueDate,
        isToday: todo.isToday,
      })
    } else {
      setTodoForm({
        projectId: manageProject?.id ?? projects[0]?.id ?? '',
        title: '',
        description: '',
        notes: '',
        status: 'todo',
        priority: 'medium',
        estimatedPomodoros: 1,
        dueDate: null,
        isToday: false,
      })
    }
    setTodoEditorOpen(true)
  }

  const handleProjectFormSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!projectForm.name.trim()) {
      setError('项目名称不能为空')
      return
    }

    const next = await syncSnapshot(saveProject(projectForm), {
      message: projectEditorMode === 'create' ? '项目已创建' : '项目已更新',
    })
    if (!next) {
      return
    }

    const nextProjectId = projectForm.id ?? next.projects[0]?.id ?? null
    setManageProjectId(nextProjectId)
    if (projectForm.status !== 'archived') {
      setSelectedProjectId(nextProjectId)
    }
    setProjectEditorOpen(false)
  }

  const handleTodoFormSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!todoForm.projectId || !todoForm.title.trim()) {
      setError('代办需要标题和所属项目')
      return
    }

    const next = await syncSnapshot(saveTodo(todoForm), {
      message: todoEditorMode === 'create' ? '代办已创建' : '代办已更新',
    })
    if (!next) {
      return
    }

    setManageProjectId(todoForm.projectId)
    if (selectedProject?.id === todoForm.projectId || !selectedProject) {
      setSelectedProjectId(todoForm.projectId)
    }
    if (!todoForm.id) {
      setSelectedTodoId(next.todos[0]?.id ?? null)
    }
    setTodoEditorOpen(false)
  }

  const handleDeleteTodo = async (todoId: string) => {
    await syncSnapshot(deleteTodo(todoId), { message: '代办已删除' })
    if (selectedTodoId === todoId) {
      setSelectedTodoId(null)
    }
    if (todoForm.id === todoId) {
      setTodoEditorOpen(false)
    }
  }

  const completeTodo = async (todo: Todo) => {
    await syncSnapshot(
      saveTodo({
        id: todo.id,
        projectId: todo.projectId,
        title: todo.title,
        description: todo.description,
        notes: todo.notes,
        status: 'done',
        priority: todo.priority,
        estimatedPomodoros: todo.estimatedPomodoros,
        dueDate: todo.dueDate,
        isToday: todo.isToday,
      }),
      { message: '代办已完成' },
    )
  }

  const handleCompleteTodo = async (todo: Todo) => {
    if (getRemainingPomodoros(todo) > 0) {
      setConfirmState({ type: 'complete-todo', todoId: todo.id })
      return
    }

    await completeTodo(todo)
  }

  const handleArchiveProject = async (project: Project) => {
    await syncSnapshot(archiveProject(project.id, true), { message: '项目已归档' })
    setConfirmState(null)
  }

  const handleDeleteProject = async (project: Project) => {
    await syncSnapshot(deleteProject(project.id), { message: '项目已删除' })
    setConfirmState(null)
  }

  const handleFocusDescriptionSave = async () => {
    if (!selectedTodo) {
      return
    }

    const nextDescription = focusDescriptionDraft.trim()
    if (nextDescription === selectedTodo.description.trim()) {
      return
    }

    await syncSnapshot(
      saveTodo({
        id: selectedTodo.id,
        projectId: selectedTodo.projectId,
        title: selectedTodo.title,
        description: nextDescription,
        notes: selectedTodo.notes,
        status: selectedTodo.status,
        priority: selectedTodo.priority,
        estimatedPomodoros: selectedTodo.estimatedPomodoros,
        dueDate: selectedTodo.dueDate,
        isToday: selectedTodo.isToday,
      }),
      { message: '任务描述已更新', silent: true },
    )
  }

  const handlePlannedPomodorosSave = async () => {
    if (!selectedTodo) {
      return
    }

    const nextEstimated = Math.max(1, Math.min(20, plannedPomodoros))
    if (nextEstimated === selectedTodo.estimatedPomodoros) {
      return
    }

    await syncSnapshot(
      saveTodo({
        id: selectedTodo.id,
        projectId: selectedTodo.projectId,
        title: selectedTodo.title,
        description: selectedTodo.description,
        notes: selectedTodo.notes,
        status: selectedTodo.status,
        priority: selectedTodo.priority,
        estimatedPomodoros: nextEstimated,
        dueDate: selectedTodo.dueDate,
        isToday: selectedTodo.isToday,
      }),
      { message: '番茄数已更新', silent: true },
    )
  }

  if (!snapshot || !settingsDraft) {
    return (
      <div className="loading-shell">
        <div className="loading-card">
          <p className="eyebrow">Pomodoro Workbench</p>
          <h1>正在装载你的专注工作台</h1>
          <p>初始化本地数据库、项目数据和统计视图。</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <div className={sidebarCollapsed ? 'app-shell app-shell--collapsed' : 'app-shell'}>
        <aside className={sidebarCollapsed ? 'nav-rail nav-rail--collapsed' : 'nav-rail'}>
          <nav className="nav-list" aria-label="主导航">
            {pageMeta.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === page ? 'nav-item active' : 'nav-item'}
                onClick={() => setPage(item.id)}
                aria-label={item.label}
                data-label={item.label}
                title={item.label}
              >
                <span className="nav-item__icon" aria-hidden="true">
                  <NavIcon page={item.id} />
                </span>
                <span className="nav-item__text">{item.label}</span>
              </button>
            ))}
          </nav>

          <button
            type="button"
            className="nav-collapse-button"
            aria-label={sidebarCollapsed ? '展开侧边导航' : '收起侧边导航'}
            onClick={() => setSidebarCollapsed((current) => !current)}
          >
            <span className="nav-collapse-button__icon" aria-hidden="true">
              <CollapseIcon collapsed={sidebarCollapsed} />
            </span>
          </button>
        </aside>

        <main className="workspace" id="main-content">
          {error || busy ? (
            <div className="workspace-status">
              <div className="header-actions">
                {error ? <span className="banner banner--error">{error}</span> : null}
                {busy ? <span className="busy-pill">同步中</span> : null}
              </div>
            </div>
          ) : null}

          {page === 'focus' ? (
            <section className="page-grid page-grid--focus">
              <Panel title="待办" bodyClassName="focus-panel-body">
                <div className="focus-panel-topbar">
                  <button
                    type="button"
                    className="action-button"
                    onClick={() => setProjectPickerMode('focus')}
                    disabled={timer.phase !== 'idle'}
                  >
                    {selectedProject ? `项目：${selectedProject.name}` : '选择项目'}
                  </button>
                </div>

                <div className="todo-list">
                  {projectTodos.length ? (
                    projectTodos.map((todo) => (
                      <article key={todo.id} className={todo.id === selectedTodo?.id ? 'todo-card active' : 'todo-card'}>
                        <button
                          type="button"
                          className="todo-card__main"
                          onClick={() => setSelectedTodoId(todo.id)}
                          disabled={timer.phase !== 'idle'}
                        >
                          <h3>{todo.title}</h3>
                          <div className="todo-card__tag-row">
                            <span className={`status-pill status-pill--${todo.status}`}>
                              {statusLabels[todo.status]}
                            </span>
                            <span className={`priority-pill priority-pill--${todo.priority}`}>
                              {priorityLabels[todo.priority]}
                            </span>
                          </div>
                        </button>
                        <div className="todo-card__foot">
                          <span>
                            {todo.completedPomodoros}/{todo.estimatedPomodoros}
                          </span>
                          <span>{todo.isToday ? '今日' : todo.dueDate ? todo.dueDate : '未排期'}</span>
                          <button
                            type="button"
                            className="action-button action-button--compact"
                            onClick={() => void handleCompleteTodo(todo)}
                            disabled={timer.phase !== 'idle'}
                          >
                            完成
                          </button>
                        </div>
                      </article>
                    ))
                  ) : (
                    <EmptyState title="没有待办" body="先到项目管理里补一条任务。" />
                  )}
                </div>
              </Panel>

              <Panel title="任务" bodyClassName="focus-panel-body">
                {selectedTodo ? (
                  <div className="selected-todo">
                    <div className="selected-todo__hero">
                      <div className="selected-todo__title-block">
                        <span>当前任务</span>
                        <h3>{selectedTodo.title}</h3>
                      </div>
                      <label className="selected-todo__count-block">
                        <span>本轮番茄数</span>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={plannedPomodoros}
                          disabled={timer.phase !== 'idle'}
                          onChange={(event) =>
                            setPlannedPomodoros(Math.max(1, Math.min(20, Number(event.target.value) || 1)))
                          }
                          onBlur={() => void handlePlannedPomodorosSave()}
                        />
                      </label>
                    </div>
                    <label className="selected-todo__card selected-todo__card--editable">
                      <span>描述</span>
                      <textarea
                        rows={4}
                        value={focusDescriptionDraft}
                        onChange={(event) => setFocusDescriptionDraft(event.target.value)}
                        onBlur={() => void handleFocusDescriptionSave()}
                        placeholder="补充任务描述"
                      ></textarea>
                    </label>
                    <div className="selected-todo__meta-row">
                      <div className="compact-stat compact-stat--mini">
                        <span>本轮进度</span>
                        <strong>{timer.completedPomodoros}/{timer.targetPomodoros || plannedPomodoros}</strong>
                      </div>
                      <div className="compact-stat compact-stat--mini">
                        <span>剩余</span>
                        <strong>{getRemainingPomodoros(selectedTodo)}</strong>
                      </div>
                      <div className="compact-stat compact-stat--mini">
                        <span>截止</span>
                        <strong>{selectedTodo.dueDate ?? '未设定'}</strong>
                      </div>
                    </div>
                  </div>
                ) : (
                  <EmptyState title="先选任务" body="选中一条待办后再开始计时。" />
                )}
              </Panel>

              <Panel title="番茄钟" bodyClassName="timer-panel-body">
                <div className="timer-shell">
                  <div className="timer-toolbar">
                    <div>
                      {timer.phase !== 'idle' ? (
                        <span className={`status-pill status-pill--${timerBadge(timer).tone}`}>
                          {timerBadge(timer).label}
                        </span>
                      ) : null}
                    </div>
                    <button type="button" className="action-button" onClick={() => setSettingsOpen(true)}>
                      设置
                    </button>
                  </div>

                  <div className={`timer-face timer-face--${timer.phase}`}>
                    <div className="timer-face__inner">
                      <strong>{formatClock(timerDisplaySeconds)}</strong>
                      <div className="timer-face__bar">
                        <div
                          className="timer-face__bar-fill"
                          style={{ ['--progress' as string]: `${timerFaceProgress}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>

                  {timer.phase === 'idle' ? (
                    <div className="timer-actions timer-actions--primary timer-actions--stacked">
                      <button
                        type="button"
                        className="action-button action-button--primary"
                        onClick={() => void startFocusRun()}
                        disabled={!selectedTodo}
                      >
                        开始番茄钟
                      </button>
                    </div>
                  ) : (
                    <div className="timer-actions timer-actions--inline">
                      <button
                        type="button"
                        className="action-button action-button--primary"
                        onClick={() => setTimer((current) => ({ ...current, running: !current.running }))}
                      >
                        {timer.running ? '暂停' : '继续'}
                      </button>
                      <button
                        type="button"
                        className="action-button action-button--ghost"
                        onClick={() => void handleInterrupt()}
                      >
                        终止
                      </button>
                      {timer.phase !== 'focus' ? (
                        <button type="button" className="action-button" onClick={() => void handleSkipBreak()}>
                          跳过休息
                        </button>
                      ) : null}
                    </div>
                  )}

                  <div className="timer-records">
                    <div className="timer-records__head">
                      <span>最近记录</span>
                    </div>
                    {recentFocusGroups.length ? (
                      <div className="timer-records__list">
                        {recentFocusGroups.map((group) => (
                          <div key={group.label} className="timer-records__group">
                            <div className="timer-records__group-label">{group.label}</div>
                            {group.sessions.map((session) => (
                              <div key={session.id} className="timer-records__item">
                                <strong>{formatSessionRange(session.startedAt, session.endedAt)}</strong>
                                <span className={`status-pill status-pill--${session.result === 'completed' ? 'done' : 'cancelled'}`}>
                                  {sessionResultLabel(session.result)}
                                </span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="timer-records__empty">还没有番茄钟记录</p>
                    )}
                  </div>
                </div>
              </Panel>
            </section>
          ) : null}

          {page === 'manage' ? (
            <section className="page-grid page-grid--manage">
              <Panel title="所有项目" bodyClassName="manage-panel-body">
                <div className="panel-toolbar">
                  <div className="header-actions">
                    <button
                      type="button"
                      className="action-button action-button--primary"
                      onClick={() => openProjectEditor('create')}
                    >
                      新增项目
                    </button>
                    <button
                      type="button"
                      className="action-button"
                      onClick={() => openProjectEditor('edit')}
                      disabled={!manageProject}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className="action-button action-button--ghost"
                      onClick={() =>
                        manageProject ? setConfirmState({ type: 'archive-project', projectId: manageProject.id }) : null
                      }
                      disabled={!manageProject}
                    >
                      归档
                    </button>
                    <button
                      type="button"
                      className="action-button action-button--ghost"
                      onClick={() =>
                        manageProject ? setConfirmState({ type: 'delete-project', projectId: manageProject.id }) : null
                      }
                      disabled={!manageProject}
                    >
                      删除
                    </button>
                  </div>
                </div>

                <div className="project-list">
                  {projects.length ? (
                    projects.map((project) => {
                      const metric = analytics.projectMetrics.find((item) => item.project.id === project.id)
                      return (
                        <button
                          key={project.id}
                          type="button"
                          className={project.id === manageProject?.id ? 'project-list-item active' : 'project-list-item'}
                          onClick={() => setManageProjectId(project.id)}
                        >
                          <div className="project-list-item__main">
                            <span className="project-list-item__color" style={{ backgroundColor: project.color }}></span>
                            <div>
                              <strong>{project.name}</strong>
                              <span>{metric?.openTodos ?? 0} 条未完成</span>
                            </div>
                          </div>
                          <span className={`status-pill status-pill--${projectStatusTone(project.status)}`}>
                            {projectStatusLabel(project.status)}
                          </span>
                        </button>
                      )
                    })
                  ) : (
                    <EmptyState title="没有项目" body="先创建一个项目。" />
                  )}
                </div>
              </Panel>

              <Panel title="代办" bodyClassName="manage-panel-body">
                <div className="panel-toolbar">
                  <button
                    type="button"
                    className="action-button action-button--primary"
                    onClick={() => openTodoEditor()}
                    disabled={!manageProject || manageProject.status === 'archived'}
                  >
                    新增代办
                  </button>
                </div>

                <div className="manage-todo-list">
                  {manageProjectTodos.length ? (
                    manageProjectTodos.map((todo) => (
                      <article key={todo.id} className="manage-todo-card">
                        <div className="manage-todo-card__head">
                          <div>
                            <h3>{todo.title}</h3>
                            <p>{todo.description || '暂无描述'}</p>
                          </div>
                          <div className="manage-todo-card__actions">
                            <button type="button" className="action-button" onClick={() => openTodoEditor(todo)}>
                              编辑
                            </button>
                            <button
                              type="button"
                              className="action-button action-button--ghost"
                              onClick={() => void handleDeleteTodo(todo.id)}
                            >
                              删除
                            </button>
                          </div>
                        </div>
                        <div className="manage-todo-card__meta">
                          <span className={`status-pill status-pill--${todo.status}`}>{statusLabels[todo.status]}</span>
                          <span className={`priority-pill priority-pill--${todo.priority}`}>{priorityLabels[todo.priority]}</span>
                          <span className="info-pill">{todo.completedPomodoros}/{todo.estimatedPomodoros} 个番茄</span>
                          <span className="info-pill">{todo.dueDate ?? '未排期'}</span>
                          {todo.isToday ? <span className="info-pill">今日</span> : null}
                        </div>
                      </article>
                    ))
                  ) : (
                    <EmptyState title="没有代办" body="先为这个项目创建一条代办。" />
                  )}
                </div>
              </Panel>
            </section>
          ) : null}

          {page === 'stats' ? (
            <section className="page-grid page-grid--stats">
              <div className="section-title-bar">
                <h2>统计复盘</h2>
              </div>
              <div className="stats-row">
                <MetricPanel
                  title="今日产出"
                  value={`${statsAnalytics.todayFocusCount} 个番茄`}
                  detail={formatDuration(statsAnalytics.todayFocusDurationSec)}
                />
                <MetricPanel
                  title="本周专注"
                  value={`${statsAnalytics.weekFocusCount} 次`}
                  detail={`中断 ${statsAnalytics.weekInterruptCount} 次`}
                />
                <MetricPanel
                  title="本月累计"
                  value={`${statsAnalytics.monthFocusCount} 次`}
                  detail={`完成率 ${Math.round(statsAnalytics.completionRate * 100)}%`}
                />
              </div>

              <div className="stats-layout">
                <Panel title="7 日趋势" bodyClassName="stats-panel-body">
                  <div className="trend-chart">
                    {statsAnalytics.dailyTrend.map((point) => (
                      <div key={point.dateKey} className="trend-column">
                        <span>{point.label}</span>
                        <div className="trend-column__bar-wrap">
                          <div
                            className="trend-column__bar"
                            style={{ height: `${Math.max(16, point.focusCount * 22)}px` }}
                          ></div>
                        </div>
                        <strong>{point.focusCount}</strong>
                      </div>
                    ))}
                  </div>
                </Panel>

                <Panel title="项目占比" bodyClassName="stats-panel-body">
                  <div className="share-list">
                    {statsAnalytics.projectMetrics.length ? (
                      statsAnalytics.projectMetrics.map((metric) => (
                        <div key={metric.project.id} className="share-row">
                          <div className="share-row__title">
                            <span className="project-dot" style={{ backgroundColor: metric.project.color }}></span>
                            <span>{metric.project.name}</span>
                          </div>
                          <div className="share-row__bar">
                            <div
                              style={{
                                width: `${Math.max(6, projectSharePercent(metric, statsAnalytics.projectMetrics))}%`,
                                backgroundColor: metric.project.color,
                              }}
                            ></div>
                          </div>
                          <strong>{projectSharePercent(metric, statsAnalytics.projectMetrics)}%</strong>
                        </div>
                      ))
                    ) : (
                      <EmptyState title="还没有统计数据" body="先去执行台完成几轮专注。" />
                    )}
                  </div>
                </Panel>

                <Panel
                  title="项目复盘"
                  bodyClassName="stats-panel-body"
                  actions={
                    <button
                      type="button"
                      className="action-button action-button--compact action-button--primary"
                      onClick={() => setProjectPickerMode('stats')}
                    >
                      选择项目
                    </button>
                  }
                >
                  {!statsProject ? (
                    <div className="project-review-list">
                      {statsAnalytics.projectMetrics.length ? (
                        statsAnalytics.projectMetrics.map((metric) => {
                          const totalTodos = metric.doneTodos + metric.openTodos
                          const completion = totalTodos > 0 ? Math.round((metric.doneTodos / totalTodos) * 100) : 0

                          return (
                            <button
                              key={metric.project.id}
                              type="button"
                              className="project-review-row"
                              onClick={() => setStatsProjectId(metric.project.id)}
                            >
                              <div className="project-review-row__main">
                                <span
                                  className="project-list-item__color"
                                  style={{ backgroundColor: metric.project.color }}
                                ></span>
                                <div>
                                  <strong>{metric.project.name}</strong>
                                  <span>
                                    已完成 {metric.doneTodos} / {totalTodos || 0}
                                  </span>
                                </div>
                              </div>
                              <div className="project-review-row__side">
                                <strong>{completion}%</strong>
                                <div className="project-review-row__bar">
                                  <div style={{ width: `${completion}%`, backgroundColor: metric.project.color }}></div>
                                </div>
                              </div>
                            </button>
                          )
                        })
                      ) : (
                        <EmptyState title="还没有项目复盘" body="先去执行台完成几轮专注。" />
                      )}
                    </div>
                  ) : reviewMetric ? (
                    <article className="project-metric-card">
                      <div className="project-metric-card__head">
                        <div>
                          <h3>{reviewMetric.project.name}</h3>
                          <p>
                            {reviewMetric.doneTodos} 个已完成 / {reviewMetric.openTodos} 个待推进
                          </p>
                        </div>
                      </div>
                      <div className="project-metric-card__stats">
                        <div className="compact-stat">
                          <span>实际番茄</span>
                          <strong>{reviewMetric.completedPomodoros}</strong>
                        </div>
                        <div className="compact-stat">
                          <span>预估番茄</span>
                          <strong>{reviewMetric.estimatedPomodoros}</strong>
                        </div>
                        <div className="compact-stat">
                          <span>专注时长</span>
                          <strong>{formatDuration(reviewMetric.focusDurationSec)}</strong>
                        </div>
                        <div className="compact-stat">
                          <span>中断次数</span>
                          <strong>{reviewMetric.interruptedCount}</strong>
                        </div>
                      </div>
                    </article>
                  ) : (
                    <EmptyState title="没有项目复盘" body="完成几轮专注后这里会自动生成。" />
                  )}
                </Panel>
              </div>
            </section>
          ) : null}
        </main>
      </div>

      {phaseAlertPrompt ? (
        <ModalShell
          title={phaseAlertPrompt.title}
          className={`modal-card--attention modal-card--attention-${phaseAlertPrompt.tone}`}
          onClose={acknowledgePhaseAlert}
          showCloseButton={false}
        >
          <div className="attention-dialog">
            <span className="attention-dialog__eyebrow">番茄提醒</span>
            <p className="attention-dialog__body">{phaseAlertPrompt.body}</p>
            <p className="attention-dialog__detail">{phaseAlertPrompt.detail}</p>
            <div className="attention-dialog__pulse" aria-hidden="true">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <div className="modal-form__actions">
              <button
                type="button"
                className="action-button action-button--primary attention-dialog__button"
                onClick={acknowledgePhaseAlert}
              >
                {phaseAlertPrompt.confirmLabel}
              </button>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {projectPickerMode ? (
        <ModalShell
          title={projectPickerMode === 'focus' ? '选择项目' : '选择统计范围'}
          onClose={() => setProjectPickerMode(null)}
        >
          <div className="picker-list">
            {projectPickerMode === 'stats' ? (
              <button
                type="button"
                className={statsProjectId === null ? 'picker-item active' : 'picker-item'}
                onClick={() => {
                  setStatsProjectId(null)
                  setProjectPickerMode(null)
                }}
              >
                <span className="picker-item__main">
                  <span className="project-dot"></span>
                  <span>综合</span>
                </span>
                <span className="picker-item__meta">全部项目</span>
              </button>
            ) : null}

            {(projectPickerMode === 'focus' ? focusProjects : projects).map((project) => {
              const active =
                projectPickerMode === 'focus'
                  ? selectedProject?.id === project.id
                  : statsProjectId === project.id

              return (
                <button
                  key={project.id}
                  type="button"
                  className={active ? 'picker-item active' : 'picker-item'}
                  onClick={() => {
                    if (projectPickerMode === 'focus') {
                      setSelectedProjectId(project.id)
                    } else {
                      setStatsProjectId(project.id)
                    }
                    setProjectPickerMode(null)
                  }}
                >
                  <span className="picker-item__main">
                    <span className="project-dot" style={{ backgroundColor: project.color }}></span>
                    <span>{project.name}</span>
                  </span>
                  <span className="picker-item__meta">{projectStatusLabel(project.status)}</span>
                </button>
              )
            })}
          </div>
        </ModalShell>
      ) : null}

      {settingsOpen ? (
        <ModalShell title="番茄钟设置" onClose={() => setSettingsOpen(false)}>
          <form
            className="settings-panel"
            onSubmit={(event) => {
              event.preventDefault()
              void saveSettingsAndRefresh(settingsDraft).then(() => setSettingsOpen(false))
            }}
          >
            <div className="settings-row">
              <label className="field">
                <span>专注</span>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={settingsDraft.focusMinutes}
                  onChange={(event) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      focusMinutes: clampNumber(event.target.value, 1, 90),
                    })
                  }
                />
              </label>
              <label className="field">
                <span>短休息</span>
                <input
                  type="number"
                  min={3}
                  max={30}
                  value={settingsDraft.shortBreakMinutes}
                  onChange={(event) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      shortBreakMinutes: clampNumber(event.target.value, 3, 30),
                    })
                  }
                />
              </label>
              <label className="field">
                <span>长休息</span>
                <input
                  type="number"
                  min={10}
                  max={45}
                  value={settingsDraft.longBreakMinutes}
                  onChange={(event) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      longBreakMinutes: clampNumber(event.target.value, 10, 45),
                    })
                  }
                />
              </label>
              <label className="field">
                <span>长休息间隔</span>
                <input
                  type="number"
                  min={2}
                  max={8}
                  value={settingsDraft.longBreakInterval}
                  onChange={(event) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      longBreakInterval: clampNumber(event.target.value, 2, 8),
                    })
                  }
                />
              </label>
            </div>

            <div className="toggle-grid">
              <ToggleField
                label="自动进入休息"
                checked={settingsDraft.autoStartBreaks}
                onChange={(checked) => setSettingsDraft({ ...settingsDraft, autoStartBreaks: checked })}
              />
              <ToggleField
                label="休息后自动继续"
                checked={settingsDraft.autoStartFocus}
                onChange={(checked) => setSettingsDraft({ ...settingsDraft, autoStartFocus: checked })}
              />
              <ToggleField
                label="系统通知"
                checked={settingsDraft.notificationsEnabled}
                onChange={(checked) =>
                  setSettingsDraft({ ...settingsDraft, notificationsEnabled: checked })
                }
              />
              <ToggleField
                label="关闭时进托盘"
                checked={settingsDraft.minimizeToTray}
                onChange={(checked) => setSettingsDraft({ ...settingsDraft, minimizeToTray: checked })}
              />
              <ToggleField
                label="开机自启"
                checked={settingsDraft.launchOnStartup}
                onChange={(checked) => setSettingsDraft({ ...settingsDraft, launchOnStartup: checked })}
              />
              <ToggleField
                label="声音提醒"
                checked={settingsDraft.soundEnabled}
                onChange={(checked) => setSettingsDraft({ ...settingsDraft, soundEnabled: checked })}
              />
            </div>

            <button type="submit" className="action-button action-button--primary">
              保存设置
            </button>
          </form>
        </ModalShell>
      ) : null}

      {projectEditorOpen ? (
        <ModalShell
          title={projectEditorMode === 'create' ? '新增项目' : '编辑项目'}
          onClose={() => setProjectEditorOpen(false)}
        >
          <form className="modal-form" onSubmit={handleProjectFormSubmit}>
            <label className="field">
              <span>项目名称</span>
              <input
                value={projectForm.name}
                onChange={(event) => setProjectForm({ ...projectForm, name: event.target.value })}
                placeholder="输入项目名称"
              />
            </label>

            <div className="modal-form__row modal-form__row--project">
              <label className="field">
                <span>状态</span>
                <select
                  value={projectForm.status}
                  onChange={(event) =>
                    setProjectForm({
                      ...projectForm,
                      status: event.target.value as Project['status'],
                    })
                  }
                >
                  <option value="active">进行中</option>
                  <option value="paused">暂停</option>
                  <option value="archived">归档</option>
                </select>
              </label>

              <div className="field">
                <span>颜色</span>
                <button type="button" className="color-trigger" onClick={() => setColorPickerOpen(true)}>
                  <span className="color-trigger__swatch" style={{ backgroundColor: projectForm.color }}></span>
                  <span>选择颜色</span>
                </button>
              </div>
            </div>

            <div className="modal-form__actions">
              <button
                type="button"
                className="action-button action-button--ghost"
                onClick={() => setProjectEditorOpen(false)}
              >
                取消
              </button>
              <button type="submit" className="action-button action-button--primary">
                保存项目
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {todoEditorOpen ? (
        <ModalShell title={todoEditorMode === 'create' ? '新增代办' : '编辑代办'} onClose={() => setTodoEditorOpen(false)}>
          <form className="modal-form" onSubmit={handleTodoFormSubmit}>
            <label className="field">
              <span>标题</span>
              <input
                value={todoForm.title}
                onChange={(event) => setTodoForm({ ...todoForm, title: event.target.value })}
                placeholder="输入任务标题"
              />
            </label>

            <label className="field">
              <span>描述</span>
              <textarea
                rows={3}
                value={todoForm.description}
                onChange={(event) => setTodoForm({ ...todoForm, description: event.target.value })}
                placeholder="补充任务描述"
              ></textarea>
            </label>

            <div className="modal-form__row modal-form__row--todo">
              <label className="field">
                <span>状态</span>
                <select
                  value={todoForm.status}
                  onChange={(event) => setTodoForm({ ...todoForm, status: event.target.value as TodoStatus })}
                >
                  <option value="todo">待开始</option>
                  <option value="in_progress">进行中</option>
                  <option value="done">已完成</option>
                  <option value="cancelled">已取消</option>
                </select>
              </label>

              <label className="field">
                <span>优先级</span>
                <select
                  value={todoForm.priority}
                  onChange={(event) => setTodoForm({ ...todoForm, priority: event.target.value as Priority })}
                >
                  <option value="high">高</option>
                  <option value="medium">中</option>
                  <option value="low">低</option>
                </select>
              </label>

            </div>

            <div className="modal-form__row modal-form__row--todo">
              <label className="field field--compact">
                <span>番茄数</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={todoForm.estimatedPomodoros}
                  onChange={(event) =>
                    setTodoForm({
                      ...todoForm,
                      estimatedPomodoros: Math.max(1, Math.min(20, Number(event.target.value) || 1)),
                    })
                  }
                />
              </label>

              <label className="field">
                <span>截止日期</span>
                <input
                  type="date"
                  value={todoForm.dueDate ?? ''}
                  onChange={(event) =>
                    setTodoForm({
                      ...todoForm,
                      dueDate: event.target.value.trim() || null,
                    })
                  }
                />
              </label>
            </div>

            <div className="modal-form__actions">
              <button
                type="button"
                className="action-button action-button--ghost"
                onClick={() => setTodoEditorOpen(false)}
              >
                取消
              </button>
              <button type="submit" className="action-button action-button--primary">
                保存代办
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {colorPickerOpen ? (
        <ModalShell title="选择项目颜色" className="modal-card--compact" onClose={() => setColorPickerOpen(false)}>
          <div className="color-swatch-grid">
            {projectColorOptions.map((color) => (
              <button
                key={color}
                type="button"
                className={color === projectForm.color ? 'color-swatch active' : 'color-swatch'}
                style={{ backgroundColor: color }}
                aria-label={`选择颜色 ${color}`}
                onClick={() => {
                  setProjectForm({ ...projectForm, color })
                  setColorPickerOpen(false)
                }}
              ></button>
            ))}
          </div>
        </ModalShell>
      ) : null}

      {confirmState ? (
        <ModalShell
          title={
            confirmState.type === 'complete-todo'
              ? '确认完成代办'
              : confirmState.type === 'archive-project'
                ? '确认归档项目'
                : '确认删除项目'
          }
          className="modal-card--compact"
          onClose={() => setConfirmState(null)}
        >
          <div className="confirm-dialog">
            <p>
              {confirmState.type === 'complete-todo'
                ? (() => {
                    const todo = todos.find((item) => item.id === confirmState.todoId)
                    return todo
                      ? `「${todo.title}」还有 ${getRemainingPomodoros(todo)} 个番茄未完成，仍然标记为完成？`
                      : '确认将这条代办标记为完成？'
                  })()
                : (() => {
                    const project = projects.find((item) => item.id === confirmState.projectId)
                    if (confirmState.type === 'archive-project') {
                      return project
                        ? `「${project.name}」会移入归档列表，确认继续？`
                        : '确认归档这个项目？'
                    }
                    return project
                      ? `「${project.name}」及其全部代办和专注记录会被永久移除，确认删除？`
                      : '确认删除这个项目？'
                  })()}
            </p>
            <div className="modal-form__actions">
              <button type="button" className="action-button action-button--ghost" onClick={() => setConfirmState(null)}>
                取消
              </button>
              <button
                type="button"
                className="action-button action-button--primary"
                onClick={async () => {
                  if (confirmState.type === 'complete-todo') {
                    const todo = todos.find((item) => item.id === confirmState.todoId)
                    if (todo) {
                      await completeTodo(todo)
                    }
                    setConfirmState(null)
                    return
                  }

                  const project = projects.find((item) => item.id === confirmState.projectId)
                  if (!project) {
                    setConfirmState(null)
                    return
                  }

                  if (confirmState.type === 'archive-project') {
                    await handleArchiveProject(project)
                    return
                  }

                  await handleDeleteProject(project)
                }}
              >
                确认
              </button>
            </div>
          </div>
        </ModalShell>
      ) : null}
    </>
  )
}

function Panel({
  title,
  actions,
  bodyClassName,
  children,
}: {
  title: string
  actions?: ReactNode
  bodyClassName?: string
  children: ReactNode
}) {
  return (
    <section className="panel">
      <header className="panel__head">
        <h3>{title}</h3>
        {actions ? <div className="panel__actions">{actions}</div> : null}
      </header>
      <div className={bodyClassName ? `panel__body ${bodyClassName}` : 'panel__body'}>{children}</div>
    </section>
  )
}

function ModalShell({
  title,
  className,
  children,
  onClose,
  showCloseButton = true,
}: {
  title: string
  className?: string
  children: ReactNode
  onClose: () => void
  showCloseButton?: boolean
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className={className ? `modal-card ${className}` : 'modal-card'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-card__head">
          <h3>{title}</h3>
          {showCloseButton ? (
            <button type="button" className="modal-close" onClick={onClose} aria-label="关闭弹窗">
              ×
            </button>
          ) : null}
        </header>
        <div className="modal-card__body">{children}</div>
      </section>
    </div>
  )
}

function MetricPanel({
  title,
  value,
  detail,
}: {
  title: string
  value: string
  detail: string
}) {
  return (
    <article className="metric-panel">
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  )
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="toggle-field">
      <span>{label}</span>
      <button
        type="button"
        className={checked ? 'toggle-switch active' : 'toggle-switch'}
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
      >
        <span></span>
      </button>
    </label>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  )
}

function NavIcon({ page }: { page: PageId }) {
  switch (page) {
    case 'focus':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="7"></circle>
          <circle cx="12" cy="12" r="2.5"></circle>
        </svg>
      )
    case 'manage':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="5" width="7" height="6" rx="1.5"></rect>
          <rect x="13" y="5" width="7" height="6" rx="1.5"></rect>
          <rect x="4" y="13" width="7" height="6" rx="1.5"></rect>
          <rect x="13" y="13" width="7" height="6" rx="1.5"></rect>
        </svg>
      )
    case 'stats':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 18V11"></path>
          <path d="M12 18V7"></path>
          <path d="M19 18V13"></path>
          <path d="M3.5 18.5h17"></path>
        </svg>
      )
  }
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 6l6 6-6 6"></path>
      {!collapsed ? <path d="M14 6l6 6-6 6"></path> : null}
    </svg>
  )
}

function projectStatusLabel(status: Project['status']): string {
  switch (status) {
    case 'active':
      return '进行中'
    case 'paused':
      return '暂停'
    case 'archived':
      return '归档'
  }
}

function projectStatusTone(status: Project['status']): 'in_progress' | 'todo' | 'cancelled' {
  switch (status) {
    case 'active':
      return 'in_progress'
    case 'paused':
      return 'todo'
    case 'archived':
      return 'cancelled'
  }
}

function phaseLabel(phase: TimerState['phase']): string {
  switch (phase) {
    case 'idle':
      return '待机'
    case 'focus':
      return '专注中'
    case 'short_break':
      return '短休息'
    case 'long_break':
      return '长休息'
  }
}

function timerBadge(
  timer: TimerState,
): { label: string; tone: 'todo' | 'in_progress' | 'done' | 'cancelled' } {
  if (!timer.running) {
    return {
      label: '已暂停',
      tone: 'todo',
    }
  }

  if (timer.phase === 'focus') {
    return {
      label: '专注中',
      tone: 'in_progress',
    }
  }

  return {
    label: '休息中',
    tone: 'done',
  }
}

function sessionResultLabel(result: 'completed' | 'interrupted' | 'skipped'): string {
  switch (result) {
    case 'completed':
      return '完成'
    case 'interrupted':
      return '终止'
    case 'skipped':
      return '跳过'
  }
}

function clampNumber(value: string, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number(value) || min))
}

function extractError(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.message
  }
  return String(reason)
}

export default App
