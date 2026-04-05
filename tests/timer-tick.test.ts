import test from 'node:test'
import assert from 'node:assert/strict'

import {
  idleTimer,
  resolveNextTimerTick,
  setTimerRunning,
  shouldFinalizeTimerPhase,
} from '../src/lib/timer-tick.ts'

test('resolveNextTimerTick uses wall-clock time when a deadline is available', () => {
  const current = {
    ...idleTimer,
    phase: 'focus' as const,
    running: true,
    remainingSec: 10,
    plannedDurationSec: 1500,
    targetPomodoros: 2,
    completedPomodoros: 0,
    todoId: 'todo-1',
    projectId: 'project-1',
    phaseStartedAt: '2026-03-30T00:00:00.000Z',
    deadlineAt: '2026-03-30T00:00:03.000Z',
  }

  const result = resolveNextTimerTick(current, new Date('2026-03-30T00:00:01.100Z'))

  assert.equal(result.completedPhase, null)
  assert.equal(result.nextTimer.remainingSec, 2)
  assert.equal(result.nextTimer.running, true)
})

test('resolveNextTimerTick decrements active timer without finishing early', () => {
  const current = {
    ...idleTimer,
    phase: 'focus' as const,
    running: true,
    remainingSec: 10,
    plannedDurationSec: 1500,
    targetPomodoros: 2,
    completedPomodoros: 0,
    todoId: 'todo-1',
    projectId: 'project-1',
    phaseStartedAt: '2026-03-30T00:00:00.000Z',
    deadlineAt: null,
  }

  const result = resolveNextTimerTick(current)

  assert.equal(result.completedPhase, null)
  assert.equal(result.nextTimer.remainingSec, 9)
  assert.equal(result.nextTimer.running, true)
})

test('resolveNextTimerTick stops invalid running timer state without active phase metadata', () => {
  const current = {
    ...idleTimer,
    phase: 'focus' as const,
    running: true,
    remainingSec: 20,
    plannedDurationSec: 1500,
    targetPomodoros: 1,
    completedPomodoros: 0,
    todoId: null,
    projectId: 'project-1',
    phaseStartedAt: null,
    deadlineAt: null,
  }

  const result = resolveNextTimerTick(current, new Date('2026-03-30T00:00:05.000Z'))

  assert.deepEqual(result.nextTimer, {
    ...current,
    running: false,
  })
  assert.equal(result.completedPhase, null)
})

test('setTimerRunning clears deadline when pausing an active timer', () => {
  const current = {
    ...idleTimer,
    phase: 'focus' as const,
    running: true,
    remainingSec: 120,
    plannedDurationSec: 1500,
    targetPomodoros: 1,
    completedPomodoros: 0,
    todoId: 'todo-1',
    projectId: 'project-1',
    phaseStartedAt: '2026-03-30T00:00:00.000Z',
    deadlineAt: '2026-03-30T00:02:00.000Z',
  }

  const result = setTimerRunning(current, false)

  assert.equal(result.running, false)
  assert.equal(result.deadlineAt, null)
  assert.equal(result.remainingSec, 120)
})

test('setTimerRunning recomputes deadline when resuming a paused timer', () => {
  const current = {
    ...idleTimer,
    phase: 'focus' as const,
    running: false,
    remainingSec: 120,
    plannedDurationSec: 1500,
    targetPomodoros: 1,
    completedPomodoros: 0,
    todoId: 'todo-1',
    projectId: 'project-1',
    phaseStartedAt: '2026-03-30T00:00:00.000Z',
    deadlineAt: null,
  }

  const result = setTimerRunning(current, true, new Date('2026-03-30T00:10:00.000Z'))

  assert.equal(result.running, true)
  assert.equal(result.deadlineAt, '2026-03-30T00:12:00.000Z')
  assert.equal(result.remainingSec, 120)
})

test('resolveNextTimerTick returns a completion payload when timer reaches zero', () => {
  const current = {
    ...idleTimer,
    phase: 'focus' as const,
    running: true,
    remainingSec: 1,
    plannedDurationSec: 1500,
    targetPomodoros: 2,
    completedPomodoros: 1,
    todoId: 'todo-1',
    projectId: 'project-1',
    phaseStartedAt: '2026-03-30T00:00:00.000Z',
    deadlineAt: null,
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
      plannedDurationSec: 1500,
      todoId: 'todo-1',
      projectId: 'project-1',
      deadlineAt: null,
    }),
    true,
  )

  assert.equal(
    shouldFinalizeTimerPhase({
      ...idleTimer,
      phase: 'focus',
      running: false,
      remainingSec: 12,
      plannedDurationSec: 1500,
      todoId: 'todo-1',
      projectId: 'project-1',
      deadlineAt: null,
    }),
    false,
  )
})
