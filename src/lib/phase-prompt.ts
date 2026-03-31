import type { SessionType } from '../types'
import type { PhaseAlertKind } from './phase-alert'

export interface PhaseAlertPrompt {
  title: string
  body: string
  detail: string
  confirmLabel: string
  resumeTimerOnConfirm: boolean
  sound: PhaseAlertKind
  tone: 'focus' | 'break' | 'complete'
}

export const PHASE_REMINDER_INITIAL_DELAY_MS = 15000
export const PHASE_REMINDER_INTERVAL_MS = 15000

export function buildFocusCompletionPrompt(input: {
  todoTitle: string
  completedPomodoros: number
  targetPomodoros: number
  nextPhase: Extract<SessionType, 'short_break' | 'long_break'> | null
  autoStarted: boolean
}): PhaseAlertPrompt {
  const progress = `${input.completedPomodoros}/${input.targetPomodoros}`

  if (!input.nextPhase) {
    return {
      title: '计划番茄已完成',
      body: `「${input.todoTitle}」已完成 ${progress} 个番茄。`,
      detail: '当前计时器已经停止，确认提醒后再决定下一步。',
      confirmLabel: '我知道了',
      resumeTimerOnConfirm: false,
      sound: 'focus_complete',
      tone: 'complete',
    }
  }

  const phaseLabel = input.nextPhase === 'long_break' ? '长休息' : '短休息'

  return {
    title: '一轮专注完成',
    body: `「${input.todoTitle}」已完成 ${progress} 个番茄，${input.autoStarted ? `已进入${phaseLabel}` : `准备进入${phaseLabel}`}。`,
    detail: input.autoStarted
      ? `${phaseLabel}已经开始计时，先确认这次切换，别直接错过休息窗口。`
      : `当前专注已经结束，确认后就可以开始${phaseLabel}。`,
    confirmLabel: input.autoStarted ? '继续' : `开始${phaseLabel}`,
    resumeTimerOnConfirm: !input.autoStarted,
    sound: 'focus_complete',
    tone: 'focus',
  }
}

export function buildBreakCompletionPrompt(input: {
  todoTitle: string
  autoStarted: boolean
}): PhaseAlertPrompt {
  return {
    title: '休息结束',
    body: input.autoStarted
      ? `已回到「${input.todoTitle}」并开始下一轮专注。`
      : `休息时间到了，准\u5907\u56DE\u5230「${input.todoTitle}」继续推进。`,
    detail: input.autoStarted
      ? '下一轮专注已经开始计时，先确认提醒，别让新一轮默默流逝。'
      : '确认提醒后，回到当前任务开始下一轮专注。',
    confirmLabel: input.autoStarted ? '进入状态' : '开始专注',
    resumeTimerOnConfirm: !input.autoStarted,
    sound: 'break_complete',
    tone: 'break',
  }
}
