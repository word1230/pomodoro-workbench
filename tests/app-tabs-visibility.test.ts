import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appCssPath = path.join(__dirname, '../src/App.css')

test('App.css forces hidden tab panels to stay hidden', async () => {
  const css = await readFile(appCssPath, 'utf8')

  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/)
})
