import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PHASE_REMINDER_INITIAL_DELAY_MS,
  PHASE_REMINDER_INTERVAL_MS,
  buildBreakCompletionPrompt,
  buildFocusCompletionPrompt,
} from '../src/lib/phase-prompt.ts'

test('focus completion prompt highlights final completion when plan ends', () => {
  const prompt = buildFocusCompletionPrompt({
    todoTitle: '撰写接口文档',
    completedPomodoros: 3,
    targetPomodoros: 3,
    nextPhase: null,
    autoStarted: false,
  })

  assert.equal(prompt.title, '计划番茄已完成')
  assert.equal(prompt.sound, 'focus_complete')
  assert.equal(prompt.tone, 'complete')
  assert.equal(prompt.resumeTimerOnConfirm, false)
  assert.match(prompt.body, /3\/3/)
})

test('focus completion prompt distinguishes pending and auto-started breaks', () => {
  const pendingBreak = buildFocusCompletionPrompt({
    todoTitle: '拆分统计卡片',
    completedPomodoros: 1,
    targetPomodoros: 4,
    nextPhase: 'short_break',
    autoStarted: false,
  })
  const runningBreak = buildFocusCompletionPrompt({
    todoTitle: '拆分统计卡片',
    completedPomodoros: 2,
    targetPomodoros: 4,
    nextPhase: 'long_break',
    autoStarted: true,
  })

  assert.equal(pendingBreak.confirmLabel, '开始短休息')
  assert.equal(pendingBreak.resumeTimerOnConfirm, true)
  assert.match(pendingBreak.detail, /确认后就可以开始短休息/)
  assert.equal(runningBreak.confirmLabel, '继续')
  assert.equal(runningBreak.resumeTimerOnConfirm, false)
  assert.match(runningBreak.body, /已进入长休息/)
})

test('break completion prompt explains whether focus already resumed', () => {
  const pausedFocus = buildBreakCompletionPrompt({
    todoTitle: '准备发布说明',
    autoStarted: false,
  })
  const runningFocus = buildBreakCompletionPrompt({
    todoTitle: '准备发布说明',
    autoStarted: true,
  })

  assert.equal(pausedFocus.sound, 'break_complete')
  assert.equal(pausedFocus.resumeTimerOnConfirm, true)
  assert.equal(runningFocus.tone, 'break')
  assert.equal(runningFocus.resumeTimerOnConfirm, false)
  assert.match(pausedFocus.body, /准备回到/)
  assert.match(runningFocus.detail, /已经开始计时/)
})

test('phase reminder schedule keeps looping at a steady interval until confirmed', () => {
  assert.equal(PHASE_REMINDER_INITIAL_DELAY_MS, 15000)
  assert.equal(PHASE_REMINDER_INTERVAL_MS, 15000)
})
