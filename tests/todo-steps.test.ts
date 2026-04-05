import assert from 'node:assert/strict'
import test from 'node:test'

import { parseTodoSteps } from '../src/lib/todo-steps.ts'

test('parseTodoSteps preserves numeric prefixes in multiline plain text', () => {
  assert.deepEqual(parseTodoSteps('2FA 登录\n3D 建模\n2026.04 对账'), [
    '2FA 登录',
    '3D 建模',
    '2026.04 对账',
  ])
})

test('parseTodoSteps strips explicit multiline list markers', () => {
  assert.deepEqual(parseTodoSteps('1. 打开项目\n2. 运行测试'), ['打开项目', '运行测试'])
  assert.deepEqual(parseTodoSteps('1.打开项目\n2.运行测试'), ['打开项目', '运行测试'])
  assert.deepEqual(parseTodoSteps('1.2026.04 对账\n2.3D 建模'), ['2026.04 对账', '3D 建模'])
  assert.deepEqual(parseTodoSteps('1) 打开项目\n2) 运行测试'), ['打开项目', '运行测试'])
  assert.deepEqual(parseTodoSteps('1)打开项目\n2)运行测试'), ['打开项目', '运行测试'])
  assert.deepEqual(parseTodoSteps('1)2026.04 对账\n2)3D 建模'), ['2026.04 对账', '3D 建模'])
  assert.deepEqual(parseTodoSteps('1、打开项目\n2、运行测试'), ['打开项目', '运行测试'])
  assert.deepEqual(parseTodoSteps('- 打开项目\n- 运行测试'), ['打开项目', '运行测试'])
  assert.deepEqual(parseTodoSteps('* 打开项目\n* 运行测试'), ['打开项目', '运行测试'])
  assert.deepEqual(parseTodoSteps('• 打开项目\n• 运行测试'), ['打开项目', '运行测试'])
})

test('parseTodoSteps preserves intro text while stripping a following multiline numbered list', () => {
  assert.deepEqual(
    parseTodoSteps('如果还是卡住：只列出首页、列表页、详情页。\n\n1. 收集当前问题\n2. 写出一个最小复现\n3. 记录阻塞点'),
    ['如果还是卡住：只列出首页、列表页、详情页。', '收集当前问题', '写出一个最小复现', '记录阻塞点'],
  )
})

test('parseTodoSteps does not treat plain numeric prefixes as the start of a later numbered list', () => {
  assert.deepEqual(
    parseTodoSteps('2026.04 对账说明\n1. 收集当前问题\n2. 写出一个最小复现'),
    ['2026.04 对账说明', '收集当前问题', '写出一个最小复现'],
  )
})

test('parseTodoSteps still extracts numbered items from a single paragraph', () => {
  assert.deepEqual(parseTodoSteps('1. 打开项目 2. 运行测试 3. 提交结果'), [
    '打开项目',
    '运行测试',
    '提交结果',
  ])
})
