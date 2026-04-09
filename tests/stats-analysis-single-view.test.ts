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

test('stats analysis shows project share by default and project review when a project is selected', async () => {
  const appTsx = await readFile(appTsxPath, 'utf8')

  const statsBlock = extractBlock(
    appTsx,
    /<Panel\s+title="项目占比"[\s\S]*?<\/Panel>\s*<\/div>\s*\n\s*<Panel\s+title="AI 复盘"/,
    'expected to find stats analysis panel block',
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

test('stats analysis css no longer defines tab switch styles', async () => {
  const appCss = await readFile(appCssPath, 'utf8')

  assert.match(appCss, /\.panel--stats-analysis \.panel__head\s*\{[\s\S]*min-height:\s*48px;/)
  assert.match(appCss, /\.panel--stats-analysis \.stats-panel-body,[\s\S]*overflow:\s*auto;/)
  assert.doesNotMatch(appCss, /\.stats-analysis__toolbar\s*\{/)
  assert.doesNotMatch(appCss, /\.stats-analysis-tabs\s*\{/)
  assert.doesNotMatch(appCss, /\.stats-analysis-tab\s*\{/)
})
