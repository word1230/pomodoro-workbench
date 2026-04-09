import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appTsxPath = path.join(__dirname, '../src/App.tsx')

test('todo editor keeps a dedicated textarea draft state', async () => {
  const appTsx = await readFile(appTsxPath, 'utf8')

  assert.match(appTsx, /const \[todoStepsDraft, setTodoStepsDraft\] = useState\(''\)/)
  assert.match(appTsx, /value=\{todoStepsDraft\}/)
  assert.match(appTsx, /const nextStepsDraft = event\.target\.value/)
  assert.match(appTsx, /setTodoStepsDraft\(nextStepsDraft\)/)
  assert.match(appTsx, /const nextStepState = syncTodoStepEditorState\(nextStepsDraft, todoForm\.currentStepIndex\)/)
  assert.match(appTsx, /setTodoForm\(\{[\s\S]*\.\.\.todoForm,[\s\S]*\.\.\.nextStepState,[\s\S]*\}\)/)
})

test('todo editor initializes, saves, and resets the draft around modal lifecycle', async () => {
  const appTsx = await readFile(appTsxPath, 'utf8')

  assert.match(appTsx, /setTodoStepsDraft\(formatTodoStepsDraft\(resolvedSteps\)\)/)
  assert.match(appTsx, /setTodoStepsDraft\(''\)/)
  assert.match(appTsx, /const nextDraft = normalizeTodoDraft\(\{[\s\S]*\.\.\.todoForm,[\s\S]*\.\.\.syncTodoStepEditorState\(todoStepsDraft, todoForm\.currentStepIndex\),[\s\S]*\}\)/)
  assert.match(appTsx, /const nextSteps = todoForm\.steps\.filter\(\(_, index\) => index !== todoForm\.currentStepIndex\)/)
  assert.match(appTsx, /setTodoStepsDraft\(formatTodoStepsDraft\(nextSteps\)\)/)
})
