import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appTsxPath = path.join(__dirname, '../src/App.tsx')
const appCssPath = path.join(__dirname, '../src/App.css')

const extractBlock = (source: string, pattern: RegExp, message: string) => {
  const match = source.match(pattern)

  assert.ok(match, message)

  return match[0]
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const extractRuleBlock = (source: string, selector: string) =>
  extractBlock(
    source,
    new RegExp(`${escapeRegExp(selector)}\\s*\\{[^}]*\\}`, 'm'),
    `expected CSS rule for ${selector}`,
  )

test('todo editor removes redundant section headings and duplicated task context', async () => {
  const appTsx = await readFile(appTsxPath, 'utf8')

  const todoEditorBlock = extractBlock(
    appTsx,
    /title=\{todoEditorMode === 'create' \? '新增代办' : '编辑代办'\}[\s\S]*?<div className="modal-form__actions">/,
    'expected to find the todo editor modal block',
  )

  assert.match(todoEditorBlock, />\s*标题\s*</)
  assert.match(todoEditorBlock, />\s*最简启动\s*</)
  assert.match(todoEditorBlock, />\s*步骤\s*</)
  assert.match(todoEditorBlock, />\s*当前\s*</)
  assert.match(todoEditorBlock, />\s*设为最简启动\s*</)
  assert.match(todoEditorBlock, />\s*删除步骤\s*</)

  assert.doesNotMatch(todoEditorBlock, /<h4>基础信息<\/h4>/)
  assert.doesNotMatch(todoEditorBlock, /<h4>步骤<\/h4>/)
  assert.doesNotMatch(todoEditorBlock, /任务上下文（可选）/)
})

test('todo editor tags the current-step field for lighter styling', async () => {
  const appTsx = await readFile(appTsxPath, 'utf8')
  const appCss = await readFile(appCssPath, 'utf8')

  assert.match(appTsx, /className="field field--compact todo-editor-form__current-step"/)

  const fieldRule = extractRuleBlock(appCss, '.todo-editor-form__current-step')
  const selectRule = extractRuleBlock(appCss, '.todo-editor-form__current-step select')

  assert.match(fieldRule, /max-width:\s*220px;/)
  assert.match(selectRule, /border:\s*1px solid rgba\(148, 163, 184, 0\.32\);/)
  assert.match(selectRule, /background:\s*rgba\(255, 255, 255, 0\.9\);/)
  assert.match(selectRule, /box-shadow:\s*none;/)
})

test('todo editor CSS no longer keeps the removed details block rules', async () => {
  const appCss = await readFile(appCssPath, 'utf8')

  assert.doesNotMatch(appCss, /\.todo-editor-form__details\s*\{/)
  assert.doesNotMatch(appCss, /\.field--todo-context textarea\s*\{/)
})
