import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ACTIVATION_DURATION_SEC,
  getActivationContinuationDurationSec,
  idleActivationSession,
  resolveNextActivationTick,
  shouldFinalizeActivationSession,
} from '../src/lib/activation-session.ts'

test('resolveNextActivationTick decrements an active activation session', () => {
  const current = {
    ...idleActivationSession,
    running: true,
    remainingSec: ACTIVATION_DURATION_SEC,
    todoId: 'todo-1',
    projectId: 'project-1',
    startedAt: '2026-04-02T00:00:00.000Z',
  }

  const result = resolveNextActivationTick(current)

  assert.equal(result.remainingSec, ACTIVATION_DURATION_SEC - 1)
  assert.equal(result.running, true)
})

test('resolveNextActivationTick stops when activation reaches zero', () => {
  const current = {
    ...idleActivationSession,
    running: true,
    remainingSec: 1,
    todoId: 'todo-1',
    projectId: 'project-1',
    startedAt: '2026-04-02T00:00:00.000Z',
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
