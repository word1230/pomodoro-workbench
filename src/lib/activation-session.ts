import type { ActivationSession } from '../types'

export const ACTIVATION_DURATION_SEC = 5 * 60

export const idleActivationSession: ActivationSession = {
  running: false,
  remainingSec: 0,
  todoId: null,
  projectId: null,
  startedAt: null,
}

export function resolveNextActivationTick(current: ActivationSession): ActivationSession {
  if (!current.running || !current.todoId) {
    return current
  }

  if (current.remainingSec <= 1) {
    return {
      ...current,
      running: false,
      remainingSec: 0,
    }
  }

  return {
    ...current,
    remainingSec: current.remainingSec - 1,
  }
}

export function shouldFinalizeActivationSession(session: ActivationSession): boolean {
  return Boolean(session.todoId && !session.running && session.remainingSec === 0)
}

export function getActivationContinuationDurationSec(focusMinutes: number): number {
  const totalFocusDurationSec = Math.max(1, focusMinutes) * 60
  if (totalFocusDurationSec <= ACTIVATION_DURATION_SEC) {
    return totalFocusDurationSec
  }
  return totalFocusDurationSec - ACTIVATION_DURATION_SEC
}
