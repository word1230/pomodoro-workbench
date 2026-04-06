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

test('focus launch nests step completion inside a default-open step-adjustment section', async () => {
  const appTsx = await readFile(appTsxPath, 'utf8')

  const contextIndex = appTsx.indexOf('后续怎么推进')
  const stepAdjustmentsIndex = appTsx.indexOf('步骤调整')
  const planIndex = appTsx.indexOf('本轮计划')
  const completeIndex = appTsx.indexOf('完成当前步')
  const rewindIndex = appTsx.indexOf('回退一步')

  assert.ok(contextIndex !== -1, 'expected the launch context block to exist')
  assert.ok(stepAdjustmentsIndex !== -1, 'expected the step-adjustment section label to exist')
  assert.ok(planIndex !== -1, 'expected the plan section label to exist')
  assert.ok(completeIndex !== -1, 'expected the complete-step action to exist')
  assert.ok(rewindIndex !== -1, 'expected the rewind action to exist')

  assert.ok(contextIndex < stepAdjustmentsIndex, 'expected 后续怎么推进 above 步骤调整')
  assert.ok(stepAdjustmentsIndex < planIndex, 'expected 步骤调整 above 本轮计划')
  assert.ok(completeIndex < rewindIndex, 'expected 完成当前步 before 回退一步')

  assert.match(
    appTsx,
    /<details[^>]*className="focus-kickoff__footer-group focus-kickoff__footer-group--step-adjustments"[^>]*open/,
    'expected 步骤调整 to use a default-open details section',
  )
  assert.match(appTsx, /<summary className="focus-kickoff__footer-summary">/)
  assert.doesNotMatch(
    appTsx,
    /<div className="focus-kickoff__secondary-actions">[\s\S]*完成当前步[\s\S]*<\/div>/,
    'expected 完成当前步 to leave the standalone secondary-actions row',
  )

  const stepAdjustmentsBlock = extractBlock(
    appTsx,
    /<details className="focus-kickoff__footer-group focus-kickoff__footer-group--step-adjustments" open>[\s\S]*?<\/details>/,
    'expected the step-adjustment details block to exist',
  )

  assert.match(
    stepAdjustmentsBlock,
    /onClick=\{\(\) => void handleAdvanceTodoStep\(\)\}/,
    'expected 完成当前步 to keep the advance-step handler',
  )
  assert.match(
    stepAdjustmentsBlock,
    /disabled=\{\s*!selectedTodoSteps\.length\s*\|\|\s*selectedTodoCurrentStepIndex >= selectedTodoSteps\.length - 1\s*\}/,
    'expected 完成当前步 to keep its disabled guard',
  )
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

test('App.css defines stacked footer layout for the step-adjustment section', async () => {
  const css = await readFile(appCssPath, 'utf8')

  const footerQuickActionsRule = extractRuleBlock(css, '.focus-kickoff__footer-quick-actions')
  assert.match(footerQuickActionsRule, /grid-template-columns:\s*minmax\(0, 1fr\);/)

  const footerToolsRule = extractRuleBlock(css, '.focus-kickoff__footer-tools')
  assert.match(footerToolsRule, /justify-self:\s*start;/)

  const footerSummaryRule = extractRuleBlock(css, '.focus-kickoff__footer-summary')
  assert.match(footerSummaryRule, /cursor:\s*pointer;/)

  const footerButtonsStackRule = extractRuleBlock(css, '.focus-kickoff__footer-buttons--stack')
  assert.match(footerButtonsStackRule, /display:\s*grid;/)
  assert.match(footerButtonsStackRule, /grid-template-columns:\s*minmax\(0, 1fr\);/)

  const helperToolLabelRule = extractRuleBlock(css, '.focus-kickoff__helper-tool-label')
  assert.match(helperToolLabelRule, /opacity:\s*0;/)

  const hoverRevealRule = extractBlock(
    css,
    /\.focus-kickoff__helper-tool:(?:hover|focus-visible)\s+\.focus-kickoff__helper-tool-label\s*\{[^}]*\}/,
    'expected a hover or focus-visible rule that reveals helper tool labels',
  )
  assert.match(hoverRevealRule, /opacity:\s*1;/)

  const summaryIconOpenRule = extractBlock(
    css,
    /\.focus-kickoff__footer-group--step-adjustments\[open\]\s+\.focus-kickoff__footer-summary-icon\s*\{[^}]*\}/,
    'expected an open-state rule for the step-adjustment chevron',
  )
  assert.match(summaryIconOpenRule, /transform:\s*rotate\(180deg\);/)

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

test('focus launch renders helper tools in the launch panel header actions', async () => {
  const appTsx = await readFile(appTsxPath, 'utf8')

  const launchPanelBlock = extractBlock(
    appTsx,
    /<Panel\s+title="启动台"[\s\S]*?<\/Panel>/,
    'expected the launch panel block to exist',
  )
  const actionsBlock = extractBlock(
    launchPanelBlock,
    /actions=\{[\s\S]*?<div className="launch-panel-actions">[\s\S]*?<\/div>\s*\}/,
    'expected the launch panel to define header actions',
  )

  assert.match(actionsBlock, /className="launch-panel-actions"/)
  assert.match(actionsBlock, /<FocusLaunchHelperTools/)
  assert.ok(
    actionsBlock.includes("selectedProject ? `项目：${selectedProject.name}` : '选择项目'"),
    'expected the project picker button label to remain in the launch panel actions',
  )

  const helperToolsIndex = actionsBlock.indexOf('<FocusLaunchHelperTools')
  const projectButtonIndex = actionsBlock.indexOf("selectedProject ? `项目：${selectedProject.name}` : '选择项目'")
  const helperToolsMatches = launchPanelBlock.match(/<FocusLaunchHelperTools/g) ?? []

  assert.notStrictEqual(helperToolsIndex, -1, 'expected helper tools to render in the launch panel actions')
  assert.notStrictEqual(projectButtonIndex, -1, 'expected project button label in the launch panel actions')
  assert.equal(helperToolsMatches.length, 1, 'expected helper tools to render only once in the launch panel')
  assert.ok(
    helperToolsIndex < projectButtonIndex,
    'expected helper tools to appear before the project button in the launch panel actions',
  )
  assert.doesNotMatch(
    launchPanelBlock,
    /focus-kickoff__footer-quick-actions[\s\S]*<FocusLaunchHelperTools/,
    'expected helper tools to leave the footer quick-actions area',
  )
})

test('focus launch renders planned pomodoros in the timer panel header actions', async () => {
  const appTsx = await readFile(appTsxPath, 'utf8')

  const launchPanelBlock = extractBlock(
    appTsx,
    /<Panel\s+title="启动台"[\s\S]*?<\/Panel>/,
    'expected the launch panel block to exist',
  )
  const supportPanelBlock = extractBlock(
    appTsx,
    /<Panel\s+title="计时栏"[\s\S]*?<\/Panel>/,
    'expected the support panel block to exist',
  )
  const actionsBlock = extractBlock(
    supportPanelBlock,
    /actions=\{[\s\S]*?<div className="support-panel-actions">[\s\S]*?<\/div>\s*\}/,
    'expected the support panel to define header actions',
  )

  assert.match(actionsBlock, /className="support-panel-actions"/)
  assert.match(actionsBlock, /className="support-plan-pill(?:[^"]*)"/)
  assert.match(actionsBlock, /<span className="support-plan-pill__label">本轮计划<\/span>/)
  assert.match(actionsBlock, /value=\{plannedPomodoros\}/)
  assert.match(actionsBlock, /onBlur=\{\(\) => void handlePlannedPomodorosSave\(\)\}/)
  assert.match(actionsBlock, /<small>个番茄<\/small>/)

  const planPillIndex = actionsBlock.indexOf('className="support-plan-pill')
  const settingsButtonIndex = actionsBlock.indexOf('设置')
  const actionsBlockIndex = supportPanelBlock.indexOf(actionsBlock)
  const timerBlockIndex = supportPanelBlock.indexOf('support-panel--timer')

  assert.notStrictEqual(planPillIndex, -1, 'expected a planned pomodoros pill in the support panel actions')
  assert.notStrictEqual(settingsButtonIndex, -1, 'expected the settings button in the support panel actions')
  assert.notStrictEqual(actionsBlockIndex, -1, 'expected the support panel actions to be inside the support panel block')
  assert.notStrictEqual(timerBlockIndex, -1, 'expected a timer support panel')
  assert.ok(planPillIndex < settingsButtonIndex, 'expected the planned pomodoros pill before the settings button')
  assert.ok(actionsBlockIndex < timerBlockIndex, 'expected planned pomodoros controls above the timer body')
  assert.doesNotMatch(supportPanelBlock, /className="support-panel support-panel--plan"/)
  assert.doesNotMatch(launchPanelBlock, /focus-kickoff__footer-group focus-kickoff__footer-group--plan[\s\S]*value=\{plannedPomodoros\}/)
})

test('App.css defines unified top control sizing and timer-header plan pill styles', async () => {
  const css = await readFile(appCssPath, 'utf8')

  const launchPanelActionsRule = extractRuleBlock(css, '.launch-panel-actions')
  assert.match(launchPanelActionsRule, /display:\s*inline-flex;/)
  assert.match(launchPanelActionsRule, /align-items:\s*center;/)
  assert.match(launchPanelActionsRule, /flex-wrap:\s*wrap;/)

  const supportPanelActionsRule = extractRuleBlock(css, '.support-panel-actions')
  assert.match(supportPanelActionsRule, /display:\s*inline-flex;/)
  assert.match(supportPanelActionsRule, /align-items:\s*center;/)
  assert.match(supportPanelActionsRule, /gap:\s*10px;/)

  const topControlRule = extractRuleBlock(css, '.top-control')
  assert.match(topControlRule, /min-height:\s*36px;/)
  assert.match(topControlRule, /border-radius:\s*999px;/)

  const supportPlanPillRule = extractRuleBlock(css, '.support-plan-pill')
  assert.match(supportPlanPillRule, /display:\s*inline-flex;/)
  assert.match(supportPlanPillRule, /align-items:\s*center;/)
  assert.match(supportPlanPillRule, /padding:\s*0 12px;/)

  const supportPlanInputRule = extractRuleBlock(css, '.support-plan-pill input')
  assert.match(supportPlanInputRule, /width:\s*40px;/)
  assert.match(supportPlanInputRule, /font:\s*600 24px\/1 var\(--heading\);/)
})

