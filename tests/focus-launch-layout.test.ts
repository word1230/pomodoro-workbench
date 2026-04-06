import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appTsxPath = path.join(__dirname, '../src/App.tsx')
const appCssPath = path.join(__dirname, '../src/App.css')
const helperToolsPath = path.join(
  __dirname,
  '../src/components/focus-launch/FocusLaunchHelperTools.tsx',
)

const extractBlock = (source, pattern, message) => {
  const match = source.match(pattern)

  assert.ok(match, message)

  return match[0]
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const extractRuleBlock = (source, selector) =>
  extractBlock(
    source,
    new RegExp(`${escapeRegExp(selector)}\\s*\\{[^}]*\\}`),
    `expected CSS rule for ${selector}`,
  )

test('focus launch uses a dedicated helper tools component', async () => {
  const appTsx = await readFile(appTsxPath, 'utf8')

  assert.match(appTsx, /FocusLaunchHelperTools/, 'expected helper tools component reference in App.tsx')
  assert.match(
    appTsx,
    /components\/focus-launch\/FocusLaunchHelperTools/,
    'expected App.tsx to import the helper tools component module',
  )

  const helperToolsUsageIndex = appTsx.indexOf('<FocusLaunchHelperTools')
  assert.notStrictEqual(helperToolsUsageIndex, -1, 'expected to render the helper tools component')

  const helperToolsUsage = appTsx.slice(helperToolsUsageIndex, helperToolsUsageIndex + 400)

  assert.match(
    helperToolsUsage,
    /canReview=\{[^}]*latestCompletedFocusSessionId[^}]*\}/,
    'expected review visibility to depend on completed-session state',
  )
  assert.match(helperToolsUsage, /onOpenSteps=\{/, 'expected steps action to be wired directly')
  assert.match(helperToolsUsage, /onOpenAssist=\{/, 'expected assist action to be wired directly')
  assert.match(helperToolsUsage, /onOpenReview=\{/, 'expected review action to be wired directly')
  assert.doesNotMatch(appTsx, /title="更多选项"/)
  assert.doesNotMatch(appTsx, /className="launch-more-tabs"/)
})

test('helper tools component keeps review conditional and emphasized', async () => {
  const helperTools = await readFile(helperToolsPath, 'utf8')

  assert.match(helperTools, /canReview:\s*boolean/)
  assert.match(helperTools, /label:\s*'步骤'/)
  assert.match(helperTools, /label:\s*'AI求助'/)
  assert.match(helperTools, /label:\s*'复盘'/)
  assert.match(helperTools, /focus-kickoff__helper-tool--review-ready/)
  assert.match(helperTools, /focus-kickoff__helper-tool-label/)

  const canReviewIndex = helperTools.indexOf('canReview')
  assert.notStrictEqual(canReviewIndex, -1, 'expected canReview guard in helper tools source')

  const reviewGuardWindow = helperTools.slice(canReviewIndex, canReviewIndex + 320)
  assert.match(reviewGuardWindow, /label:\s*'复盘'/, 'expected review entry near the canReview guard')
  assert.match(
    reviewGuardWindow,
    /focus-kickoff__helper-tool--review-ready/,
    'expected the guarded review entry to carry the emphasized styling',
  )
})

test('App.css defines inset helper tools hover-label styling', async () => {
  const css = await readFile(appCssPath, 'utf8')

  const footerQuickActionsRule = extractRuleBlock(css, '.focus-kickoff__footer-quick-actions')
  assert.match(footerQuickActionsRule, /grid-template-columns:\s*minmax\(0, 1fr\) auto;/)

  const footerToolsRule = extractRuleBlock(css, '.focus-kickoff__footer-tools')
  assert.match(footerToolsRule, /justify-self:\s*end;/)

  const helperToolLabelRule = extractRuleBlock(css, '.focus-kickoff__helper-tool-label')
  assert.match(helperToolLabelRule, /opacity:\s*0;/)

  const hoverRevealRule = extractBlock(
    css,
    /\.focus-kickoff__helper-tool:(?:hover|focus-visible)\s+\.focus-kickoff__helper-tool-label\s*\{[^}]*\}/,
    'expected a hover or focus-visible rule that reveals helper tool labels',
  )
  assert.match(hoverRevealRule, /opacity:\s*1;/)

  assert.doesNotMatch(css, /\.launch-more-tabs\s*\{/)
})

test('App.tsx opens direct helper dialogs instead of a tabbed launcher', async () => {
  const appTsx = await readFile(appTsxPath, 'utf8')

  assert.match(appTsx, /focusHelperDialog/)
  assert.match(appTsx, /setFocusHelperDialog/)
  assert.match(appTsx, /openFocusHelperDialog/)
  assert.match(appTsx, /openFocusHelperDialog\('review'\)/)
  assert.match(appTsx, /focusHelperDialog === 'assist'/)
  assert.match(appTsx, /AI 求助/)
  assert.match(appTsx, /复盘/)
  assert.doesNotMatch(appTsx, /type LaunchMoreTab\s*=/)
  assert.doesNotMatch(appTsx, /title="更多选项"/)
})
