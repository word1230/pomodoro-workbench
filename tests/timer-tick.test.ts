import test from 'node:test'
import assert from 'node:assert/strict'

import { idleTimer, resolveNextTimerTick, shouldFinalizeTimerPhase } from '../src/lib/timer-tick.ts'

test('resolveNextTimerTick decrements active timer without finishing early', () => {
  const current = {
    ...idleTimer,
    phase: 'focus' as const,
    running: true,
    remainingSec: 10,
    targetPomodoros: 2,
    completedPomodoros: 0,
    todoId: 'todo-1',
    projectId: 'project-1',
    phaseStartedAt: '2026-03-30T00:00:00.000Z',
  }

  const result = resolveNextTimerTick(current)

  assert.equal(result.completedPhase, null)
  assert.equal(result.nextTimer.remainingSec, 9)
  assert.equal(result.nextTimer.running, true)
})

test('resolveNextTimerTick returns a completion payload when timer reaches zero', () => {
  const current = {
    ...idleTimer,
    phase: 'focus' as const,
    running: true,
    remainingSec: 1,
    targetPomodoros: 2,
    completedPomodoros: 1,
    todoId: 'todo-1',
    projectId: 'project-1',
    phaseStartedAt: '2026-03-30T00:00:00.000Z',
  }

  const result = resolveNextTimerTick(current)

  assert.deepEqual(result.nextTimer, {
    ...current,
    remainingSec: 0,
    running: false,
  })
  assert.deepEqual(result.completedPhase, {
    ...current,
    remainingSec: 0,
    running: false,
  })
})

test('shouldFinalizeTimerPhase only triggers for a completed non-idle phase', () => {
  assert.equal(
    shouldFinalizeTimerPhase({
      ...idleTimer,
      phase: 'focus',
      running: false,
      remainingSec: 0,
      todoId: 'todo-1',
      projectId: 'project-1',
    }),
    true,
  )

  assert.equal(
    shouldFinalizeTimerPhase({
      ...idleTimer,
      phase: 'focus',
      running: false,
      remainingSec: 12,
      todoId: 'todo-1',
      projectId: 'project-1',
    }),
    false,
  )
})
