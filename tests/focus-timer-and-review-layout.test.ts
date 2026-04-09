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

test('ai assist reason picker stays minimal and upgrades the four option tiles', async () => {
  const appTsx = await readFile(appTsxPath, 'utf8')
  const appCss = await readFile(appCssPath, 'utf8')

  assert.match(appTsx, /className="focus-kickoff__assist-reasons-panel"/)
  assert.doesNotMatch(appTsx, /focus-kickoff__assist-panel-head/)

  assert.match(appCss, /\.focus-kickoff__assist-reasons-panel\s*\{[\s\S]*display:\s*block;/)
  assert.match(appCss, /\.focus-kickoff__assist-reasons-panel\s*\{[\s\S]*border:\s*0;/)
  assert.match(appCss, /\.focus-kickoff__assist-reason\s*\{[\s\S]*min-height:\s*104px;/)
  assert.match(appCss, /\.focus-kickoff__assist-reason\s*\{[\s\S]*border-radius:\s*20px;/)
  assert.match(appCss, /\.focus-kickoff__assist-reason strong\s*\{[\s\S]*font-size:\s*16px;/)
  assert.match(appCss, /\.focus-kickoff__assist-reason span\s*\{[\s\S]*font-size:\s*13px;/)
})


test('focus timer keeps the early-finish decision modal before the final completion decision', async () => {
  const appTsx = await readFile(appTsxPath, 'utf8')

  assert.match(appTsx, /const \[earlyFinishTodoId, setEarlyFinishTodoId\] = useState<string \| null>\(null\)/)
  assert.match(appTsx, /setEarlyFinishTodoId\(timer\.todoId\)/)
  assert.doesNotMatch(appTsx, /const willReachFinalConfirmation = timer\.completedPomodoros \+ 1 >= timer\.targetPomodoros/)
  assert.doesNotMatch(appTsx, /if \(willReachFinalConfirmation\) \{[\s\S]*void handleFinishFocusEarly\('completed'\)/)
})

test('next-step guidance modal keeps clean copy and upgrades generated input styling', async () => {
  const appTsx = await readFile(appTsxPath, 'utf8')
  const helperToolsPath = path.join(__dirname, '../src/components/focus-launch/FocusLaunchHelperTools.tsx')
  const helperToolsTsx = await readFile(helperToolsPath, 'utf8')
  const appCss = await readFile(appCssPath, 'utf8')

  assert.match(helperToolsTsx, /label: '下一步'/)
  assert.match(helperToolsTsx, /ariaLabel: '打开下一步引导'/)
  assert.match(appTsx, /title="下一步引导"/)
  assert.match(appTsx, /<h4>下一步引导<\/h4>/)
  assert.match(appTsx, /AI 帮你整理接下来怎么做/)
  assert.doesNotMatch(appTsx, /把当前进展整理成可继续推进的动作/)
  assert.doesNotMatch(appTsx, /先写下这轮已经完成、遇到的问题和风险/)
  assert.match(appTsx, /className="focus-continuation-card focus-continuation-card--clean"/)
  assert.match(appTsx, /className="focus-continuation-card__section focus-continuation-card__section--primary"/)
  assert.match(appTsx, /className="focus-continuation-card__section focus-continuation-card__section--steps"/)
  assert.match(appTsx, /className="action-button action-button--primary focus-continuation-card__submit"/)

  assert.match(appCss, /\.focus-kickoff__section-head--next-step\s*\{[\s\S]*border-bottom:\s*1px solid rgba\(226, 232, 240, 0\.9\);/)
  assert.match(appCss, /\.focus-continuation-card--clean\s*\{[\s\S]*gap:\s*14px;/)
  assert.match(appCss, /\.focus-continuation-card__section textarea\s*\{[\s\S]*border-radius:\s*16px;/)
  assert.match(appCss, /\.focus-continuation-card__section--primary textarea\s*\{[\s\S]*font-size:\s*18px;/)
  assert.match(appCss, /\.focus-continuation-card__submit\s*\{[\s\S]*min-height:\s*46px;/)
})

test('next-step guidance modal uses forward-looking copy and updated labels', async () => {
  const appTsx = await readFile(appTsxPath, 'utf8')
  const helperToolsPath = path.join(__dirname, '../src/components/focus-launch/FocusLaunchHelperTools.tsx')
  const helperToolsTsx = await readFile(helperToolsPath, 'utf8')

  assert.match(helperToolsTsx, /label: '下一步'/)
  assert.match(helperToolsTsx, /ariaLabel: '打开下一步引导'/)
  assert.match(appTsx, /title="下一步引导"/)
  assert.match(appTsx, /AI 帮你整理接下来怎么做/)
  assert.match(appTsx, />\s*已推进\s*</)
  assert.match(appTsx, /生成下一步引导/)
  assert.match(appTsx, /填写下一步引导/)
})

test('ai assist modal keeps the reason picker separate from generated result area', async () => {
  const appTsx = await readFile(appTsxPath, 'utf8')
  const appCss = await readFile(appCssPath, 'utf8')

  assert.match(appTsx, /className="focus-kickoff__section-body focus-kickoff__section-body--assist"/)
  assert.match(appTsx, /className="focus-kickoff__assist-reasons-panel"/)
  assert.match(appTsx, /className="focus-relief-shell"/)
  assert.match(appTsx, /className="focus-relief-shell__header"/)

  assert.match(appCss, /\.focus-kickoff__assist-reasons-panel\s*\{[\s\S]*display:\s*block;/)
  assert.match(appCss, /\.focus-relief-shell\s*\{[\s\S]*border-top:\s*1px solid rgba\(226, 232, 240, 0\.95\);/)
})

test('ai assist result card separates primary, steps, and fallback content visually', async () => {
  const appTsx = await readFile(appTsxPath, 'utf8')
  const appCss = await readFile(appCssPath, 'utf8')

  assert.match(appTsx, /focus-relief-card__section focus-relief-card__section--current/)
  assert.match(appTsx, /focus-relief-card__section focus-relief-card__section--primary/)
  assert.match(appTsx, /focus-relief-card__section focus-relief-card__section--steps/)
  assert.match(appTsx, /focus-relief-card__section focus-relief-card__section--fallback/)
  assert.match(appTsx, /focus-relief-card__body focus-relief-card__body--primary/)
  assert.match(appTsx, /focus-relief-card__body focus-relief-card__body--steps/)

  assert.match(appCss, /\.focus-relief-card__section--primary\s*\{[\s\S]*background:\s*linear-gradient/)
  assert.match(appCss, /\.focus-relief-card__section--steps\s*\{[\s\S]*grid-column:\s*1 \/ -1;/)
  assert.match(appCss, /\.focus-relief-card__section--fallback\s*\{[\s\S]*background:\s*rgba\(255, 251, 235, 0\.82\);/)
  assert.match(appCss, /\.focus-relief-card__body--primary\s*\{[\s\S]*font-size:\s*18px;/)
  assert.match(appCss, /\.focus-relief-card__body--steps\s*\{[\s\S]*font-size:\s*15px;/)
})

test('focus helper tools keep review entry visible before a pomodoro ends', async () => {
  const appTsx = await readFile(appTsxPath, 'utf8')
  const helperToolsPath = path.join(__dirname, '../src/components/focus-launch/FocusLaunchHelperTools.tsx')
  const helperToolsTsx = await readFile(helperToolsPath, 'utf8')

  assert.match(appTsx, /<FocusLaunchHelperTools[\s\S]*onOpenReview=\{\(\) => openFocusHelperDialog\('review'\)\}/)
  assert.doesNotMatch(appTsx, /canReview=\{Boolean\(latestCompletedFocusSessionId\)\}/)
  assert.match(helperToolsTsx, /id: 'review'/)
  assert.doesNotMatch(helperToolsTsx, /const reviewTools:/)
})

test('focus timer adds early finish controls and completion confirmation flow', async () => {
  const appTsx = await readFile(appTsxPath, 'utf8')

  assert.match(appTsx, /const \[focusCompletionDecision, setFocusCompletionDecision\] = useState</)
  assert.match(appTsx, /const \[earlyFinishTodoId, setEarlyFinishTodoId\] = useState<string \| null>\(null\)/)
  assert.match(appTsx, /handleFinishFocusEarly = async \(mode: 'completed' \| 'abandoned'\)/)
  assert.match(appTsx, />\s*提前结束\s*</)
  assert.doesNotMatch(appTsx, />\s*终止\s*</)
  assert.match(appTsx, />\s*未完成，加一个番茄\s*</)
  assert.match(appTsx, />\s*任务已完成\s*</)
  assert.match(appTsx, />\s*任务已完成，计入本轮\s*</)
  assert.match(appTsx, />\s*提前结束，不计入番茄\s*</)
})

test('launch board removes redundant edit-step button and keeps helper tool entry', async () => {
  const appTsx = await readFile(appTsxPath, 'utf8')

  const launchBlock = extractBlock(
    appTsx,
    /<Panel\s+title="启动台"[\s\S]*?\{focusHelperDialog === 'assist' \? \(/,
    'expected to find launch panel block',
  )

  assert.match(launchBlock, /<FocusLaunchHelperTools/)
  assert.doesNotMatch(launchBlock, />\s*编辑步骤\s*</)
  assert.match(launchBlock, />\s*完成当前步\s*</)
  assert.match(launchBlock, />\s*回退一步\s*</)
})

test('stats analysis panel shows project share by default and swaps to project review when a project is selected', async () => {
  const appTsx = await readFile(appTsxPath, 'utf8')

  const statsBlock = extractBlock(
    appTsx,
    /<Panel\s+title="项目占比"[\s\S]*?<\/Panel>\s*<\/div>\s*\n\s*<Panel\s+title="AI 复盘"/,
    'expected to find the stats analysis panel block',
  )

  assert.match(statsBlock, /<Panel\s+title="项目占比"/)
  assert.match(statsBlock, /!statsProject \? \(/)
  assert.match(statsBlock, /className="share-list"/)
  assert.match(statsBlock, /projectSharePercent\(metric, statsAnalytics\.projectMetrics\)/)
  assert.match(statsBlock, /reviewMetric \? \(/)
  assert.match(statsBlock, /<article className="project-metric-card">/)
  assert.doesNotMatch(statsBlock, /stats-analysis__toolbar/)
  assert.doesNotMatch(statsBlock, /stats-analysis-tabs/)
})

test('stats analysis panel adds fixed top spacing to stay clear of the trend chart', async () => {
  const appCss = await readFile(appCssPath, 'utf8')

  assert.match(appCss, /\.panel--stats-analysis\s*\{[\s\S]*margin-top:\s*12px;/)
  assert.match(appCss, /\.panel--stats-analysis \.panel__head\s*\{[\s\S]*padding-top:\s*10px;/)
  assert.match(appCss, /\.panel--stats-analysis \.stats-panel-body\s*\{[\s\S]*padding-top:\s*10px;/)
})

test('stats primary column keeps explicit spacing between trend and analysis panels', async () => {
  const appCss = await readFile(appCssPath, 'utf8')

  assert.match(appCss, /\.stats-primary-column\s*\{[\s\S]*gap:\s*18px;/)
  assert.match(appCss, /\.panel--stats-trend \.stats-panel-body\s*\{[\s\S]*padding-bottom:\s*8px;/)
  assert.match(appCss, /\.trend-column__bar-wrap\s*\{[\s\S]*min-height:\s*104px;/)
})

test('review panel promotes draft summary layout and supporting css hooks', async () => {
  const appTsx = await readFile(appTsxPath, 'utf8')
  const appCss = await readFile(appCssPath, 'utf8')

  assert.match(appTsx, /className="ai-review-card ai-review-card--draft"/)
  assert.match(appTsx, /className="ai-review-card__head ai-review-card__head--stacked"/)
  assert.match(appTsx, /<span className="info-pill">草稿预览<\/span>/)
  assert.match(appTsx, /先快速检查这版总结，再决定是否保存到历史。/)
  assert.match(appTsx, /className="ai-review-card__grid ai-review-card__grid--summary"/)

  assert.match(appCss, /\.ai-review-card__head--stacked\s*\{[\s\S]*display:\s*grid;/)
  assert.match(appCss, /\.ai-review-card__grid--summary\s*\{[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/)
  assert.match(appCss, /\.ai-review-card--draft\s*\{[\s\S]*display:\s*grid;/)
})

test('manage page columns keep independent scrolling containers', async () => {
  const appCss = await readFile(appCssPath, 'utf8')

  assert.match(appCss, /\.page-grid--manage\s*\{[\s\S]*height:\s*100%;/)
  assert.match(appCss, /\.page-grid--manage\s*\{[\s\S]*overflow:\s*hidden;/)
  assert.match(appCss, /\.page-grid--manage > \.panel\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0, 1fr\);/)
  assert.match(appCss, /\.page-grid--manage > \.panel \.manage-panel-body\s*\{[\s\S]*overflow:\s*auto;/)
})
