import type { ActivationSession } from '../types'

export const ACTIVATION_DURATION_SEC = 5 * 60

export const idleActivationSession: ActivationSession = {
  running: false,
  remainingSec: 0,
  todoId: null,
  projectId: null,
  startedAt: null,
  deadlineAt: null,
}

export function resolveNextActivationTick(
  current: ActivationSession,
  now = new Date(),
): ActivationSession {
  if (!current.running) {
    return current
  }

  if (!current.todoId || !current.projectId || !current.startedAt) {
    return {
      ...current,
      running: false,
    }
  }

  const remainingSec = resolveRemainingSec(current.deadlineAt, current.remainingSec, now)
  if (remainingSec <= 0) {
    return {
      ...current,
      running: false,
      remainingSec: 0,
    }
  }

  return {
    ...current,
    remainingSec,
  }
}

export function shouldFinalizeActivationSession(session: ActivationSession): boolean {
  return Boolean(session.todoId && !session.running && session.remainingSec === 0)
}

export function setActivationSessionRunning(
  current: ActivationSession,
  running: boolean,
  now = new Date(),
): ActivationSession {
  if (!running) {
    return {
      ...current,
      running: false,
      deadlineAt: null,
    }
  }

  if (!current.todoId || !current.projectId || !current.startedAt) {
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

export function getActivationContinuationDurationSec(focusMinutes: number): number {
  const totalFocusDurationSec = Math.max(1, focusMinutes) * 60
  if (totalFocusDurationSec <= ACTIVATION_DURATION_SEC) {
    return totalFocusDurationSec
  }
  return totalFocusDurationSec - ACTIVATION_DURATION_SEC
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
