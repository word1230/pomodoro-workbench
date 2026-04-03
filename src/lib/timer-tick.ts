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
}

export function resolveNextTimerTick(current: TimerState): {
  nextTimer: TimerState
  completedPhase: TimerState | null
} {
  if (!current.running || current.phase === 'idle') {
    return {
      nextTimer: current,
      completedPhase: null,
    }
  }

  if (current.remainingSec <= 1) {
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
      remainingSec: current.remainingSec - 1,
    },
    completedPhase: null,
  }
}

export function shouldFinalizeTimerPhase(timer: TimerState): boolean {
  return timer.phase !== 'idle' && !timer.running && timer.remainingSec === 0
}
