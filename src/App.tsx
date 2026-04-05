import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
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
  statusLabels,
} from './lib/analytics'
import {
  ACTIVATION_DURATION_SEC,
  getActivationContinuationDurationSec,
  idleActivationSession,
  resolveNextActivationTick,
  setActivationSessionRunning,
  shouldFinalizeActivationSession,
} from './lib/activation-session'
import { getFocusStartSuggestion, getFocusStartTodos } from './lib/focus-start'
import { idleTimer, resolveNextTimerTick, setTimerRunning, shouldFinalizeTimerPhase } from './lib/timer-tick'
import {
  archiveProject,
  deleteProject,
  deleteTodo,
  generateAiReview,
  generateFocusContinuation,
  generateTodoActivationRelief,
  generateTodoAiSuggestions,
  listenTrayActions,
  loadAiReviews,
  loadSnapshot,
  notifyPhaseChange,
  recordFocusSession,
  requestWindowAttention,
  saveAiReview,
  saveProject,
  saveSettings,
  saveTodo,
  showMainWindow,
  surfacePhaseAlertWindow,
  updateTrayStatus,
} from './lib/platform'
import {
  AI_REVIEW_TIMEFRAME,
  buildAiReviewDraftTitle,
  formatAiReviewScopeLabel,
  formatAiReviewTimeframeLabel,
  getAiReviewEligibility,
  sortAiReviews,
} from './lib/ai-review'
import { playPhaseAlertSound, primePhaseAlertSound } from './lib/phase-alert'
import {
  buildTodoActivationReliefDraft,
  buildTodoAiApplyDrafts,
  getEnhanceableTodos,
  hasAiCompletionConfig,
  pruneSelectedTodoIds,
  shouldApplyActivationReliefResult,
} from './lib/todo-ai'
import {
  buildTodoDraftFromTodo,
  getCurrentTodoStep,
  getResolvedTodoSteps,
  normalizeTodoDraft,
  parseTodoSteps,
} from './lib/todo-steps'
import {
  PHASE_REMINDER_INITIAL_DELAY_MS,
  PHASE_REMINDER_INTERVAL_MS,
  buildBreakCompletionPrompt,
  buildFocusCompletionPrompt,
  type PhaseAlertPrompt,
} from './lib/phase-prompt'
import type {
  ActivationBlockReason,
  ActivationSession,
  AiReviewRecord,
  AiReviewSummary,
  AppSettings,
  AppSnapshot,
  FocusContinuationSuggestion,
  FocusFeedbackDraft,
  PageId,
  Priority,
  Project,
  ProjectDraft,
  SaveAppSettingsInput,
  SessionResult,
  TimerState,
  Todo,
  TodoActivationRelief,
  TodoActivationReliefMode,
  TodoAiSuggestion,
  TodoDraft,
  TodoStatus,
} from './types'

type LaunchMoreTab = 'steps' | 'assist' | 'review'
type StatsPrimaryView = 'share' | 'review'

const LAUNCH_MORE_TAB_GROUP_ID = 'launch-more'
const STATS_ANALYSIS_TAB_GROUP_ID = 'stats-analysis'

const buildTabId = (groupId: string, tabId: string) => `${groupId}-tab-${tabId}`
const buildTabPanelId = (groupId: string, tabId: string) => `${groupId}-panel-${tabId}`

const handleTabListKeyDown = <TabId extends string>(
  event: KeyboardEvent<HTMLElement>,
  options: readonly TabId[],
  activeTab: TabId,
  setActiveTab: (tab: TabId) => void,
  groupId: string,
) => {
  if (!options.length) {
    return
  }

  const currentIndex = options.indexOf(activeTab)
  if (currentIndex === -1) {
    return
  }

  let nextIndex: number | null = null

  switch (event.key) {
    case 'ArrowRight':
      nextIndex = (currentIndex + 1) % options.length
      break
    case 'ArrowLeft':
      nextIndex = (currentIndex - 1 + options.length) % options.length
      break
    case 'Home':
      nextIndex = 0
      break
    case 'End':
      nextIndex = options.length - 1
      break
    default:
      return
  }

  if (nextIndex === null) {
    return
  }

  event.preventDefault()
  const nextTab = options[nextIndex]
  setActiveTab(nextTab)

  if (typeof document !== 'undefined') {
    const nextElement = document.getElementById(buildTabId(groupId, nextTab))
    nextElement?.focus()
  }
}

const pageMeta: Array<{ id: PageId; label: string }> = [
  { id: 'focus', label: '专注' },
  { id: 'manage', label: '项目库' },
  { id: 'stats', label: '复盘' },
]

const launchMoreTabOptions: Array<{ id: LaunchMoreTab; label: string }> = [
  { id: 'steps', label: '步骤' },
  { id: 'assist', label: 'AI 求助' },
  { id: 'review', label: '复盘' },
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
const emptyFocusStartSuggestion = {
  todoId: null,
  isResume: false,
  reason: '当前没有可直接开工的任务',
}
const activationBlockReasonOptions: Array<{
  id: ActivationBlockReason
  label: string
  hint: string
}> = [
  {
    id: 'unclear_start',
    label: '不知道从哪开始',
    hint: '直接给我第一步',
  },
  {
    id: 'task_too_big',
    label: '任务太大',
    hint: '先压缩成更小动作',
  },
  {
    id: 'details_too_fuzzy',
    label: '细节不够清楚',
    hint: '给我更具体的动作',
  },
  {
    id: 'context_switch',
    label: '刚被打断',
    hint: '帮我快速续上',
  },
]

function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  const [page, setPage] = useState<PageId>('focus')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [manageProjectId, setManageProjectId] = useState<string | null>(null)
  const [statsProjectId, setStatsProjectId] = useState<string | null>(null)
  const [statsPrimaryView, setStatsPrimaryView] = useState<StatsPrimaryView>('share')
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null)
  const [plannedPomodoros, setPlannedPomodoros] = useState(1)
  const [timer, setTimer] = useState<TimerState>(idleTimer)
  const [activationSession, setActivationSession] = useState<ActivationSession>(idleActivationSession)
  const [activationDecisionTodoId, setActivationDecisionTodoId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, setMessage] = useState<string | null>(null)
  const [phaseAlertPrompt, setPhaseAlertPrompt] = useState<PhaseAlertPrompt | null>(null)
  const [settingsDraft, setSettingsDraft] = useState<AppSettings | null>(null)
  const [settingsApiKeyDraft, setSettingsApiKeyDraft] = useState('')
  const [projectPickerMode, setProjectPickerMode] = useState<'focus' | 'stats' | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [projectEditorOpen, setProjectEditorOpen] = useState(false)
  const [projectEditorMode, setProjectEditorMode] = useState<'create' | 'edit'>('create')
  const [todoEditorOpen, setTodoEditorOpen] = useState(false)
  const [todoEditorMode, setTodoEditorMode] = useState<'create' | 'edit'>('create')
  const [todoAiPreviewOpen, setTodoAiPreviewOpen] = useState(false)
  const [todoAiPreview, setTodoAiPreview] = useState<TodoAiSuggestion[]>([])
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiApplying, setAiApplying] = useState(false)
  const [aiReviewHistory, setAiReviewHistory] = useState<AiReviewRecord[]>([])
  const [aiReviewDraft, setAiReviewDraft] = useState<AiReviewSummary | null>(null)
  const [aiReviewGenerating, setAiReviewGenerating] = useState(false)
  const [aiReviewSaving, setAiReviewSaving] = useState(false)
  const [selectedAiReviewRecord, setSelectedAiReviewRecord] = useState<AiReviewRecord | null>(null)
  const [colorPickerOpen, setColorPickerOpen] = useState(false)
  const [confirmState, setConfirmState] = useState<
    | { type: 'complete-todo'; todoId: string }
    | { type: 'archive-project'; projectId: string }
    | { type: 'delete-project'; projectId: string }
    | null
  >(null)
  const [selectedAiTodoIds, setSelectedAiTodoIds] = useState<string[]>([])
  const [focusFeedbackDraft, setFocusFeedbackDraft] = useState<FocusFeedbackDraft | null>(null)
  const [focusContinuationSuggestion, setFocusContinuationSuggestion] =
    useState<FocusContinuationSuggestion | null>(null)
  const [focusContinuationDraft, setFocusContinuationDraft] = useState<string[]>([])
  const [focusContinuationQuickStartDraft, setFocusContinuationQuickStartDraft] = useState('')
  const [focusContinuationGenerating, setFocusContinuationGenerating] = useState(false)
  const [, setFocusFeedbackOpen] = useState(false)
  const [focusFeedbackCollapsed, setFocusFeedbackCollapsed] = useState(false)
  const [activationBlockReason, setActivationBlockReason] =
    useState<ActivationBlockReason>('unclear_start')
  const [todoActivationRelief, setTodoActivationRelief] = useState<TodoActivationRelief | null>(null)
  const [activationReliefHelpful, setActivationReliefHelpful] = useState(false)
  const [activationAiGenerating, setActivationAiGenerating] = useState(false)
  const [, setActivationAssistOpen] = useState(false)
  const [, setLaunchManageOpen] = useState(false)
  const [launchDetailsOpen, setLaunchDetailsOpen] = useState(false)
  const [launchMoreOpen, setLaunchMoreOpen] = useState(false)
  const [launchMoreTab, setLaunchMoreTab] = useState<LaunchMoreTab>('steps')
  const launchMoreTabIds = useMemo<LaunchMoreTab[]>(() => launchMoreTabOptions.map((tab) => tab.id), [])
  const statsPrimaryViewIds = useMemo<StatsPrimaryView[]>(() => ['share', 'review'], [])
  const [todoContextOpen, setTodoContextOpen] = useState(false)
  const focusFeedbackCardRef = useRef<HTMLDivElement | null>(null)
  const activationReliefRequestIdRef = useRef(0)
  const latestSelectedTodoIdRef = useRef<string | null>(null)
  const [projectForm, setProjectForm] = useState<ProjectDraft>({
    name: '',
    color: projectColorOptions[0],
    icon: 'book',
    status: 'active',
  })
  const [todoForm, setTodoForm] = useState<TodoDraft>({
    projectId: '',
    title: '',
    quickStartStep: '',
    description: '',
    notes: '',
    status: 'todo',
    priority: 'medium',
    estimatedPomodoros: 1,
    dueDate: null,
    isToday: false,
    steps: [],
    currentStepIndex: 0,
  })
  const todoFormStepsText = todoForm.steps.join('\n')
  const deferredSnapshot = useDeferredValue(snapshot)

  const analytics = useMemo(
    () => (deferredSnapshot ? buildAnalytics(deferredSnapshot) : fallbackAnalytics),
    [deferredSnapshot],
  )

  const projects = snapshot?.projects ?? emptyProjects
  const todos = snapshot?.todos ?? emptyTodos
  const focusProjects = projects.filter((project) => project.status !== 'archived')
  const globalFocusTodos = useMemo(() => (snapshot ? getFocusStartTodos(snapshot, null) : []), [snapshot])
  const defaultFocusProjectId = globalFocusTodos[0]?.projectId ?? focusProjects[0]?.id ?? null
  const selectedProject =
    focusProjects.find((project) => project.id === selectedProjectId) ??
    focusProjects.find((project) => project.id === defaultFocusProjectId) ??
    focusProjects[0] ??
    null
  const manageProject = projects.find((project) => project.id === manageProjectId) ?? projects[0] ?? null
  const statsProject = projects.find((project) => project.id === statsProjectId) ?? null

  const projectTodos = useMemo(
    () => (snapshot && selectedProject ? getFocusStartTodos(snapshot, selectedProject.id) : []),
    [selectedProject, snapshot],
  )
  const focusSuggestion = useMemo(
    () =>
      snapshot && selectedProject
        ? getFocusStartSuggestion(snapshot, selectedProject.id)
        : emptyFocusStartSuggestion,
    [selectedProject, snapshot],
  )
  const selectedTodo =
    projectTodos.find((todo) => todo.id === selectedTodoId) ??
    projectTodos.find((todo) => todo.id === focusSuggestion.todoId) ??
    projectTodos[0] ??
    null
  const manageProjectTodos = useMemo(
    () => (manageProject ? todos.filter((todo) => todo.projectId === manageProject.id) : []),
    [manageProject, todos],
  )
  const manageEnhanceableTodos = useMemo(
    () => (manageProject ? getEnhanceableTodos(todos, manageProject.id) : []),
    [manageProject, todos],
  )
  const selectedManageAiTodoIds = useMemo(
    () => pruneSelectedTodoIds(selectedAiTodoIds, manageEnhanceableTodos),
    [manageEnhanceableTodos, selectedAiTodoIds],
  )
  const activeTimerTodo = timer.todoId ? todos.find((todo) => todo.id === timer.todoId) ?? null : null
  const activationTodo =
    activationSession.todoId ? todos.find((todo) => todo.id === activationSession.todoId) ?? null : null
  const activationDecisionTodo =
    activationDecisionTodoId ? todos.find((todo) => todo.id === activationDecisionTodoId) ?? null : null
  const focusInteractionLocked =
    timer.phase !== 'idle' || Boolean(activationSession.todoId) || Boolean(activationDecisionTodoId)
  const aiConfigured = settingsDraft ? hasAiCompletionConfig(settingsDraft) : false
  const aiConfiguredHint = settingsDraft?.aiApiKeyConfigured ? '已保存本机密钥，留空则保持不变' : '尚未保存密钥'
  const aiReviewEligibility = snapshot
    ? getAiReviewEligibility(snapshot, statsProject?.id ?? null)
    : { canGenerate: false, reason: '正在装载统计数据', focusCount: 0 }
  const aiActionDisabledReason =
    !manageProject
      ? '先选择一个项目'
      : manageProject.status === 'archived'
        ? '归档项目暂不支持 AI 拆解'
        : !manageEnhanceableTodos.length
          ? '当前项目没有待推进代办'
          : !selectedManageAiTodoIds.length
            ? '先勾选要交给 AI 处理的代办'
          : !aiConfigured
            ? '先在设置中填写 AI 接口'
            : aiGenerating
              ? 'AI 正在生成预览'
              : aiApplying
                ? '正在写回 AI 结果'
                : null
  const aiReviewDisabledReason =
    !aiConfigured
      ? '先在设置中填写 AI 接口'
      : aiReviewGenerating
        ? 'AI 正在生成复盘'
        : aiReviewSaving
          ? '正在保存复盘'
          : aiReviewEligibility.canGenerate
            ? null
            : aiReviewEligibility.reason
  const statsSnapshot = useMemo(
    () =>
      snapshot
        ? statsProjectId
          ? {
              settings: snapshot.settings,
              projects: snapshot.projects.filter((project) => project.id === statsProjectId),
              todos: snapshot.todos.filter((todo) => todo.projectId === statsProjectId),
              sessions: snapshot.sessions.filter(
                (session) => session.type === 'focus' && session.projectId === statsProjectId,
              ),
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
  const activationContinuationDurationSec = getActivationContinuationDurationSec(settingsDraft?.focusMinutes ?? 25)
  const timerPhaseTotalSec = useMemo(() => {
    if (timer.phase === 'idle') {
      return 0
    }
    return timer.plannedDurationSec
  }, [timer.phase, timer.plannedDurationSec])

  const timerFaceProgress =
    timer.phase === 'idle' || timerPhaseTotalSec === 0
      ? 0
      : Math.round(((timerPhaseTotalSec - timer.remainingSec) / timerPhaseTotalSec) * 100)
  const timerDisplaySeconds = timer.phase === 'idle' ? (settingsDraft ? settingsDraft.focusMinutes * 60 : 0) : timer.remainingSec
  const activationProgress = activationSession.todoId
    ? Math.round(((ACTIVATION_DURATION_SEC - activationSession.remainingSec) / ACTIVATION_DURATION_SEC) * 100)
    : 0
  const supportTimerPhase = activationSession.todoId ? 'activation' : timer.phase
  const supportTimerProgress = activationSession.todoId ? activationProgress : timerFaceProgress
  const supportTimerDisplaySeconds = activationSession.todoId ? activationSession.remainingSec : timerDisplaySeconds
  const supportTimerTodo = activeTimerTodo ?? activationTodo ?? selectedTodo
  const supportTimerStatusLabel = activationSession.todoId
    ? activationSession.running
      ? '5 分钟启动中'
      : '5 分钟启动已暂停'
    : timer.phase === 'idle'
      ? '准备开始'
      : timer.running
        ? phaseLabel(timer.phase)
        : `${phaseLabel(timer.phase)} · 已暂停`
  const focusHistoryProjectId = selectedProject?.id ?? null
  const recentFocusRecordGroups = useMemo(() => {
    if (!snapshot) {
      return []
    }

    const recentSessions = snapshot.sessions
      .filter(
        (session): session is Extract<(typeof snapshot.sessions)[number], { type: 'focus' }> =>
          session.type === 'focus' &&
          (session.result === 'completed' || session.result === 'interrupted'),
      )
      .filter((session) => (focusHistoryProjectId ? session.projectId === focusHistoryProjectId : true))
      .sort((left, right) => {
        const leftTime = new Date(left.endedAt ?? left.startedAt).getTime()
        const rightTime = new Date(right.endedAt ?? right.startedAt).getTime()
        return rightTime - leftTime
      })
      .slice(0, 8)

    const groups = new Map<
      string,
      {
        dateKey: string
        label: string
        items: Array<{
          id: string
          title: string
          endedAt: string
          durationSec: number
          result: SessionResult
          interruptReason: string | null
        }>
      }
    >()

    for (const session of recentSessions) {
      const endedAt = session.endedAt ?? session.startedAt
      const dateKey = endedAt.slice(0, 10)
      const todo = todos.find((item) => item.id === session.todoId)
      const group = groups.get(dateKey) ?? {
        dateKey,
        label: formatSessionDateLabel(endedAt),
        items: [],
      }
      group.items.push({
        id: session.id,
        title: todo?.title ?? '未命名任务',
        endedAt,
        durationSec: session.actualDurationSec,
        result: session.result,
        interruptReason: session.interruptReason,
      })
      groups.set(dateKey, group)
    }

    return Array.from(groups.values())
  }, [focusHistoryProjectId, snapshot, todos])
  const focusQueue = useMemo(
    () => projectTodos.filter((todo) => todo.id !== selectedTodo?.id).slice(0, 4),
    [projectTodos, selectedTodo?.id],
  )
  const kickoffPrimaryLabel =
    selectedTodo && focusSuggestion.isResume && selectedTodo.id === focusSuggestion.todoId
      ? '继续上一轮专注'
      : '开始 25 分钟专注'
  const focusContinuationDisabledReason =
    !selectedTodo
      ? '先选择任务'
      : !focusFeedbackDraft
        ? '正在准备复盘表单'
        : !aiConfigured
          ? '先在设置中填写 AI 接口'
          : !focusFeedbackDraft.completedText.trim()
            ? '先填写本轮已完成内容'
            : focusContinuationGenerating
              ? 'AI 正在生成建议'
              : null
  const focusFeedbackFilledCount = [
    focusFeedbackDraft?.completedText,
    focusFeedbackDraft?.issueText,
    focusFeedbackDraft?.riskText,
  ].filter((value) => Boolean(value?.trim())).length
  const shouldAutoOpenLaunchDetails = selectedTodo
    ? !selectedTodo.quickStartStep.trim() || !selectedTodo.description.trim()
    : false
  const selectedActivationBlockReason =
    activationBlockReasonOptions.find((option) => option.id === activationBlockReason) ??
    activationBlockReasonOptions[0]
  const selectedTodoSteps = selectedTodo ? getResolvedTodoSteps(selectedTodo) : []
  const selectedTodoCurrentStepIndex = selectedTodo?.currentStepIndex ?? 0
  const selectedTodoQuickStartStep = selectedTodo?.quickStartStep.trim() ?? ''
  const selectedTodoCurrentStep = selectedTodo
    ? getCurrentTodoStep(selectedTodo) || '还没有最简启动步骤'
    : '还没有最简启动步骤'
  const hasLaunchContextSteps = selectedTodoSteps.length > 0
  const launchContextFallback =
    selectedTodoCurrentStep || '还没有补充后续步骤，先完成这一轮，再补详细推进路径。'
  const launchContextItems = hasLaunchContextSteps
    ? selectedTodoSteps
    : [launchContextFallback]
  const remainingPomodoros = selectedTodo ? getRemainingPomodoros(selectedTodo) : 0

  useEffect(() => {
    if (!focusContinuationSuggestion) {
      setFocusContinuationQuickStartDraft('')
      setFocusContinuationDraft([])
      return
    }

    setFocusContinuationQuickStartDraft(focusContinuationSuggestion.quickStartStep)
    setFocusContinuationDraft(focusContinuationSuggestion.nextSteps)
  }, [focusContinuationSuggestion])

  const findLatestCompletedFocusSessionId = (todoId: string, projectId: string): string | null => {
    if (!snapshot) {
      return null
    }
    return (
      snapshot.sessions.find(
        (session) =>
          session.type === 'focus' &&
          session.result === 'completed' &&
          session.todoId === todoId &&
          session.projectId === projectId,
      )?.id ?? null
    )
  }

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    Promise.all([loadSnapshot(), loadAiReviews().catch(() => [])])
      .then(([next, reviews]) => {
        if (cancelled) {
          return
        }
        startTransition(() => setSnapshot(next))
        setSettingsDraft(next.settings)
        setSettingsApiKeyDraft('')
        setAiReviewHistory(sortAiReviews(reviews))
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
      setSelectedProjectId(defaultFocusProjectId)
    }

    if (!projects.length) {
      setManageProjectId(null)
    } else if (!manageProjectId || !projects.some((project) => project.id === manageProjectId)) {
      setManageProjectId(projects[0].id)
    }

    if (statsProjectId && !projects.some((project) => project.id === statsProjectId)) {
      setStatsProjectId(null)
    }
  }, [defaultFocusProjectId, focusProjects, manageProjectId, projects, selectedProjectId, statsProjectId])

  useEffect(() => {
    if (!selectedProject) {
      setSelectedTodoId(null)
      return
    }
    if (!selectedTodoId || !projectTodos.some((todo) => todo.id === selectedTodoId)) {
      setSelectedTodoId(focusSuggestion.todoId ?? projectTodos[0]?.id ?? null)
    }
  }, [focusSuggestion.todoId, projectTodos, selectedProject, selectedTodoId])

  useLayoutEffect(() => {
    latestSelectedTodoIdRef.current = selectedTodo?.id ?? null
  }, [selectedTodo?.id])

  useEffect(() => {
    setPlannedPomodoros(Math.max(1, selectedTodo?.estimatedPomodoros ?? 1))
  }, [selectedTodo?.estimatedPomodoros, selectedTodo?.id])

  useEffect(() => {
    setTodoActivationRelief(null)
    setActivationReliefHelpful(false)
    setActivationBlockReason('unclear_start')
    setActivationAssistOpen(false)
    setLaunchManageOpen(false)
    setLaunchDetailsOpen(shouldAutoOpenLaunchDetails)
    setLaunchMoreOpen(false)
    setLaunchMoreTab('steps')
  }, [selectedTodo?.id, shouldAutoOpenLaunchDetails])

  useEffect(() => {
    if (!selectedTodo) {
      setFocusFeedbackDraft(null)
      setFocusContinuationSuggestion(null)
      setFocusFeedbackOpen(false)
      return
    }

    setFocusFeedbackDraft((current) => {
      if (current && current.todoId === selectedTodo.id && current.projectId === selectedTodo.projectId) {
        return current
      }
      return {
        projectId: selectedTodo.projectId,
        todoId: selectedTodo.id,
        sessionId: null,
        completedText: '',
        issueText: '',
        riskText: '',
      }
    })
    setFocusContinuationSuggestion(null)
    setFocusFeedbackOpen(false)
    setFocusFeedbackCollapsed(false)
  }, [selectedTodo])

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

  useEffect(() => {
    if (!activationDecisionTodoId) {
      return
    }

    void surfacePhaseAlertWindow()

    return () => {
      void requestWindowAttention(false)
    }
  }, [activationDecisionTodoId])

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
      setSettingsApiKeyDraft('')
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

  const saveSettingsAndRefresh = async (next: SaveAppSettingsInput) => {
    setSettingsDraft({
      focusMinutes: next.focusMinutes,
      shortBreakMinutes: next.shortBreakMinutes,
      longBreakMinutes: next.longBreakMinutes,
      longBreakInterval: next.longBreakInterval,
      autoStartBreaks: next.autoStartBreaks,
      autoStartFocus: next.autoStartFocus,
      notificationsEnabled: next.notificationsEnabled,
      minimizeToTray: next.minimizeToTray,
      launchOnStartup: next.launchOnStartup,
      soundEnabled: next.soundEnabled,
      aiBaseUrl: next.aiBaseUrl,
      aiApiKeyConfigured: next.aiApiKey.trim() ? true : next.aiApiKeyConfigured,
      aiModelId: next.aiModelId,
    })
    await syncSnapshot(saveSettings(next), { message: '偏好设置已保存' })
  }

  const startFocusRun = async (options?: {
    todo?: Todo
    targetPomodoros?: number
    durationSec?: number
  }) => {
    if (!snapshot) {
      return
    }

    const nextTodo = options?.todo ?? selectedTodo
    if (!nextTodo) {
      return
    }

    const nextProject =
      focusProjects.find((project) => project.id === nextTodo.projectId) ??
      projects.find((project) => project.id === nextTodo.projectId) ??
      null
    if (!nextProject) {
      return
    }

    setPhaseAlertPrompt(null)
    setActivationSession(idleActivationSession)
    setActivationDecisionTodoId(null)
    setTodoActivationRelief(null)
    void primePhaseAlertSound()

    const target = Math.max(1, options?.targetPomodoros ?? plannedPomodoros)
    const durationSec = Math.max(60, options?.durationSec ?? snapshot.settings.focusMinutes * 60)
    const startedAt = new Date().toISOString()
    const deadlineAt = new Date(Date.parse(startedAt) + durationSec * 1000).toISOString()

    setSelectedProjectId(nextProject.id)
    setSelectedTodoId(nextTodo.id)
    setTimer({
      phase: 'focus',
      running: true,
      remainingSec: durationSec,
      plannedDurationSec: durationSec,
      targetPomodoros: target,
      completedPomodoros: 0,
      todoId: nextTodo.id,
      projectId: nextProject.id,
      phaseStartedAt: startedAt,
      deadlineAt,
    })

    if (nextTodo.status === 'todo' || nextTodo.estimatedPomodoros !== target) {
      await syncSnapshot(
        saveTodo(
          buildTodoDraftFromTodo(nextTodo, {
            status: nextTodo.status === 'todo' ? 'in_progress' : nextTodo.status,
            estimatedPomodoros: target,
          }),
        ),
        { silent: true },
      )
    }

    setMessage(
      durationSec === snapshot.settings.focusMinutes * 60
        ? `已绑定「${nextTodo.title}」并开启 ${target} 个番茄`
        : `已从 5 分钟开工切换到 ${formatDuration(durationSec)} 的专注`,
    )
  }

  const startActivationRun = async (todo?: Todo) => {
    if (!snapshot) {
      return
    }

    const nextTodo = todo ?? selectedTodo
    if (!nextTodo) {
      return
    }

    const nextProject =
      focusProjects.find((project) => project.id === nextTodo.projectId) ??
      projects.find((project) => project.id === nextTodo.projectId) ??
      null
    if (!nextProject) {
      return
    }

    setPhaseAlertPrompt(null)
    setActivationDecisionTodoId(null)
    setTodoActivationRelief(null)
    void primePhaseAlertSound()

    const startedAt = new Date().toISOString()
    const deadlineAt = new Date(Date.parse(startedAt) + ACTIVATION_DURATION_SEC * 1000).toISOString()

    setSelectedProjectId(nextProject.id)
    setSelectedTodoId(nextTodo.id)
    setActivationSession({
      running: true,
      remainingSec: ACTIVATION_DURATION_SEC,
      todoId: nextTodo.id,
      projectId: nextProject.id,
      startedAt,
      deadlineAt,
    })

    if (nextTodo.status === 'todo') {
      await syncSnapshot(
        saveTodo(
          buildTodoDraftFromTodo(nextTodo, {
            status: 'in_progress',
          }),
        ),
        { silent: true },
      )
    }

    setMessage(`先用 5 分钟把「${nextTodo.title}」做起来`)
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
            plannedDurationSec: current.plannedDurationSec,
            actualDurationSec: current.plannedDurationSec,
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
          plannedDurationSec: nextSeconds,
          completedPomodoros: nextCompleted,
          phaseStartedAt: now,
          deadlineAt: snapshot.settings.autoStartBreaks
            ? new Date(Date.parse(now) + nextSeconds * 1000).toISOString()
            : null,
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
        plannedDurationSec: snapshot.settings.focusMinutes * 60,
        phaseStartedAt: now,
        deadlineAt: snapshot.settings.autoStartFocus
          ? new Date(Date.parse(now) + snapshot.settings.focusMinutes * 60 * 1000).toISOString()
          : null,
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

  const finalizeActivationRun = useEffectEvent(async (current: ActivationSession) => {
    if (!current.todoId) {
      return
    }

    const todo = snapshot?.todos.find((item) => item.id === current.todoId) ?? null
    setActivationDecisionTodoId(current.todoId)
    setActivationSession(idleActivationSession)

    if (settingsDraft?.soundEnabled) {
      await playPhaseAlertSound('focus_complete')
    }
    if (settingsDraft?.notificationsEnabled && todo) {
      await notifyPhaseChange('5 分钟开工结束', `要继续推进「${todo.title}」吗？`)
    }
  })

  useEffect(() => {
    if (!activationSession.todoId || !activationSession.running) {
      return
    }

    const interval = window.setInterval(() => {
      setActivationSession((current) => resolveNextActivationTick(current))
    }, 1000)

    return () => {
      window.clearInterval(interval)
    }
  }, [activationSession.running, activationSession.todoId])

  useEffect(() => {
    if (!shouldFinalizeActivationSession(activationSession)) {
      return
    }

    void finalizeActivationRun(activationSession)
  }, [activationSession])

  const handleInterrupt = async () => {
    if (!snapshot || !timer.todoId || !timer.projectId || timer.phase === 'idle') {
      return
    }

    setPhaseAlertPrompt(null)
    const now = new Date().toISOString()
    const plannedDurationSec =
      timer.phase === 'focus'
        ? timer.plannedDurationSec
        : timer.phase === 'short_break'
          ? snapshot.settings.shortBreakMinutes * 60
          : snapshot.settings.longBreakMinutes * 60
    const actualDurationSec = Math.max(0, plannedDurationSec - timer.remainingSec)

    await syncSnapshot(
      recordFocusSession(
        timer.phase === 'focus'
          ? {
              projectId: timer.projectId,
              todoId: timer.todoId,
              type: 'focus',
              plannedDurationSec,
              actualDurationSec,
              startedAt: timer.phaseStartedAt ?? now,
              endedAt: now,
              result: 'interrupted',
              interruptReason: '手动终止',
            }
          : {
              type: timer.phase,
              plannedDurationSec,
              actualDurationSec,
              startedAt: timer.phaseStartedAt ?? now,
              endedAt: now,
              result: 'skipped',
              interruptReason: '主动跳过休息',
            },
      ),
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
      plannedDurationSec: snapshot.settings.focusMinutes * 60,
      phaseStartedAt: now,
      deadlineAt: new Date(Date.parse(now) + snapshot.settings.focusMinutes * 60 * 1000).toISOString(),
    })
    setMessage('已跳过休息，重新进入专注')
  }

  const onTrayAction = useEffectEvent((action: string) => {
    if (action === 'open') {
      void showMainWindow()
      return
    }
    if (action === 'toggle-timer') {
      if (activationDecisionTodoId) {
        void showMainWindow()
        return
      }
      if (timer.phase === 'idle') {
        if (activationSession.todoId) {
          setActivationSession((current) => setActivationSessionRunning(current, !current.running))
          return
        }
        void startActivationRun()
        return
      }
      setTimer((current) => setTimerRunning(current, !current.running))
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
      activationSession.todoId
        ? `Pomodoro Workbench · 5 分钟开工${activationSession.running ? '' : ' · 已暂停'} · ${formatClock(activationSession.remainingSec)}`
        : timer.phase === 'idle'
          ? 'Pomodoro Workbench · 待机'
          : `Pomodoro Workbench · ${phaseLabel(timer.phase)} · ${formatClock(timer.remainingSec)}`
    void updateTrayStatus(text)
  }, [activationSession.remainingSec, activationSession.running, activationSession.todoId, timer.phase, timer.remainingSec])

  useEffect(() => {
    setProjectPickerMode(null)
    setSettingsOpen(false)
    setProjectEditorOpen(false)
    setTodoEditorOpen(false)
    setTodoAiPreviewOpen(false)
    setTodoAiPreview([])
    setTodoActivationRelief(null)
    setAiReviewDraft(null)
    setSelectedAiReviewRecord(null)
    setSelectedAiTodoIds([])
    setColorPickerOpen(false)
    setConfirmState(null)
    setLaunchManageOpen(false)
    setFocusFeedbackOpen(false)
    setLaunchMoreOpen(false)
    setLaunchMoreTab('steps')
  }, [page])

  useEffect(() => {
    if (!settingsOpen) {
      setSettingsApiKeyDraft('')
    }
  }, [settingsOpen])

  useEffect(() => {
    setSelectedAiTodoIds((current) => pruneSelectedTodoIds(current, manageEnhanceableTodos))
  }, [manageEnhanceableTodos])

  useEffect(() => {
    setAiReviewDraft(null)
    setSelectedAiReviewRecord(null)
  }, [statsProjectId])

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
      const resolvedSteps = getResolvedTodoSteps(todo)
      setTodoContextOpen(Boolean(todo.description.trim()))
      setTodoForm(
        normalizeTodoDraft({
          id: todo.id,
          projectId: todo.projectId,
          title: todo.title,
          quickStartStep: todo.quickStartStep,
          description: todo.description,
          notes: todo.notes,
          status: todo.status,
          priority: todo.priority,
          estimatedPomodoros: todo.estimatedPomodoros,
          dueDate: todo.dueDate,
          isToday: todo.isToday,
          steps: resolvedSteps,
          currentStepIndex: todo.currentStepIndex,
        }),
      )
    } else {
      setTodoContextOpen(false)
      setTodoForm(
        normalizeTodoDraft({
          projectId: manageProject?.id ?? projects[0]?.id ?? '',
          title: '',
          quickStartStep: '',
          description: '',
          notes: '',
          status: 'todo',
          priority: 'medium',
          estimatedPomodoros: 1,
          dueDate: null,
          isToday: false,
          steps: [],
          currentStepIndex: 0,
        }),
      )
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

    const nextDraft = normalizeTodoDraft({
      ...todoForm,
      steps: todoForm.steps,
      currentStepIndex: todoForm.currentStepIndex,
    })

    const next = await syncSnapshot(saveTodo(nextDraft), {
      message: todoEditorMode === 'create' ? '代办已创建' : '代办已更新',
    })
    if (!next) {
      return
    }

    setManageProjectId(nextDraft.projectId)
    if (selectedProject?.id === nextDraft.projectId || !selectedProject) {
      setSelectedProjectId(nextDraft.projectId)
    }
    if (!nextDraft.id) {
      setSelectedTodoId(next.todos[0]?.id ?? null)
    }
    closeTodoEditor()
  }

  const closeTodoEditor = () => {
    setTodoEditorOpen(false)
    setTodoContextOpen(false)
  }

  const handleDeleteTodo = async (todoId: string) => {
    await syncSnapshot(deleteTodo(todoId), { message: '代办已删除' })
    if (selectedTodoId === todoId) {
      setSelectedTodoId(null)
    }
    if (todoForm.id === todoId) {
      closeTodoEditor()
    }
  }

  const completeTodo = async (todo: Todo) => {
    await syncSnapshot(
      saveTodo(
        buildTodoDraftFromTodo(todo, {
          status: 'done',
        }),
      ),
      { message: '代办已完成' },
    )
  }

  const handleArchiveProject = async (project: Project) => {
    await syncSnapshot(archiveProject(project.id, true), { message: '项目已归档' })
    setConfirmState(null)
  }

  const handleDeleteProject = async (project: Project) => {
    await syncSnapshot(deleteProject(project.id), { message: '项目已删除' })
    setConfirmState(null)
  }

  const closeTodoAiPreview = () => {
    if (aiApplying) {
      return
    }
    setTodoAiPreviewOpen(false)
    setTodoAiPreview([])
  }

  const toggleAiTodoSelection = (todoId: string) => {
    setSelectedAiTodoIds((current) =>
      current.includes(todoId) ? current.filter((item) => item !== todoId) : [...current, todoId],
    )
  }

  const selectAllManageAiTodos = () => {
    setSelectedAiTodoIds(manageEnhanceableTodos.map((todo) => todo.id))
  }

  const clearManageAiTodoSelection = () => {
    setSelectedAiTodoIds([])
  }

  const handleGenerateTodoAiPreview = async () => {
    if (!manageProject || aiActionDisabledReason) {
      setError(aiActionDisabledReason ?? '当前无法生成 AI 预览')
      return
    }

    setAiGenerating(true)
    setError(null)
    setTodoAiPreview([])
    setTodoAiPreviewOpen(false)

    try {
      const nextPreview = await generateTodoAiSuggestions(manageProject.id, selectedManageAiTodoIds)
      setTodoAiPreview(nextPreview)
      setTodoAiPreviewOpen(true)
    } catch (reason) {
      setError(extractError(reason))
    } finally {
      setAiGenerating(false)
    }
  }

  const handleApplyTodoAiPreview = async () => {
    if (!snapshot || !todoAiPreview.length) {
      return
    }

    setAiApplying(true)
    setBusy(true)
    setError(null)

    try {
      const drafts = buildTodoAiApplyDrafts(snapshot.todos, todoAiPreview)
      let lastSnapshot = snapshot

      for (const draft of drafts) {
        lastSnapshot = await saveTodo(draft)
      }

      startTransition(() => setSnapshot(lastSnapshot))
      setSettingsDraft(lastSnapshot.settings)
      setTodoAiPreviewOpen(false)
      setTodoAiPreview([])
      setSelectedAiTodoIds([])
      setMessage(`已用 AI 更新 ${drafts.length} 条代办的最简启动步骤和描述`)
    } catch (reason) {
      setError(extractError(reason))
    } finally {
      setAiApplying(false)
      setBusy(false)
    }
  }

  const handleGenerateAiReview = async () => {
    if (aiReviewDisabledReason) {
      setError(aiReviewDisabledReason)
      return
    }

    setAiReviewGenerating(true)
    setError(null)
    setAiReviewDraft(null)
    setSelectedAiReviewRecord(null)

    try {
      const nextReview = await generateAiReview(statsProject?.id ?? null)
      setAiReviewDraft(nextReview)
      setMessage('AI 复盘已生成，确认后可保存到历史')
    } catch (reason) {
      setError(extractError(reason))
    } finally {
      setAiReviewGenerating(false)
    }
  }

  const handleSaveAiReview = async () => {
    if (!aiReviewDraft) {
      return
    }

    setAiReviewSaving(true)
    setError(null)

    try {
      const savedReview = await saveAiReview({
        scope: statsProject ? 'project' : 'all',
        projectId: statsProject?.id ?? null,
        projectName: statsProject?.name ?? null,
        timeframe: AI_REVIEW_TIMEFRAME,
        summary: aiReviewDraft.summary,
        issues: aiReviewDraft.issues,
        suggestions: aiReviewDraft.suggestions,
      })
      setAiReviewHistory((current) => sortAiReviews([savedReview, ...current]))
      setAiReviewDraft(null)
      setSelectedAiReviewRecord(savedReview)
      setMessage('AI 复盘已保存到历史')
    } catch (reason) {
      setError(extractError(reason))
    } finally {
      setAiReviewSaving(false)
    }
  }

  const handleToggleActivationRun = () => {
    if (!activationSession.todoId) {
      return
    }

    setActivationSession((current) => setActivationSessionRunning(current, !current.running))
  }

  const handleStopActivationRun = () => {
    setActivationSession(idleActivationSession)
    setActivationDecisionTodoId(null)
    setMessage('已结束 5 分钟开工')
  }

  const handleContinueAfterActivation = async () => {
    if (!activationDecisionTodo) {
      setActivationDecisionTodoId(null)
      return
    }

    await startFocusRun({
      todo: activationDecisionTodo,
      targetPomodoros: plannedPomodoros,
      durationSec: activationContinuationDurationSec,
    })
  }

  const handleGenerateActivationRelief = async (
    mode: TodoActivationReliefMode = 'initial',
    reasonOverride?: ActivationBlockReason,
  ) => {
    if (!selectedTodo) {
      setError('先选择一个任务')
      return
    }
    if (!aiConfigured) {
      setError('先在设置中填写 AI 接口')
      return
    }
    if (mode !== 'initial' && !todoActivationRelief) {
      setError('先生成一版解阻建议，再继续细化')
      return
    }

    const requestedTodo = selectedTodo
    const requestId = activationReliefRequestIdRef.current + 1
    activationReliefRequestIdRef.current = requestId

    setActivationAiGenerating(true)
    setError(null)
    setActivationReliefHelpful(false)

    try {
      const blockReason = reasonOverride ?? activationBlockReason
      const blockReasonLabel =
        activationBlockReasonOptions.find((option) => option.id === blockReason)?.label ??
        selectedActivationBlockReason.label
      const relief = await generateTodoActivationRelief({
        todoId: requestedTodo.id,
        blockReason,
        mode,
        previousRelief: mode === 'initial' ? null : todoActivationRelief,
      })

      if (
        !shouldApplyActivationReliefResult({
          requestedTodoId: requestedTodo.id,
          currentSelectedTodoId: latestSelectedTodoIdRef.current,
          reliefTodoId: relief.todoId,
          requestId,
          latestRequestId: activationReliefRequestIdRef.current,
        })
      ) {
        return
      }

      setTodoActivationRelief({
        ...relief,
        originalQuickStartStep: requestedTodo.quickStartStep,
        originalDescription: requestedTodo.description,
      })
      setMessage(
        mode === 'initial'
          ? `AI 已按“${blockReasonLabel}”生成一版新的开工建议`
          : mode === 'need_smaller'
            ? 'AI 已把这版建议继续压缩成更小的起步动作'
            : 'AI 已换一个角度重新生成解阻建议',
      )
    } catch (reason) {
      setError(extractError(reason))
    } finally {
      if (requestId === activationReliefRequestIdRef.current) {
        setActivationAiGenerating(false)
      }
    }
  }

  const handleActivationReasonChange = (reason: ActivationBlockReason) => {
    setActivationBlockReason(reason)
    setTodoActivationRelief(null)
    setActivationReliefHelpful(false)
  }

  const handleSelectActivationReason = async (reason: ActivationBlockReason) => {
    handleActivationReasonChange(reason)
    setActivationAssistOpen(false)
    await handleGenerateActivationRelief('initial', reason)
  }

  const handleMarkActivationReliefHelpful = () => {
    setActivationReliefHelpful(true)
    setMessage('已标记这版建议有帮助，可以直接应用到当前任务')
  }

  const handleApplyActivationRelief = async () => {
    if (!selectedTodo || !todoActivationRelief) {
      return
    }

    try {
      const draft = buildTodoActivationReliefDraft(selectedTodo, todoActivationRelief)
      const next = await syncSnapshot(saveTodo(draft), {
        message: '已更新这条代办的最简启动步骤',
      })

      if (next) {
        setTodoActivationRelief(null)
      }
    } catch (reason) {
      setError(extractError(reason))
    }
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
      saveTodo(
        buildTodoDraftFromTodo(selectedTodo, {
          estimatedPomodoros: nextEstimated,
        }),
      ),
      { message: '番茄数已更新', silent: true },
    )
  }

  const handleFocusFeedbackFieldChange = (
    field: 'completedText' | 'issueText' | 'riskText',
    value: string,
  ) => {
    setFocusFeedbackDraft((current) => (current ? { ...current, [field]: value } : current))
    setFocusContinuationSuggestion(null)
  }

  const handleResetFocusFeedback = () => {
    if (!selectedTodo) {
      return
    }
    setFocusFeedbackDraft({
      projectId: selectedTodo.projectId,
      todoId: selectedTodo.id,
      sessionId: null,
      completedText: '',
      issueText: '',
      riskText: '',
    })
    setFocusContinuationSuggestion(null)
  }

  const handleGenerateFocusContinuation = async () => {
    if (!selectedTodo || !focusFeedbackDraft || focusContinuationDisabledReason) {
      setError(focusContinuationDisabledReason ?? '当前无法生成推进建议')
      return
    }

    const feedbackPayload: FocusFeedbackDraft = {
      ...focusFeedbackDraft,
      sessionId:
        focusFeedbackDraft.sessionId ??
        findLatestCompletedFocusSessionId(selectedTodo.id, selectedTodo.projectId),
    }

    setFocusContinuationGenerating(true)
    setError(null)
    setFocusContinuationSuggestion(null)

    try {
      const suggestion = await generateFocusContinuation(feedbackPayload)
      setFocusFeedbackDraft((current) =>
        current && current.todoId === feedbackPayload.todoId
          ? { ...current, sessionId: feedbackPayload.sessionId }
          : current,
      )
      setFocusContinuationSuggestion(suggestion)
      setMessage('AI 已生成后续推进建议')
    } catch (reason) {
      setError(extractError(reason))
    } finally {
      setFocusContinuationGenerating(false)
    }
  }

  const handleOpenFocusFeedbackFromAlert = () => {
    const targetTodo = activeTimerTodo ?? selectedTodo
    if (!targetTodo) {
      setPhaseAlertPrompt(null)
      return
    }

    const latestSessionId = findLatestCompletedFocusSessionId(targetTodo.id, targetTodo.projectId)
    setPage('focus')
    setSelectedProjectId(targetTodo.projectId)
    setSelectedTodoId(targetTodo.id)
    setFocusFeedbackDraft((current) => {
      const keepDraft =
        current && current.todoId === targetTodo.id && current.projectId === targetTodo.projectId
      return {
        projectId: targetTodo.projectId,
        todoId: targetTodo.id,
        sessionId: latestSessionId,
        completedText: keepDraft ? current.completedText : '',
        issueText: keepDraft ? current.issueText : '',
        riskText: keepDraft ? current.riskText : '',
      }
    })
    setFocusContinuationSuggestion(null)
    setFocusFeedbackOpen(true)
    setFocusFeedbackCollapsed(false)
    openLaunchMorePanel('review')
    setPhaseAlertPrompt(null)

    window.setTimeout(() => {
      focusFeedbackCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 0)
  }

  const handleAdvanceTodoStep = async () => {
    if (!selectedTodo || !selectedTodoSteps.length) {
      return
    }

    const nextIndex = Math.min(selectedTodo.currentStepIndex + 1, selectedTodoSteps.length - 1)
    if (nextIndex === selectedTodo.currentStepIndex) {
      return
    }

    await syncSnapshot(
      saveTodo(
        buildTodoDraftFromTodo(selectedTodo, {
          currentStepIndex: nextIndex,
        }),
      ),
      { message: '已推进到下一步', silent: true },
    )
  }

  const handleRewindTodoStep = async () => {
    if (!selectedTodo || !selectedTodoSteps.length) {
      return
    }

    const nextIndex = Math.max(selectedTodo.currentStepIndex - 1, 0)
    if (nextIndex === selectedTodo.currentStepIndex) {
      return
    }

    await syncSnapshot(
      saveTodo(
        buildTodoDraftFromTodo(selectedTodo, {
          currentStepIndex: nextIndex,
        }),
      ),
      { message: '已退回上一步', silent: true },
    )
  }

  const handleUseContinuationAsSteps = async () => {
    if (!selectedTodo || !focusContinuationSuggestion) {
      return
    }

    const nextQuickStartStep = focusContinuationQuickStartDraft.trim()
    const nextSteps = focusContinuationDraft.map((step) => step.trim()).filter(Boolean)
    if (!nextQuickStartStep) {
      setError('先确认最简启动步骤')
      return
    }
    if (!nextSteps.length) {
      setError('AI 还没有给出可用的后续步骤')
      return
    }

    const next = await syncSnapshot(
      saveTodo(
        buildTodoDraftFromTodo(selectedTodo, {
          quickStartStep: nextQuickStartStep,
          steps: nextSteps,
          currentStepIndex: 0,
        }),
      ),
      { message: '已将 AI 推进建议写回当前任务' },
    )

    if (next) {
      setFocusContinuationSuggestion(null)
    }
  }

  const openLaunchMorePanel = (tab: LaunchMoreTab = 'steps') => {
    setLaunchMoreTab(tab)
    setLaunchMoreOpen(true)
  }

  const handleCloseLaunchMorePanel = () => {
    setLaunchMoreOpen(false)
    setLaunchMoreTab('steps')
    setLaunchManageOpen(false)
    setActivationAssistOpen(false)
    setFocusFeedbackOpen(false)
    setFocusFeedbackCollapsed(false)
  }

  const renderLaunchContextBody = () => {
    if (!hasLaunchContextSteps) {
      return <p className="focus-kickoff__context-fallback">{launchContextItems[0]}</p>
    }

    return (
      <ol className="focus-kickoff__context-content">
        {launchContextItems.map((step, index) => {
          const stateClassName =
            index < selectedTodoCurrentStepIndex
              ? 'focus-kickoff__context-step is-complete'
              : index === selectedTodoCurrentStepIndex
                ? 'focus-kickoff__context-step is-current'
                : 'focus-kickoff__context-step'

          return (
            <li key={`${index + 1}-${step}`} className={stateClassName}>
              <span className="focus-kickoff__context-number" aria-hidden="true">
                {index + 1}.
              </span>
              <p className="focus-kickoff__context-text">{step}</p>
            </li>
          )
        })}
      </ol>
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

        <main
          className={page === 'focus' || page === 'stats' ? 'workspace workspace--fixed' : 'workspace'}
          id="main-content"
        >
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
              <Panel
                title="启动台"
                className="panel--launch"
                bodyClassName="launch-panel-body"
                actions={
                  <button
                    type="button"
                    className="action-button action-button--compact"
                    onClick={() => setProjectPickerMode('focus')}
                    disabled={focusInteractionLocked}
                  >
                    {selectedProject ? `项目：${selectedProject.name}` : '选择项目'}
                  </button>
                }
              >
                {selectedTodo ? (
                  <div className="focus-kickoff focus-kickoff--board">
                    <div className="focus-kickoff__hero">
                      <section className="focus-kickoff__section focus-kickoff__section--brief focus-kickoff__section--primary">
                        <div className="focus-kickoff__section-copy">
                          <span className="eyebrow">当前任务</span>
                          <h4>开始这一轮专注</h4>
                        </div>
                        <div className="focus-kickoff__hero-head">
                          <h3>{selectedTodo.title}</h3>
                          <div className="focus-kickoff__pills">
                            {selectedTodo.isToday ? <span className="info-pill">今日清单</span> : null}
                            <span className="info-pill">{selectedTodo.dueDate ?? '未排期'}</span>
                          </div>
                        </div>

                        <div className="focus-kickoff__metrics" aria-label="番茄指标">
                          <article className="focus-kickoff__metric focus-kickoff__metric--planned">
                            <span className="focus-kickoff__metric-label">本轮番茄</span>
                            <div className="focus-kickoff__metric-value">
                              <strong>{plannedPomodoros}</strong>
                              <span>个</span>
                            </div>
                          </article>
                          <article className="focus-kickoff__metric focus-kickoff__metric--remaining">
                            <span className="focus-kickoff__metric-label">剩余番茄</span>
                            <div className="focus-kickoff__metric-value">
                              <strong>{remainingPomodoros}</strong>
                              <span>个</span>
                            </div>
                          </article>
                        </div>

                        <article className="focus-kickoff__card focus-kickoff__card--primary">
                          <div className="focus-kickoff__quick-start">
                            <span>最简启动步骤</span>
                            <strong className="focus-kickoff__quick-start-text">
                              {selectedTodoQuickStartStep || '还没有最简启动步骤'}
                            </strong>
                          </div>
                          <div className="focus-kickoff__card-topline">
                            <span>下一步</span>
                            {selectedTodoSteps.length ? (
                              <small>
                                第 {Math.min(selectedTodoCurrentStepIndex + 1, selectedTodoSteps.length)} / {selectedTodoSteps.length} 步
                              </small>
                            ) : (
                              <small>先开始</small>
                            )}
                          </div>
                          <strong>{selectedTodoCurrentStep}</strong>
                          <p>
                            {selectedTodoSteps.length > 1
                              ? selectedTodoCurrentStepIndex >= selectedTodoSteps.length - 1
                                ? '做完这一步就可以收尾。'
                                : '先只做这一件事。'
                              : '先从这个最小动作开始。'}
                          </p>
                        </article>

                        <div className="focus-kickoff__primary-actions">
                          <button
                            type="button"
                            className="action-button action-button--primary"
                            onClick={() => void startActivationRun()}
                            disabled={!selectedTodo || focusInteractionLocked}
                          >
                            先启动 5 分钟
                          </button>
                          <button
                            type="button"
                            className="action-button"
                            onClick={() => void startFocusRun()}
                            disabled={!selectedTodo || focusInteractionLocked}
                          >
                            {kickoffPrimaryLabel}
                          </button>
                          <button
                            type="button"
                            className="action-button action-button--compact"
                            onClick={() => void handleAdvanceTodoStep()}
                            disabled={
                              !selectedTodoSteps.length ||
                              selectedTodoCurrentStepIndex >= selectedTodoSteps.length - 1
                            }
                          >
                            完成当前步
                          </button>
                        </div>

                        <div
                          className={
                            launchDetailsOpen
                              ? 'focus-kickoff__details is-open'
                              : 'focus-kickoff__details'
                          }
                        >
                          <button
                            type="button"
                            className="focus-kickoff__details-toggle"
                            onClick={() => setLaunchDetailsOpen((current) => !current)}
                            aria-expanded={launchDetailsOpen}
                          >
                            <span>{launchDetailsOpen ? '收起任务上下文' : '查看任务上下文'}</span>
                            <strong>{launchDetailsOpen ? '收起' : '展开查看'}</strong>
                          </button>
                          {launchDetailsOpen ? (
                            <div className="focus-kickoff__details-body">
                              <div className="focus-kickoff__context-panel" aria-label="任务上下文">
                                <div className="focus-kickoff__context-heading">
                                  <span className="focus-kickoff__context-label">后续怎么推进</span>
                                </div>
                                <div className="focus-kickoff__context-body">{renderLaunchContextBody()}</div>
                              </div>
                            </div>
                          ) : null}
                        </div>

                        <div className="focus-kickoff__more-bar">
                          <div className="focus-kickoff__more-copy">
                            <span className="info-pill">更多设置 / 求助 / 复盘</span>
                          </div>
                          <button
                            type="button"
                            className="action-button action-button--compact action-button--ghost"
                            onClick={() => openLaunchMorePanel('steps')}
                            aria-expanded={launchMoreOpen}
                          >
                            更多选项
                          </button>
                        </div>

                      </section>
                    </div>

                    {launchMoreOpen ? (
                      <ModalShell
                        title="更多选项"
                        className="modal-card--launch-drawer"
                        onClose={handleCloseLaunchMorePanel}
                      >
                        <div className="launch-more-panel">
                          <div
                            className="launch-more-tabs"
                            role="tablist"
                            aria-label="更多选项切换"
                            onKeyDown={(event) =>
                              handleTabListKeyDown(
                                event,
                                launchMoreTabIds,
                                launchMoreTab,
                                setLaunchMoreTab,
                                LAUNCH_MORE_TAB_GROUP_ID,
                              )
                            }
                          >
                            {launchMoreTabOptions.map((tab) => {
                              const isSelected = launchMoreTab === tab.id

                              return (
                                <button
                                  key={tab.id}
                                  id={buildTabId(LAUNCH_MORE_TAB_GROUP_ID, tab.id)}
                                  type="button"
                                  role="tab"
                                  aria-selected={isSelected}
                                  aria-controls={buildTabPanelId(LAUNCH_MORE_TAB_GROUP_ID, tab.id)}
                                  tabIndex={isSelected ? 0 : -1}
                                  className={isSelected ? 'launch-more-tab is-active' : 'launch-more-tab'}
                                  onClick={() => setLaunchMoreTab(tab.id)}
                                >
                                  {tab.label}
                                </button>
                              )
                            })}
                          </div>

                          <div className="launch-more-panel__body">
                            <section
                              id={buildTabPanelId(LAUNCH_MORE_TAB_GROUP_ID, 'steps')}
                              role="tabpanel"
                              aria-labelledby={buildTabId(LAUNCH_MORE_TAB_GROUP_ID, 'steps')}
                              hidden={launchMoreTab !== 'steps'}
                              className="focus-kickoff__section focus-kickoff__section--drawer-group"
                            >
                              <div className="focus-kickoff__section-head">
                                <div className="focus-kickoff__section-copy">
                                  <h4>步骤</h4>
                                </div>
                              </div>

                              <div className="focus-kickoff__section-body focus-kickoff__section-body--stacked">
                                <article className="focus-kickoff__utility-row focus-kickoff__utility-row--nested">
                                  <div className="focus-kickoff__utility-copy">
                                    <h4>编辑</h4>
                                  </div>
                                  <div className="focus-kickoff__utility-actions focus-kickoff__utility-actions--step-management">
                                    <button
                                      type="button"
                                      className="action-button action-button--compact action-button--ghost"
                                      onClick={() => void handleRewindTodoStep()}
                                      disabled={!selectedTodoSteps.length || selectedTodoCurrentStepIndex === 0}
                                    >
                                      回退一步
                                    </button>
                                    <button
                                      type="button"
                                      className="action-button action-button--compact"
                                      onClick={() => {
                                        handleCloseLaunchMorePanel()
                                        openTodoEditor(selectedTodo)
                                      }}
                                      disabled={!selectedTodo}
                                    >
                                      编辑步骤
                                    </button>
                                  </div>
                                </article>

                                <article className="focus-kickoff__utility-row focus-kickoff__utility-row--nested">
                                  <div className="focus-kickoff__utility-copy">
                                    <h4>番茄数</h4>
                                  </div>
                                  <label className="focus-kickoff__plan-field">
                                    <input
                                      type="number"
                                      min={1}
                                      max={20}
                                      value={plannedPomodoros}
                                      disabled={focusInteractionLocked}
                                      onChange={(event) =>
                                        setPlannedPomodoros(Math.max(1, Math.min(20, Number(event.target.value) || 1)))
                                      }
                                      onBlur={() => void handlePlannedPomodorosSave()}
                                    />
                                    <small>个番茄</small>
                                  </label>
                                </article>
                              </div>
                            </section>

                            <section
                              id={buildTabPanelId(LAUNCH_MORE_TAB_GROUP_ID, 'assist')}
                              role="tabpanel"
                              aria-labelledby={buildTabId(LAUNCH_MORE_TAB_GROUP_ID, 'assist')}
                              hidden={launchMoreTab !== 'assist'}
                              className="focus-kickoff__section focus-kickoff__section--drawer-group"
                            >
                              <div className="focus-kickoff__section-head">
                                <div className="focus-kickoff__section-copy">
                                  <h4>AI 求助</h4>
                                </div>
                              </div>

                              <div className="focus-kickoff__section-body">
                                <div className="focus-kickoff__utility-detail">
                                  <div className="focus-kickoff__assist-reasons" role="list" aria-label="卡住原因">
                                    {activationBlockReasonOptions.map((option) => (
                                      <button
                                        key={option.id}
                                        type="button"
                                        className={
                                          option.id === activationBlockReason
                                            ? 'focus-kickoff__assist-reason is-selected'
                                            : 'focus-kickoff__assist-reason'
                                        }
                                        onClick={() => void handleSelectActivationReason(option.id)}
                                        disabled={!selectedTodo || focusInteractionLocked || activationAiGenerating}
                                      >
                                        <strong>{option.label}</strong>
                                        <span>{option.hint}</span>
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                {todoActivationRelief ? (
                                  <article className="focus-relief-card focus-kickoff__section focus-kickoff__section--assist-result">
                                    <div className="focus-relief-card__head">
                                      <div>
                                        <span>AI 解阻建议</span>
                                        <h4>{todoActivationRelief.title}</h4>
                                      </div>
                                      <div className="focus-relief-card__head-meta">
                                        <span className="info-pill">原因：{selectedActivationBlockReason.label}</span>
                                        <span className="info-pill">先预览，再决定是否应用</span>
                                      </div>
                                    </div>
                                    <div className="focus-relief-card__grid">
                                      <section className="focus-relief-card__section">
                                        <span>当前最简启动步骤</span>
                                        <p className="focus-relief-card__body">
                                          {selectedTodo?.quickStartStep || '当前还没有最简启动步骤'}
                                        </p>
                                      </section>
                                      <section className="focus-relief-card__section">
                                        <span>AI 建议的新起点</span>
                                        <p className="focus-relief-card__body">{todoActivationRelief.quickStartStep}</p>
                                      </section>
                                      <section className="focus-relief-card__section">
                                        <span>AI 建议的后续推进</span>
                                        <p className="focus-relief-card__body focus-relief-card__body--steps">
                                          {todoActivationRelief.updatedDescription}
                                        </p>
                                      </section>
                                      <section className="focus-relief-card__section">
                                        <span>如果还是卡住</span>
                                        <p className="focus-relief-card__body">{todoActivationRelief.fallbackStep}</p>
                                      </section>
                                    </div>
                                    <div className="focus-relief-card__feedback">
                                      <div className="focus-relief-card__feedback-copy">
                                        <span>这版建议有帮助吗</span>
                                        <p>
                                          {activationReliefHelpful
                                            ? '已标记这版有帮助，适合直接应用到当前任务。'
                                            : '如果还不够好，可以继续让 AI 把第一步压得更小，或者换一个切入角度。'}
                                        </p>
                                      </div>
                                      <div className="focus-relief-card__feedback-actions">
                                        <button
                                          type="button"
                                          className={
                                            activationReliefHelpful
                                              ? 'action-button action-button--compact action-button--primary'
                                              : 'action-button action-button--compact'
                                          }
                                          onClick={handleMarkActivationReliefHelpful}
                                        >
                                          这版有用
                                        </button>
                                        <button
                                          type="button"
                                          className="action-button action-button--compact action-button--ghost"
                                          onClick={() => void handleGenerateActivationRelief('need_smaller')}
                                          disabled={activationAiGenerating}
                                        >
                                          再细一点
                                        </button>
                                        <button
                                          type="button"
                                          className="action-button action-button--compact action-button--ghost"
                                          onClick={() => void handleGenerateActivationRelief('need_alternative')}
                                          disabled={activationAiGenerating}
                                        >
                                          换个思路
                                        </button>
                                      </div>
                                    </div>
                                    <div className="modal-form__actions">
                                      <button
                                        type="button"
                                        className="action-button action-button--ghost"
                                        onClick={() => {
                                          setTodoActivationRelief(null)
                                          setActivationReliefHelpful(false)
                                        }}
                                      >
                                        取消
                                      </button>
                                      <button
                                        type="button"
                                        className="action-button action-button--primary"
                                        onClick={() => void handleApplyActivationRelief()}
                                      >
                                        {activationReliefHelpful ? '应用这版建议' : '应用到当前任务'}
                                      </button>
                                    </div>
                                  </article>
                                ) : null}
                              </div>
                            </section>

                            <section
                              id={buildTabPanelId(LAUNCH_MORE_TAB_GROUP_ID, 'review')}
                              role="tabpanel"
                              aria-labelledby={buildTabId(LAUNCH_MORE_TAB_GROUP_ID, 'review')}
                              hidden={launchMoreTab !== 'review'}
                              className="focus-kickoff__section focus-kickoff__section--drawer-group"
                            >
                              <div className="focus-kickoff__section-head">
                                <div className="focus-kickoff__section-copy">
                                  <h4>复盘</h4>
                                </div>
                              </div>

                              <div className="focus-kickoff__section-body">
                                <article className="focus-feedback-card focus-feedback-card--drawer" ref={focusFeedbackCardRef}>
                                  <div className="focus-feedback-card__head">
                                    <div className="focus-feedback-card__intro">
                                      <span>复盘</span>
                                      <h4>AI 续写</h4>
                                    </div>
                                    <div className="focus-feedback-card__meta">
                                      <button
                                        type="button"
                                        className="focus-feedback-card__toggle"
                                        onClick={() => setFocusFeedbackCollapsed((current) => !current)}
                                        aria-expanded={!focusFeedbackCollapsed}
                                      >
                                        {focusFeedbackCollapsed
                                          ? `展开输入（${focusFeedbackFilledCount}/3）`
                                          : '收起输入'}
                                      </button>
                                    </div>
                                  </div>

                                  {!focusFeedbackCollapsed ? (
                                    <>
                                      <div className="focus-feedback-grid">
                                        <label className="field">
                                          <span>已完成</span>
                                          <textarea
                                            rows={2}
                                            value={focusFeedbackDraft?.completedText ?? ''}
                                            placeholder="已完成"
                                            onChange={(event) =>
                                              handleFocusFeedbackFieldChange('completedText', event.target.value)
                                            }
                                          ></textarea>
                                        </label>
                                        <label className="field">
                                          <span>问题</span>
                                          <textarea
                                            rows={2}
                                            value={focusFeedbackDraft?.issueText ?? ''}
                                            placeholder="问题"
                                            onChange={(event) =>
                                              handleFocusFeedbackFieldChange('issueText', event.target.value)
                                            }
                                          ></textarea>
                                        </label>
                                        <label className="field">
                                          <span>风险</span>
                                          <textarea
                                            rows={2}
                                            value={focusFeedbackDraft?.riskText ?? ''}
                                            placeholder="风险"
                                            onChange={(event) =>
                                              handleFocusFeedbackFieldChange('riskText', event.target.value)
                                            }
                                          ></textarea>
                                        </label>
                                      </div>

                                      <div className="focus-feedback-card__actions">
                                        <p className="focus-feedback-card__hint">{focusContinuationDisabledReason ?? '生成下一步'}</p>
                                        <div className="modal-form__actions">
                                          <button
                                            type="button"
                                            className="action-button action-button--ghost"
                                            onClick={handleResetFocusFeedback}
                                            disabled={focusContinuationGenerating}
                                          >
                                            清空
                                          </button>
                                          <button
                                            type="button"
                                            className="action-button action-button--primary"
                                            onClick={() => void handleGenerateFocusContinuation()}
                                            disabled={Boolean(focusContinuationDisabledReason)}
                                          >
                                            {focusContinuationGenerating ? 'AI 生成中...' : '生成下一步'}
                                          </button>
                                        </div>
                                      </div>
                                    </>
                                  ) : (
                                    <div className="focus-feedback-card__collapsed">
                                      <span className="info-pill">已填写 {focusFeedbackFilledCount}/3</span>
                                    </div>
                                  )}

                                  {focusContinuationSuggestion ? (
                                    <div className="focus-continuation-card">
                                      <section className="focus-continuation-card__section">
                                        <span>最简启动</span>
                                        <textarea
                                          rows={2}
                                          value={focusContinuationQuickStartDraft}
                                          onChange={(event) => setFocusContinuationQuickStartDraft(event.target.value)}
                                          placeholder="最简启动"
                                        ></textarea>
                                      </section>
                                      <section className="focus-continuation-card__section">
                                        <span>步骤</span>
                                        <textarea
                                          rows={Math.max(3, focusContinuationDraft.length || 3)}
                                          value={focusContinuationDraft.join('\n')}
                                          onChange={(event) => setFocusContinuationDraft(parseTodoSteps(event.target.value))}
                                          placeholder="每行一步"
                                        ></textarea>
                                      </section>
                                      <section className="focus-continuation-card__section">
                                        <span>再次卡住时</span>
                                        <p>{focusContinuationSuggestion.fallbackStep}</p>
                                      </section>
                                      <div className="focus-kickoff__step-actions focus-kickoff__step-actions--continuation">
                                        <button
                                          type="button"
                                          className="action-button action-button--compact"
                                          onClick={() => void handleUseContinuationAsSteps()}
                                        >
                                          写回任务
                                        </button>
                                      </div>
                                    </div>
                                  ) : null}
                                </article>
                              </div>
                            </section>
                          </div>
                        </div>
                      </ModalShell>
                    ) : null}
                  </div>
                ) : (
                  <EmptyState title="没有可开工任务" body="先去项目库创建待办，或切换到另一个项目。" />
                )}
              </Panel>

              <Panel
                title="计时栏"
                className="panel--support-shell"
                bodyClassName="support-panel-body"
                actions={
                  <button type="button" className="action-button action-button--compact" onClick={() => setSettingsOpen(true)}>
                    设置
                  </button>
                }
              >
                <div className="support-panel support-panel--timer">
                  <div className="support-timer">
                    <div className="support-timer__head">
                      <div className="support-timer__title">
                        <span className="eyebrow">{supportTimerStatusLabel}</span>
                        <h3>{supportTimerTodo?.title ?? '准备选择一条任务'}</h3>
                      </div>
                    </div>

                    <div className={`timer-face timer-face--${supportTimerPhase}`}>
                      <div className="timer-face__inner">
                        <strong>{formatClock(supportTimerDisplaySeconds)}</strong>
                        <div className="timer-face__bar">
                          <div
                            className="timer-face__bar-fill"
                            style={{ ['--progress' as string]: `${supportTimerProgress}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>

                    {activationSession.todoId ? (
                      <div className="timer-actions timer-actions--inline">
                        <button
                          type="button"
                          className="action-button action-button--primary"
                          onClick={handleToggleActivationRun}
                        >
                          {activationSession.running ? '暂停开工' : '继续开工'}
                        </button>
                        <button
                          type="button"
                          className="action-button action-button--ghost"
                          onClick={handleStopActivationRun}
                        >
                          停止
                        </button>
                      </div>
                    ) : timer.phase !== 'idle' ? (
                      <div className="timer-actions timer-actions--inline">
                        <button
                          type="button"
                          className="action-button action-button--primary"
                          onClick={() => setTimer((current) => setTimerRunning(current, !current.running))}
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
                    ) : null}
                  </div>
                </div>

                <div className="support-panel support-panel--queue">
                  <div className="focus-queue__head">
                    <h4>待切换任务</h4>
                  </div>
                  {focusQueue.length ? (
                    <div className="focus-queue__list">
                      {focusQueue.map((todo) => (
                        <button
                          key={todo.id}
                          type="button"
                          className="focus-queue-item"
                          onClick={() => setSelectedTodoId(todo.id)}
                          disabled={focusInteractionLocked}
                        >
                          <div className="focus-queue-item__main">
                            <strong>{todo.title}</strong>
                          </div>
                          <div className="focus-queue-item__side">
                            <span>
                              {todo.completedPomodoros}/{todo.estimatedPomodoros}
                              {' · '}
                              {todo.isToday ? '今日' : todo.dueDate ?? '未排期'}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="focus-queue__empty">当前项目只有这一条任务，先专注把它推进。</p>
                  )}
                </div>

                <div className="timer-records">
                  <div className="timer-records__head">
                    <span>最近专注记录</span>
                  </div>
                  {recentFocusRecordGroups.length ? (
                    <div className="timer-records__list">
                      {recentFocusRecordGroups.map((group) => (
                        <div key={group.dateKey} className="timer-records__group">
                          <span className="timer-records__group-label">{group.label}</span>
                          {group.items.map((record) => (
                            <div key={record.id} className="timer-records__item">
                              <div className="timer-records__item-main">
                                <strong>{record.title}</strong>
                                <span>
                                  {record.result === 'interrupted'
                                    ? record.interruptReason ?? '本轮已中断'
                                    : '本轮已完成'}
                                </span>
                              </div>
                              <div className="timer-records__item-meta">
                                <span className={`status-pill status-pill--${focusSessionResultTone(record.result)}`}>
                                  {focusSessionResultLabel(record.result)}
                                </span>
                                <span className="info-pill">
                                  {formatSessionTime(record.endedAt)} · {formatDuration(record.durationSec)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="timer-records__empty">还没有专注记录</p>
                  )}
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
                  <div className="panel-toolbar__group">
                    <button
                      type="button"
                      className="action-button action-button--primary"
                      onClick={() => openTodoEditor()}
                      disabled={!manageProject || manageProject.status === 'archived'}
                    >
                      新增代办
                    </button>
                    <button
                      type="button"
                      className="action-button"
                      onClick={() => void handleGenerateTodoAiPreview()}
                      disabled={Boolean(aiActionDisabledReason)}
                    >
                      {aiGenerating ? 'AI 生成中...' : 'AI 生成预览'}
                    </button>
                    <button
                      type="button"
                      className="action-button action-button--ghost"
                      onClick={selectAllManageAiTodos}
                      disabled={!manageEnhanceableTodos.length}
                    >
                      全选待推进
                    </button>
                    <button
                      type="button"
                      className="action-button action-button--ghost"
                      onClick={clearManageAiTodoSelection}
                      disabled={!selectedManageAiTodoIds.length}
                    >
                      清空选择
                    </button>
                    <span className="info-pill">已选 {selectedManageAiTodoIds.length} 条</span>
                  </div>
                  <p className="panel-toolbar__hint">
                    {aiActionDisabledReason ??
                      `将为已选中的 ${selectedManageAiTodoIds.length} 条代办生成最简启动步骤与任务上下文`}
                  </p>
                </div>

                <div className="manage-todo-list">
                  {manageProjectTodos.length ? (
                    manageProjectTodos.map((todo) => (
                      <article key={todo.id} className="manage-todo-card">
                        <div className="manage-todo-card__head">
                          <div className="manage-todo-card__selection">
                            <label className="checkbox-field">
                              <input
                                type="checkbox"
                                checked={selectedManageAiTodoIds.includes(todo.id)}
                                disabled={!manageEnhanceableTodos.some((item) => item.id === todo.id)}
                                onChange={() => toggleAiTodoSelection(todo.id)}
                              />
                              <span>交给 AI 生成</span>
                            </label>
                            <div className="manage-todo-card__body">
                              <h3>{todo.title}</h3>
                              <div className="manage-todo-card__block">
                                <span>最简启动步骤</span>
                                <p>{todo.quickStartStep || '暂无最简启动步骤'}</p>
                              </div>
                              <div className="manage-todo-card__block">
                                <span>任务上下文</span>
                                <p>{todo.description || '暂无任务上下文'}</p>
                              </div>
                            </div>
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
              <div className="section-title-bar section-title-bar--stats">
                <h2>统计复盘</h2>
              </div>
              <div className="stats-scope-bar">
                <span className="stats-scope-status">
                  当前范围：{statsProject ? statsProject.name : '全部项目'}
                </span>
                <button
                  type="button"
                  className={
                    statsProject
                      ? 'action-button action-button--primary action-button--stats-scope is-selected'
                      : 'action-button action-button--primary action-button--stats-scope'
                  }
                  onClick={() => setProjectPickerMode('stats')}
                >
                  {statsProject ? `切换项目：${statsProject.name}` : '选择项目范围'}
                </button>
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
                <div className="stats-primary-column">
                  <Panel title="7 日趋势" className="panel--stats-trend" bodyClassName="stats-panel-body">
                    <div className="trend-chart">
                      {statsAnalytics.dailyTrend.map((point) => (
                        <div key={point.dateKey} className="trend-column">
                          <span>{point.label}</span>
                          <div className="trend-column__bar-wrap">
                              <div
                                className="trend-column__bar"
                                style={{ height: `${Math.max(12, point.focusCount * 16)}px` }}
                              ></div>
                          </div>
                          <strong>{point.focusCount}</strong>
                        </div>
                      ))}
                    </div>
                  </Panel>

                  <Panel
                    title=""
                    className="panel--stats-analysis"
                    bodyClassName="stats-panel-body"
                  >
                    <div className="stats-analysis__toolbar">
                      <div
                        className="stats-analysis-tabs"
                        role="tablist"
                        aria-label="项目分析视图"
                        onKeyDown={(event) =>
                          handleTabListKeyDown(
                            event,
                            statsPrimaryViewIds,
                            statsPrimaryView,
                            setStatsPrimaryView,
                            STATS_ANALYSIS_TAB_GROUP_ID,
                          )
                        }
                      >
                        <button
                          id={buildTabId(STATS_ANALYSIS_TAB_GROUP_ID, 'share')}
                          type="button"
                          role="tab"
                          aria-selected={statsPrimaryView === 'share'}
                          aria-controls={buildTabPanelId(STATS_ANALYSIS_TAB_GROUP_ID, 'share')}
                          tabIndex={statsPrimaryView === 'share' ? 0 : -1}
                          className={
                            statsPrimaryView === 'share'
                              ? 'stats-analysis-tab is-active'
                              : 'stats-analysis-tab'
                          }
                          onClick={() => setStatsPrimaryView('share')}
                        >
                          项目占比
                        </button>
                        <button
                          id={buildTabId(STATS_ANALYSIS_TAB_GROUP_ID, 'review')}
                          type="button"
                          role="tab"
                          aria-selected={statsPrimaryView === 'review'}
                          aria-controls={buildTabPanelId(STATS_ANALYSIS_TAB_GROUP_ID, 'review')}
                          tabIndex={statsPrimaryView === 'review' ? 0 : -1}
                          className={
                            statsPrimaryView === 'review'
                              ? 'stats-analysis-tab is-active'
                              : 'stats-analysis-tab'
                          }
                          onClick={() => setStatsPrimaryView('review')}
                        >
                          项目复盘
                        </button>
                      </div>
                    </div>


                    <div
                      id={buildTabPanelId(STATS_ANALYSIS_TAB_GROUP_ID, 'share')}
                      role="tabpanel"
                      aria-labelledby={buildTabId(STATS_ANALYSIS_TAB_GROUP_ID, 'share')}
                      hidden={statsPrimaryView !== 'share'}
                      className="share-list"
                    >
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

                    <div
                      id={buildTabPanelId(STATS_ANALYSIS_TAB_GROUP_ID, 'review')}
                      role="tabpanel"
                      aria-labelledby={buildTabId(STATS_ANALYSIS_TAB_GROUP_ID, 'review')}
                      hidden={statsPrimaryView !== 'review'}
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
                    </div>
                  </Panel>
                </div>

                <Panel
                  title="AI 复盘"
                  className="panel--stats-ai"
                  bodyClassName="stats-panel-body"
                  actions={
                    <button
                      type="button"
                      className="action-button action-button--compact action-button--primary"
                      onClick={() => void handleGenerateAiReview()}
                      disabled={Boolean(aiReviewDisabledReason)}
                    >
                      {aiReviewGenerating ? '生成中...' : 'AI 生成复盘'}
                    </button>
                  }
                >
                  <div className="ai-review-panel">
                    <div className="ai-review-panel__meta">
                      <span className="info-pill">
                        范围：{statsProject ? statsProject.name : '全部项目'}
                      </span>
                      <span className="info-pill">
                        {formatAiReviewTimeframeLabel(AI_REVIEW_TIMEFRAME)}
                      </span>
                      <span className="info-pill">近 7 天专注 {aiReviewEligibility.focusCount} 次</span>
                    </div>

                    <p className="panel-toolbar__hint">
                      {aiReviewDisabledReason ?? '基于当前统计生成复盘'}
                    </p>

                    {aiReviewDraft ? (
                      <article className="ai-review-card">
                        <div className="ai-review-card__head">
                          <div>
                            <h3>{buildAiReviewDraftTitle(statsProject?.name ?? null)}</h3>
                          </div>
                        </div>
                        <div className="ai-review-card__grid">
                          <section className="ai-review-card__section">
                            <span>本周进展</span>
                            <ul>
                              {aiReviewDraft.summary.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </section>
                          <section className="ai-review-card__section">
                            <span>主要问题</span>
                            <ul>
                              {aiReviewDraft.issues.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </section>
                          <section className="ai-review-card__section">
                            <span>下周建议</span>
                            <ul>
                              {aiReviewDraft.suggestions.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </section>
                        </div>
                        <div className="modal-form__actions">
                          <button
                            type="button"
                            className="action-button action-button--ghost"
                            onClick={() => setAiReviewDraft(null)}
                            disabled={aiReviewSaving}
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            className="action-button action-button--primary"
                            onClick={() => void handleSaveAiReview()}
                            disabled={aiReviewSaving}
                          >
                            {aiReviewSaving ? '保存中...' : '保存到历史'}
                          </button>
                        </div>
                      </article>
                    ) : (
                      <EmptyState
                        title="暂无 AI 复盘"
                        body="点击上方按钮生成"
                      />
                    )}

                    <div className="ai-review-history">
                      <div className="ai-review-history__head">
                        <h3>历史</h3>
                        <span className="info-pill">{aiReviewHistory.length} 条记录</span>
                      </div>
                      {aiReviewHistory.length ? (
                        <div className="ai-review-history__list">
                          {aiReviewHistory.map((review) => (
                            <button
                              key={review.id}
                              type="button"
                              className="ai-review-history__item"
                              onClick={() => setSelectedAiReviewRecord(review)}
                            >
                              <div className="ai-review-history__item-main">
                                <strong>{formatAiReviewScopeLabel(review)}</strong>
                                <span>{new Date(review.createdAt).toLocaleString('zh-CN')}</span>
                              </div>
                              <div className="ai-review-history__item-side">
                                <span>{formatAiReviewTimeframeLabel(review.timeframe)}</span>
                                <span>{review.summary[0] ?? '查看复盘详情'}</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="timer-records__empty">暂无记录</p>
                      )}
                    </div>
                  </div>
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
              {phaseAlertPrompt.sound === 'focus_complete' ? (
                <button
                  type="button"
                  className="action-button action-button--ghost"
                  onClick={handleOpenFocusFeedbackFromAlert}
                >
                  填写本轮复盘
                </button>
              ) : null}
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

      {activationDecisionTodo ? (
        <ModalShell
          title="5 分钟已完成"
          className="modal-card--attention modal-card--attention-complete"
          onClose={() => setActivationDecisionTodoId(null)}
          showCloseButton={false}
        >
          <div className="attention-dialog">
            <span className="attention-dialog__eyebrow">开工完成</span>
            <p className="attention-dialog__body">「{activationDecisionTodo.title}」已经启动起来了</p>
            <p className="attention-dialog__detail">
              {activationDecisionTodo.quickStartStep
                ? `刚才的最简启动动作：${activationDecisionTodo.quickStartStep}`
                : '要继续推进这件事，还是先停在这里？'}
            </p>
            <div className="modal-form__actions">
              <button
                type="button"
                className="action-button action-button--ghost"
                onClick={() => setActivationDecisionTodoId(null)}
              >
                先停在这里
              </button>
              <button
                type="button"
                className="action-button action-button--primary attention-dialog__button"
                onClick={() => void handleContinueAfterActivation()}
              >
                继续这件事
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
        <ModalShell title="番茄钟与 AI 设置" onClose={() => setSettingsOpen(false)}>
          <form
            className="settings-panel"
            onSubmit={(event) => {
              event.preventDefault()
              void saveSettingsAndRefresh({
                ...settingsDraft,
                aiApiKey: settingsApiKeyDraft,
              }).then(() => setSettingsOpen(false))
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

            <section className="settings-section">
              <div className="settings-section__head">
                <div>
                  <h4>AI 批量增强</h4>
                  <p>使用 OpenAI 兼容接口，为当前项目已选待办先生成最简启动步骤与后续步骤预览，再统一应用。</p>
                </div>
                <span className={aiConfigured ? 'status-pill status-pill--done' : 'status-pill status-pill--todo'}>
                  {aiConfigured ? '已配置' : '未配置'}
                </span>
              </div>
              <div className="settings-ai-grid">
                <label className="field field--wide">
                  <span>Base URL</span>
                  <input
                    type="url"
                    value={settingsDraft.aiBaseUrl}
                    onChange={(event) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        aiBaseUrl: event.target.value,
                      })
                    }
                    placeholder="https://api.openai.com/v1"
                  />
                </label>
                <label className="field">
                  <span>API Key</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={settingsApiKeyDraft}
                    onChange={(event) => setSettingsApiKeyDraft(event.target.value)}
                    placeholder={settingsDraft.aiApiKeyConfigured ? '留空则保持当前密钥' : 'sk-...'}
                  />
                  <small className="field-hint">{aiConfiguredHint}</small>
                </label>
                <label className="field">
                  <span>Model ID</span>
                  <input
                    value={settingsDraft.aiModelId}
                    onChange={(event) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        aiModelId: event.target.value,
                      })
                    }
                    placeholder="gpt-4.1-mini"
                  />
                </label>
              </div>
              <p className="settings-note">API Key 仅保存在本机数据库，桌面端会直接调用你填写的兼容接口。</p>
            </section>

            <button type="submit" className="action-button action-button--primary">
              保存设置
            </button>
          </form>
        </ModalShell>
      ) : null}

      {selectedAiReviewRecord ? (
        <ModalShell
          title={`AI 复盘 · ${formatAiReviewScopeLabel(selectedAiReviewRecord)}`}
          onClose={() => setSelectedAiReviewRecord(null)}
        >
          <div className="ai-review-card">
            <div className="ai-review-card__head">
              <div>
                <h3>{formatAiReviewScopeLabel(selectedAiReviewRecord)}</h3>
                <p>
                  {formatAiReviewTimeframeLabel(selectedAiReviewRecord.timeframe)} ·{' '}
                  {new Date(selectedAiReviewRecord.createdAt).toLocaleString('zh-CN')}
                </p>
              </div>
            </div>
            <div className="ai-review-card__grid">
              <section className="ai-review-card__section">
                <span>本周进展</span>
                <ul>
                  {selectedAiReviewRecord.summary.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
              <section className="ai-review-card__section">
                <span>主要问题</span>
                <ul>
                  {selectedAiReviewRecord.issues.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
              <section className="ai-review-card__section">
                <span>下周建议</span>
                <ul>
                  {selectedAiReviewRecord.suggestions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {todoAiPreviewOpen ? (
        <ModalShell title="AI 步骤预览" onClose={closeTodoAiPreview}>
          <div className="ai-preview-dialog">
            <div className="ai-preview-dialog__head">
              <p>确认后会批量更新最简启动步骤与任务上下文，不会修改备注。</p>
              <span className="info-pill">{todoAiPreview.length} 条待办</span>
            </div>

            <div className="ai-preview-list">
              {todoAiPreview.map((item) => (
                <article key={item.todoId} className="ai-preview-card">
                  <div className="ai-preview-card__head">
                    <h4>{item.title}</h4>
                  </div>
                  <div className="ai-preview-card__grid">
                    <section className="ai-preview-card__section">
                      <span>当前最简启动步骤</span>
                      <p>{item.originalQuickStartStep || '暂无最简启动步骤'}</p>
                    </section>
                    <section className="ai-preview-card__section">
                      <span>AI 最简启动步骤</span>
                      <p>{item.updatedQuickStartStep}</p>
                    </section>
                    <section className="ai-preview-card__section">
                      <span>当前任务上下文</span>
                      <p>{item.originalDescription || '暂无任务上下文'}</p>
                    </section>
                    <section className="ai-preview-card__section">
                      <span>AI 生成的任务上下文</span>
                      <p>{item.updatedDescription}</p>
                    </section>
                  </div>
                </article>
              ))}
            </div>

            <div className="modal-form__actions">
              <button
                type="button"
                className="action-button action-button--ghost"
                onClick={closeTodoAiPreview}
                disabled={aiApplying}
              >
                取消
              </button>
              <button
                type="button"
                className="action-button action-button--primary"
                onClick={() => void handleApplyTodoAiPreview()}
                disabled={aiApplying}
              >
                {aiApplying ? '应用中...' : `批量应用 ${todoAiPreview.length} 条`}
              </button>
            </div>
          </div>
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
        <ModalShell
          title={todoEditorMode === 'create' ? '新增代办' : '编辑代办'}
          className="modal-card--todo-editor"
          onClose={closeTodoEditor}
        >
          <form className="modal-form todo-editor-form" onSubmit={handleTodoFormSubmit}>
            <section className="settings-section todo-editor-form__section todo-editor-form__section--core">
              <div className="settings-section__head">
                <div>
                  <h4>基础信息</h4>
                </div>
              </div>

              <label className="field">
                <span>标题</span>
                <input
                  value={todoForm.title}
                  onChange={(event) => setTodoForm({ ...todoForm, title: event.target.value })}
                  placeholder="标题"
                />
              </label>

              <label className="field">
                <span>最简启动</span>
                <input
                  value={todoForm.quickStartStep}
                  onChange={(event) => setTodoForm({ ...todoForm, quickStartStep: event.target.value })}
                  placeholder="最简启动"
                />
              </label>
            </section>

            <section className="settings-section todo-editor-form__section">
              <div className="settings-section__head">
                <div>
                  <h4>步骤</h4>
                </div>
              </div>

              <label className="field">
                <span>步骤</span>
                <textarea
                  rows={4}
                  value={todoFormStepsText}
                  onChange={(event) => {
                    const nextSteps = parseTodoSteps(event.target.value)
                    setTodoForm({
                      ...todoForm,
                      steps: nextSteps,
                      currentStepIndex: Math.min(todoForm.currentStepIndex, Math.max(nextSteps.length - 1, 0)),
                    })
                  }}
                  placeholder="每行一步"
                ></textarea>
              </label>



              <div className="modal-form__row modal-form__row--todo todo-editor-form__row">
                <label className="field field--compact">
                  <span>当前</span>
                  <select
                    value={todoForm.currentStepIndex}
                    onChange={(event) =>
                      setTodoForm({
                        ...todoForm,
                        currentStepIndex: Math.max(0, Number(event.target.value) || 0),
                      })
                    }
                    disabled={!todoForm.steps.length}
                  >
                    {!todoForm.steps.length ? <option value={0}>暂无步骤</option> : null}
                    {todoForm.steps.map((step, index) => (
                      <option key={`${index + 1}-${step}`} value={index}>
                        {`第 ${index + 1} 步：${step.slice(0, 18)}${step.length > 18 ? '…' : ''}`}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="field field--step-action">
                  <span>操作</span>
                  <div className="todo-editor-form__step-actions">
                    <button
                      type="button"
                      className="action-button action-button--ghost"
                      onClick={() => {
                        const currentStep = todoForm.steps[todoForm.currentStepIndex] ?? ''
                        setTodoForm({
                          ...todoForm,
                          quickStartStep: currentStep || todoForm.quickStartStep,
                        })
                      }}
                      disabled={!todoForm.steps.length}
                    >
                      设为最简启动
                    </button>
                    <button
                      type="button"
                      className="action-button action-button--ghost"
                      onClick={() => {
                        const nextSteps = todoForm.steps.filter((_, index) => index !== todoForm.currentStepIndex)
                        setTodoForm({
                          ...todoForm,
                          steps: nextSteps,
                          currentStepIndex: Math.max(0, Math.min(todoForm.currentStepIndex, nextSteps.length - 1)),
                        })
                      }}
                      disabled={!todoForm.steps.length}
                    >
                      删除步骤
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section className="settings-section todo-editor-form__section">
              <div className="settings-section__head">
                <div>
                  <h4>设置</h4>
                </div>
              </div>

              <div className="modal-form__row modal-form__row--todo todo-editor-form__row todo-editor-form__row--settings">
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
            </section>

            <section
              className={
                todoContextOpen
                  ? 'focus-kickoff__details todo-editor-form__details is-open'
                  : 'focus-kickoff__details todo-editor-form__details'
              }
            >
              <button
                type="button"
                className="focus-kickoff__details-toggle"
                onClick={() => setTodoContextOpen((current) => !current)}
                aria-expanded={todoContextOpen}
              >
                <span>任务上下文（可选）</span>
                <strong>{todoContextOpen ? '收起' : '展开查看'}</strong>
              </button>
              {todoContextOpen ? (
                <div className="focus-kickoff__details-body">
                  <label className="field field--todo-context">
                    <span>任务上下文（可选）</span>
                    <textarea
                      rows={3}
                      value={todoForm.description}
                      onChange={(event) => {
                        const nextDescription = event.target.value
                        setTodoForm({
                          ...todoForm,
                          description: nextDescription,
                        })
                      }}
                      placeholder="记录背景、限制、参考信息和给 AI 的上下文；不会自动改写步骤列表"
                    ></textarea>
                  </label>
                </div>
              ) : null}
            </section>

            <div className="modal-form__actions">
              <button type="button" className="action-button action-button--ghost" onClick={closeTodoEditor}>
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
  className,
  actions,
  bodyClassName,
  children,
}: {
  title?: string
  className?: string
  actions?: ReactNode
  bodyClassName?: string
  children: ReactNode
}) {
  return (
    <section className={className ? `panel ${className}` : 'panel'}>
      {title || actions ? (
        <header className="panel__head">
          {title ? <h3>{title}</h3> : <span className="panel__title-spacer" aria-hidden="true"></span>}
          {actions ? <div className="panel__actions">{actions}</div> : null}
        </header>
      ) : null}
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

function focusSessionResultLabel(result: SessionResult): string {
  switch (result) {
    case 'completed':
      return '已完成'
    case 'interrupted':
      return '已中断'
    case 'skipped':
      return '已跳过'
  }
}

function focusSessionResultTone(result: SessionResult): 'todo' | 'done' | 'cancelled' {
  switch (result) {
    case 'completed':
      return 'done'
    case 'interrupted':
      return 'cancelled'
    case 'skipped':
      return 'todo'
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

function formatSessionDateLabel(value: string): string {
  const target = new Date(value)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)

  if (target.toDateString() === today.toDateString()) {
    return '今天'
  }
  if (target.toDateString() === yesterday.toDateString()) {
    return '昨天'
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  }).format(target)
}

function formatSessionTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

export default App
