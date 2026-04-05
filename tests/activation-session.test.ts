import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ACTIVATION_DURATION_SEC,
  getActivationContinuationDurationSec,
  idleActivationSession,
  resolveNextActivationTick,
  setActivationSessionRunning,
  shouldFinalizeActivationSession,
} from '../src/lib/activation-session.ts'

test('resolveNextActivationTick uses wall-clock time when a deadline is available', () => {
  const current = {
    ...idleActivationSession,
    running: true,
    remainingSec: ACTIVATION_DURATION_SEC,
    todoId: 'todo-1',
    projectId: 'project-1',
    startedAt: '2026-04-02T00:00:00.000Z',
    deadlineAt: '2026-04-02T00:05:00.000Z',
  }

  const result = resolveNextActivationTick(current, new Date('2026-04-02T00:01:40.000Z'))

  assert.equal(result.remainingSec, 200)
  assert.equal(result.running, true)
})

test('resolveNextActivationTick stops invalid running activation state without todo metadata', () => {
  const current = {
    ...idleActivationSession,
    running: true,
    remainingSec: 120,
    todoId: null,
    projectId: 'project-1',
    startedAt: null,
    deadlineAt: null,
  }

  const result = resolveNextActivationTick(current, new Date('2026-04-02T00:00:05.000Z'))

  assert.deepEqual(result, {
    ...current,
    running: false,
  })
})

test('resolveNextActivationTick decrements an active activation session', () => {
  const current = {
    ...idleActivationSession,
    running: true,
    remainingSec: ACTIVATION_DURATION_SEC,
    todoId: 'todo-1',
    projectId: 'project-1',
    startedAt: '2026-04-02T00:00:00.000Z',
    deadlineAt: null,
  }

  const result = resolveNextActivationTick(current)

  assert.equal(result.remainingSec, ACTIVATION_DURATION_SEC - 1)
  assert.equal(result.running, true)
})

test('setActivationSessionRunning clears deadline when pausing activation', () => {
  const current = {
    ...idleActivationSession,
    running: true,
    remainingSec: 120,
    todoId: 'todo-1',
    projectId: 'project-1',
    startedAt: '2026-04-02T00:00:00.000Z',
    deadlineAt: '2026-04-02T00:02:00.000Z',
  }

  const result = setActivationSessionRunning(current, false)

  assert.equal(result.running, false)
  assert.equal(result.deadlineAt, null)
  assert.equal(result.remainingSec, 120)
})

test('setActivationSessionRunning recomputes deadline when resuming activation', () => {
  const current = {
    ...idleActivationSession,
    running: false,
    remainingSec: 120,
    todoId: 'todo-1',
    projectId: 'project-1',
    startedAt: '2026-04-02T00:00:00.000Z',
    deadlineAt: null,
  }

  const result = setActivationSessionRunning(current, true, new Date('2026-04-02T00:10:00.000Z'))

  assert.equal(result.running, true)
  assert.equal(result.deadlineAt, '2026-04-02T00:12:00.000Z')
  assert.equal(result.remainingSec, 120)
})

test('resolveNextActivationTick stops when activation reaches zero', () => {
  const current = {
    ...idleActivationSession,
    running: true,
    remainingSec: 1,
    todoId: 'todo-1',
    projectId: 'project-1',
    startedAt: '2026-04-02T00:00:00.000Z',
    deadlineAt: null,
  }

  const result = resolveNextActivationTick(current)

  assert.deepEqual(result, {
    ...current,
    running: false,
    remainingSec: 0,
  })
  assert.equal(shouldFinalizeActivationSession(result), true)
})

test('getActivationContinuationDurationSec keeps the remaining focus duration non-negative', () => {
  assert.equal(getActivationContinuationDurationSec(25), 20 * 60)
  assert.equal(getActivationContinuationDurationSec(5), 5 * 60)
})
