import type { TimerState } from '../types'

export const idleTimer: TimerState = {
  phase: 'idle',
  running: false,
  remainingSec: 0,
  plannedDurationSec: 0,
  targetPomodoros: 0,
  completedPomodoros: 0,
  todoId: null,
  projectId: null,
  phaseStartedAt: null,
  deadlineAt: null,
}

export function resolveNextTimerTick(
  current: TimerState,
  now = new Date(),
): {
  nextTimer: TimerState
  completedPhase: TimerState | null
} {
  if (current.phase === 'idle' || !current.running) {
    return {
      nextTimer: current,
      completedPhase: null,
    }
  }

  if (!current.todoId || !current.projectId || !current.phaseStartedAt) {
    return {
      nextTimer: {
        ...current,
        running: false,
      },
      completedPhase: null,
    }
  }

  const remainingSec = resolveRemainingSec(current.deadlineAt, current.remainingSec, now)
  if (remainingSec <= 0) {
    const completedPhase = {
      ...current,
      remainingSec: 0,
      running: false,
    }

    return {
      nextTimer: completedPhase,
      completedPhase,
    }
  }

  return {
    nextTimer: {
      ...current,
      remainingSec,
    },
    completedPhase: null,
  }
}

export function shouldFinalizeTimerPhase(timer: TimerState): boolean {
  return timer.phase !== 'idle' && !timer.running && timer.remainingSec === 0
}

export function setTimerRunning(current: TimerState, running: boolean, now = new Date()): TimerState {
  if (current.phase === 'idle') {
    return current
  }

  if (!running) {
    return {
      ...current,
      running: false,
      deadlineAt: null,
    }
  }

  if (!current.todoId || !current.projectId || !current.phaseStartedAt) {
    return {
      ...current,
      running: false,
      deadlineAt: null,
    }
  }

  return {
    ...current,
    running: true,
    deadlineAt: new Date(now.getTime() + Math.max(0, current.remainingSec) * 1000).toISOString(),
  }
}

function resolveRemainingSec(deadlineAt: string | null, fallbackRemainingSec: number, now: Date): number {
  if (deadlineAt) {
    const deadline = new Date(deadlineAt)
    if (!Number.isNaN(deadline.getTime())) {
      return Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / 1000))
    }
  }

  if (fallbackRemainingSec <= 1) {
    return 0
  }

  return fallbackRemainingSec - 1
}
