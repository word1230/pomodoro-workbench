import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appTsxPath = path.join(__dirname, '../src/App.tsx')
const appCssPath = path.join(__dirname, '../src/App.css')

const extractBlock = (source, pattern, message) => {
  const match = source.match(pattern)

  assert.ok(match, message)

  return match[0]
}

test('focus launch renders a dedicated footer quick-actions panel', async () => {
  const tsx = await readFile(appTsxPath, 'utf8')

  const footerQuickActions = extractBlock(
    tsx,
    /<div className="focus-kickoff__footer-quick-actions">[\s\S]*?<\/section>/,
    'expected to find the footer quick-actions block',
  )

  assert.match(footerQuickActions, />\s*回退一步\s*</)
  assert.match(footerQuickActions, />\s*编辑步骤\s*</)
  assert.match(footerQuickActions, /className="focus-kickoff__footer-plan-field"/)
})

test('launch drawer no longer contains duplicate step management controls', async () => {
  const tsx = await readFile(appTsxPath, 'utf8')

  const stepsPanel = extractBlock(
    tsx,
    /<section\s+id=\{buildTabPanelId\(LAUNCH_MORE_TAB_GROUP_ID, 'steps'\)\}[\s\S]*?className="focus-kickoff__section-body focus-kickoff__section-body--stacked"[\s\S]*?<\/section>/,
    'expected to find the steps tab panel',
  )

  assert.doesNotMatch(stepsPanel, /focus-kickoff__utility-actions--step-management/)
  assert.doesNotMatch(stepsPanel, />\s*回退一步\s*</)
  assert.doesNotMatch(stepsPanel, />\s*编辑步骤\s*</)
  assert.doesNotMatch(stepsPanel, /<h4>\s*番茄数\s*<\/h4>/)
  assert.doesNotMatch(stepsPanel, /className="focus-kickoff__plan-field"/)
  assert.doesNotMatch(stepsPanel, /<small>\s*个番茄\s*<\/small>/)
})

test('App.css defines stretchable footer quick-actions layout', async () => {
  const css = await readFile(appCssPath, 'utf8')

  assert.match(css, /\.focus-kickoff__section--primary\s*\{[\s\S]*display:\s*grid;/)
  assert.match(css, /\.focus-kickoff__footer-quick-actions\s*\{[\s\S]*min-height:\s*clamp\(96px,\s*18vh,\s*160px\);/)
  assert.match(css, /\.focus-kickoff__footer-quick-actions\s*\{[\s\S]*margin-top:\s*auto;/)
})

