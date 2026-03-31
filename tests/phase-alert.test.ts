import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getPhaseAlertPattern,
  getPhaseAlertPreset,
  playPhaseAlertSound,
  primePhaseAlertSound,
} from '../src/lib/phase-alert.ts'

test('focus completion alert uses a rising repeated sequence', () => {
  const preset = getPhaseAlertPreset('focus_complete')
  const pattern = getPhaseAlertPattern('focus_complete')

  assert.equal(preset.repeatCount, 2)
  assert.equal(preset.repeatGapMs, 1250)
  assert.equal(pattern.length, 4)
  assert.deepEqual(
    pattern.map((step) => step.frequency),
    [784, 988, 1318, 1568],
  )
  assert.ok(pattern.every((step) => step.durationMs > 0))
  assert.ok(pattern.every((step) => step.gain <= 0.28))
})

test('break completion alert stays distinct from focus completion', () => {
  const breakPreset = getPhaseAlertPreset('break_complete')
  const focusPattern = getPhaseAlertPattern('focus_complete')
  const breakPattern = getPhaseAlertPattern('break_complete')

  assert.equal(breakPreset.repeatCount, 2)
  assert.equal(breakPreset.repeatGapMs, 1150)
  assert.equal(breakPattern.length, 3)
  assert.notDeepEqual(breakPattern, focusPattern)
  assert.deepEqual(
    breakPattern.map((step) => step.frequency),
    [659, 659, 1046],
  )
})

test('phase alert audio falls back quietly when audio APIs are unavailable', async () => {
  await assert.doesNotReject(() => primePhaseAlertSound())
  await assert.doesNotReject(() => playPhaseAlertSound('focus_complete'))
  await assert.doesNotReject(() => playPhaseAlertSound('break_complete'))
})
