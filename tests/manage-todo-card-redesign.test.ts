import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appTsxPath = path.join(__dirname, '../src/App.tsx')
const appCssPath = path.join(__dirname, '../src/App.css')

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const extractBlock = (source: string, pattern: RegExp, message: string) => {
  const match = source.match(pattern)

  assert.ok(match, message)

  return match[0]
}

const extractRuleBlock = (source: string, selector: string) =>
  extractBlock(
    source,
    new RegExp(`${escapeRegExp(selector)}\\s*\\{[^}]*\\}`, 'm'),
    `expected CSS rule for ${selector}`,
  )

test('manage todo list keeps all items by default and supports unfinished-only filtering', async () => {
  const appTsx = await readFile(appTsxPath, 'utf8')

  assert.match(appTsx, /type ManageTodoFilter = 'all' \| 'unfinished'/)
  assert.match(appTsx, /const \[manageTodoFilter, setManageTodoFilter\] = useState<ManageTodoFilter>\('all'\)/)
  assert.match(
    appTsx,
    /const visibleManageProjectTodos = useMemo\([\s\S]*manageTodoFilter === 'unfinished'[\s\S]*todo\.status !== 'done'[\s\S]*manageProjectTodos,[\s\S]*\[manageProjectTodos, manageTodoFilter\]\)/,
  )
  assert.match(appTsx, /manageTodoFilter === 'all'/)
  assert.match(appTsx, />\s*全部\s*</)
  assert.match(appTsx, /manageTodoFilter === 'unfinished'/)
  assert.match(appTsx, />\s*仅未完成\s*</)
  assert.match(appTsx, /visibleManageProjectTodos\.length \? \(/)
  assert.match(appTsx, /visibleManageProjectTodos\.map\(\(todo\) => \(/)
})

test('manage todo cards render the lighter hierarchy and action bar controls', async () => {
  const appTsx = await readFile(appTsxPath, 'utf8')

  const manageTodoBlock = extractBlock(
    appTsx,
    /<div className="manage-todo-list">[\s\S]*?<\/div>\s*<\/Panel>/,
    'expected to find the manage todo list block',
  )

  assert.match(manageTodoBlock, /className=\{todo\.status === 'done' \? 'manage-todo-card is-complete' : 'manage-todo-card'\}/)
  assert.match(manageTodoBlock, /className="manage-todo-card__title-row"/)
  assert.match(manageTodoBlock, /className=\{[\s\S]*manage-action-button manage-action-button--complete is-complete[\s\S]*manage-action-button manage-action-button--complete[\s\S]*\}/)
  assert.match(manageTodoBlock, /onClick=\{\(\) => void toggleManageTodoCompletion\(todo\)\}/)
  assert.match(manageTodoBlock, /todo\.status === 'done' \? '恢复' : '完成'/)
  assert.match(manageTodoBlock, />\s*今天\s*</)
  assert.match(manageTodoBlock, /manageProject\?\.name \?\? '未分组项目'/)
  assert.match(manageTodoBlock, /className="manage-todo-card__summary"/)
  assert.match(manageTodoBlock, /todo\.quickStartStep \|\| '暂无最简启动步骤'/)
  assert.match(manageTodoBlock, /<span>交给 AI 生成<\/span>/)
  assert.match(manageTodoBlock, />\s*编辑\s*</)
  assert.match(manageTodoBlock, />\s*删除\s*</)
  assert.doesNotMatch(manageTodoBlock, /checked=\{todo\.status === 'done'\}/)
})

test('manage todo CSS adds rounded cards, completed-state de-emphasis, and summary truncation', async () => {
  const appCss = await readFile(appCssPath, 'utf8')

  const cardRule = extractRuleBlock(appCss, '.manage-todo-card')
  const titleRowRule = extractRuleBlock(appCss, '.manage-todo-card__title-row')
  const summaryRule = extractRuleBlock(appCss, '.manage-todo-card__summary')
  const completeCardRule = extractRuleBlock(appCss, '.manage-todo-card.is-complete')
  const completeTitleRule = extractRuleBlock(appCss, '.manage-todo-card.is-complete .manage-todo-card__title-row h3')
  const actionRule = extractRuleBlock(appCss, '.manage-action-button')
  const completeActionRule = extractRuleBlock(appCss, '.manage-action-button--complete')
  const dangerHoverRule = extractBlock(
    appCss,
    /\.manage-action-button--danger:hover,[\s\S]*?color:\s*#b91c1c;/,
    'expected hover/focus rule for manage-action-button--danger',
  )
  const filterRule = extractRuleBlock(appCss, '.manage-filter-chip')

  assert.match(cardRule, /border-radius:\s*24px;/)
  assert.match(cardRule, /border:\s*1px solid rgba\(226, 232, 240, 0\.95\);/)
  assert.match(cardRule, /background:\s*rgba\(255, 255, 255, 0\.96\);/)
  assert.match(cardRule, /box-shadow:\s*0 18px 40px rgba\(15, 23, 42, 0\.06\);/)

  assert.match(titleRowRule, /display:\s*flex;/)
  assert.match(titleRowRule, /align-items:\s*flex-start;/)
  assert.match(actionRule, /display:\s*inline-flex;/)
  assert.match(actionRule, /border-radius:\s*999px;/)
  assert.match(completeActionRule, /background:\s*rgba\(238, 242, 255, 0\.95\);/)
  assert.match(summaryRule, /display:\s*-webkit-box;/)
  assert.match(summaryRule, /-webkit-line-clamp:\s*2;/)
  assert.match(summaryRule, /overflow:\s*hidden;/)

  assert.match(completeCardRule, /opacity:\s*0\.72;/)
  assert.match(completeTitleRule, /text-decoration:\s*line-through;/)
  assert.match(dangerHoverRule, /color:\s*#b91c1c;/)

  assert.match(filterRule, /border-radius:\s*999px;/)
  assert.match(filterRule, /font-size:\s*12px;/)
})

