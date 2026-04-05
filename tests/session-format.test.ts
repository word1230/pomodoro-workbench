import test from 'node:test'
import assert from 'node:assert/strict'

import { formatSessionGroupLabel, formatSessionRange } from '../src/lib/session-format.ts'

test('formatSessionRange includes the end date when a session crosses midnight', () => {
  assert.equal(
    formatSessionRange('2026-03-30T23:50:00+08:00', '2026-03-31T00:15:00+08:00'),
    '3/30 23:50 - 3/31 00:15',
  )
})

test('formatSessionRange falls back instead of throwing on invalid dates', () => {
  assert.doesNotThrow(() => formatSessionRange('invalid', null))
  assert.equal(formatSessionRange('invalid', null), '时间未知')
})

test('formatSessionGroupLabel keeps the year for non-relative dates', () => {
  assert.equal(formatSessionGroupLabel('2001-03-30T12:00:00Z'), '2001/3/30')
  assert.equal(formatSessionGroupLabel('2002-03-30T12:00:00Z'), '2002/3/30')
  assert.notEqual(
    formatSessionGroupLabel('2001-03-30T12:00:00Z'),
    formatSessionGroupLabel('2002-03-30T12:00:00Z'),
  )
})

test('formatSessionGroupLabel parses bare dates in local time', () => {
  assert.equal(formatSessionGroupLabel('2001-03-30'), '2001/3/30')
})

test('formatSessionGroupLabel parses early-year bare dates', () => {
  assert.equal(formatSessionGroupLabel('0001-03-30'), '1/3/30')
})

test('formatSessionGroupLabel falls back instead of throwing on invalid dates', () => {
  assert.doesNotThrow(() => formatSessionGroupLabel('invalid'))
  assert.equal(formatSessionGroupLabel('invalid'), '未知日期')
  assert.equal(formatSessionGroupLabel('2001-02-29'), '未知日期')
})
