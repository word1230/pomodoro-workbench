# Focus Launch Footer Quick Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the large empty area under the focus launch actions with a useful expandable quick-actions panel that surfaces step and planning controls in the main launch area.

**Architecture:** Keep the current focus launch structure in `src/App.tsx`, but introduce a dedicated footer quick-actions section below the primary actions. Move selected controls out of the “更多选项” modal: surface `回退一步`, `编辑步骤`, and planned pomodoro input in the launch panel, while keeping AI assist and other low-frequency controls inside the modal. Update CSS so the footer section expands to occupy the remaining vertical space with a lightweight panel layout instead of blank whitespace.

**Tech Stack:** React 19 + TypeScript, existing `App.tsx` state/actions, CSS in `src/App.css`, Node built-in test runner for regression checks.

---

## File Structure

- Modify: `src/App.tsx`
  - Rework the focus launch left-column action area.
  - Add a new footer quick-actions container under the secondary action row.
  - Move existing `回退一步`, `编辑步骤`, and `plannedPomodoros` controls into the new surface area.
  - Remove the duplicated controls from the `steps` tab inside the modal.
- Modify: `src/App.css`
  - Add layout rules for the new footer quick-actions panel.
  - Make the launch column capable of stretching the footer panel to use leftover height gracefully.
  - Keep the visual hierarchy lighter than the main action buttons.
- Create: `tests/focus-launch-layout.test.ts`
  - Add CSS/markup regression checks for the new footer quick-actions region and the removal of duplicated step-management controls from the modal section.

### Task 1: Add regression tests for the new quick-actions footer

**Files:**
- Create: `tests/focus-launch-layout.test.ts`
- Test: `tests/focus-launch-layout.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appTsxPath = path.join(__dirname, '../src/App.tsx')
const appCssPath = path.join(__dirname, '../src/App.css')

test('focus launch renders a dedicated footer quick-actions panel', async () => {
  const tsx = await readFile(appTsxPath, 'utf8')

  assert.match(tsx, /className="focus-kickoff__footer-quick-actions"/)
  assert.match(tsx, />\s*回退一步\s*</)
  assert.match(tsx, />\s*编辑步骤\s*</)
  assert.match(tsx, /className="focus-kickoff__footer-plan-field"/)
})

test('launch drawer no longer contains duplicate step management controls', async () => {
  const tsx = await readFile(appTsxPath, 'utf8')

  const drawerStepsSection = tsx.match(/hidden=\{launchMoreTab !== 'steps'\}[\s\S]*?hidden=\{launchMoreTab !== 'assist'\}/)

  assert.ok(drawerStepsSection, 'expected to find the steps tab section')
  assert.doesNotMatch(drawerStepsSection[0], />\s*回退一步\s*</)
  assert.doesNotMatch(drawerStepsSection[0], />\s*编辑步骤\s*</)
  assert.doesNotMatch(drawerStepsSection[0], /plannedPomodoros/)
})

test('App.css defines stretchable footer quick-actions layout', async () => {
  const css = await readFile(appCssPath, 'utf8')

  assert.match(css, /\.focus-kickoff__section--primary\s*\{[\s\S]*display:\s*grid;/)
  assert.match(css, /\.focus-kickoff__footer-quick-actions\s*\{[\s\S]*min-height:\s*clamp\(96px,\s*18vh,\s*160px\);/)
  assert.match(css, /\.focus-kickoff__footer-quick-actions\s*\{[\s\S]*margin-top:\s*auto;/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/focus-launch-layout.test.ts`
Expected: FAIL because the new footer quick-actions markup and CSS do not exist yet.

- [ ] **Step 3: Write minimal implementation to satisfy the test**

Create the file exactly as written in Step 1.

- [ ] **Step 4: Run test to verify it passes after file creation is complete enough to execute**

Run: `node --test tests/focus-launch-layout.test.ts`
Expected: FAIL on assertions about missing markup/CSS, but the test file itself should load without syntax errors.

- [ ] **Step 5: Commit**

```bash
git add tests/focus-launch-layout.test.ts
git commit -m "test: cover focus launch footer layout"
```

### Task 2: Move quick actions into the main launch surface

**Files:**
- Modify: `src/App.tsx:2046-2193`
- Test: `tests/focus-launch-layout.test.ts`

- [ ] **Step 1: Write the failing test for quick-action structure**

Use the existing test file from Task 1 and ensure these assertions are present before editing `src/App.tsx`:

```ts
assert.match(tsx, /className="focus-kickoff__footer-quick-actions"/)
assert.match(tsx, />\s*回退一步\s*</)
assert.match(tsx, />\s*编辑步骤\s*</)
assert.match(tsx, /className="focus-kickoff__footer-plan-field"/)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/focus-launch-layout.test.ts`
Expected: FAIL because `src/App.tsx` still only exposes those controls inside the modal.

- [ ] **Step 3: Write minimal implementation**

Replace the current action area in `src/App.tsx` with this structure:

```tsx
<div className="focus-kickoff__primary-actions">
  <button
    type="button"
    className="action-button action-button--primary"
    onClick={() => void startFocusRun()}
    disabled={!selectedTodo || focusInteractionLocked}
  >
    {kickoffPrimaryLabel}
  </button>
  <button
    type="button"
    className="action-button"
    onClick={() => void startActivationRun()}
    disabled={!selectedTodo || focusInteractionLocked}
  >
    先启动 5 分钟
  </button>
</div>

<div className="focus-kickoff__secondary-actions">
  <button
    type="button"
    className="action-button action-button--compact action-button--ghost"
    onClick={() => void handleAdvanceTodoStep()}
    disabled={!selectedTodoSteps.length || selectedTodoCurrentStepIndex >= selectedTodoSteps.length - 1}
  >
    完成当前步
  </button>
  <button
    type="button"
    className="action-button action-button--compact action-button--ghost"
    onClick={() => openLaunchMorePanel('assist')}
    aria-expanded={launchMoreOpen && launchMoreTab === 'assist'}
  >
    AI 求助
  </button>
  <button
    type="button"
    className="action-button action-button--compact action-button--ghost"
    onClick={() => openLaunchMorePanel('review')}
    aria-expanded={launchMoreOpen && launchMoreTab === 'review'}
  >
    更多选项
  </button>
</div>

<div className="focus-kickoff__footer-quick-actions">
  <div className="focus-kickoff__footer-group">
    <span className="focus-kickoff__footer-label">步骤调整</span>
    <div className="focus-kickoff__footer-buttons">
      <button
        type="button"
        className="action-button action-button--compact action-button--ghost"
        onClick={() => void handleRewindTodoStep()}
        disabled={!selectedTodoSteps.length || selectedTodoCurrentStepIndex === 0}
      >
        回退一步
      </button>
      <button
        type="button"
        className="action-button action-button--compact"
        onClick={() => openTodoEditor(selectedTodo)}
        disabled={!selectedTodo}
      >
        编辑步骤
      </button>
    </div>
  </div>

  <div className="focus-kickoff__footer-group focus-kickoff__footer-group--plan">
    <span className="focus-kickoff__footer-label">本轮计划</span>
    <label className="focus-kickoff__footer-plan-field">
      <input
        type="number"
        min={1}
        max={20}
        value={plannedPomodoros}
        disabled={focusInteractionLocked}
        onChange={(event) =>
          setPlannedPomodoros(Math.max(1, Math.min(20, Number(event.target.value) || 1)))
        }
        onBlur={() => void handlePlannedPomodorosSave()}
      />
      <small>个番茄</small>
    </label>
  </div>
</div>
```

Then simplify the `steps` tab inside the modal so it only keeps content that is still low-frequency:

```tsx
<section
  id={buildTabPanelId(LAUNCH_MORE_TAB_GROUP_ID, 'steps')}
  role="tabpanel"
  aria-labelledby={buildTabId(LAUNCH_MORE_TAB_GROUP_ID, 'steps')}
  hidden={launchMoreTab !== 'steps'}
  className="focus-kickoff__section focus-kickoff__section--drawer-group"
>
  <div className="focus-kickoff__section-head">
    <div className="focus-kickoff__section-copy">
      <h4>步骤</h4>
    </div>
  </div>

  <div className="focus-kickoff__section-body focus-kickoff__section-body--stacked">
    <article className="focus-kickoff__utility-row focus-kickoff__utility-row--nested">
      <div className="focus-kickoff__utility-copy">
        <h4>说明</h4>
      </div>
      <div className="focus-kickoff__utility-detail">
        <p className="focus-kickoff__description-empty">步骤推进和本轮番茄数已移动到主面板底部，方便直接调整。</p>
      </div>
    </article>
  </div>
</section>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/focus-launch-layout.test.ts`
Expected: PASS for the markup-focused assertions.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx tests/focus-launch-layout.test.ts
git commit -m "feat: surface focus launch quick actions"
```

### Task 3: Make the footer quick-actions panel absorb the empty space cleanly

**Files:**
- Modify: `src/App.css:1099-1115`
- Modify: `src/App.css:3344-3554`
- Test: `tests/focus-launch-layout.test.ts`

- [ ] **Step 1: Write the failing test for layout CSS**

Use the existing CSS assertions from Task 1 and ensure these exact checks are present:

```ts
assert.match(css, /\.focus-kickoff__section--primary\s*\{[\s\S]*display:\s*grid;/)
assert.match(css, /\.focus-kickoff__footer-quick-actions\s*\{[\s\S]*min-height:\s*clamp\(96px,\s*18vh,\s*160px\);/)
assert.match(css, /\.focus-kickoff__footer-quick-actions\s*\{[\s\S]*margin-top:\s*auto;/)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/focus-launch-layout.test.ts`
Expected: FAIL because the footer panel CSS does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Update the primary section layout in `src/App.css`:

```css
.focus-kickoff--board .focus-kickoff__section--primary {
  display: grid;
  align-content: start;
  grid-template-rows: auto auto auto auto 1fr;
  width: 100%;
  min-width: 0;
  gap: var(--space-4);
  padding: var(--space-4) 0;
  border: 0;
  border-top: 1px solid var(--line);
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  overflow: visible;
}
```

Add the new footer panel styles near the existing focus kickoff board rules:

```css
.focus-kickoff__footer-quick-actions {
  display: grid;
  align-content: start;
  grid-template-columns: minmax(0, 1.2fr) minmax(180px, 0.8fr);
  gap: 16px;
  min-height: clamp(96px, 18vh, 160px);
  margin-top: auto;
  padding: 16px 0 0;
  border-top: 1px solid var(--line);
}

.focus-kickoff__footer-group {
  display: grid;
  align-content: start;
  gap: 12px;
  min-width: 0;
}

.focus-kickoff__footer-group--plan {
  justify-items: start;
}

.focus-kickoff__footer-label {
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.focus-kickoff__footer-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.focus-kickoff__footer-plan-field {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  background: var(--paper);
}

.focus-kickoff__footer-plan-field input {
  width: 72px;
  min-height: 40px;
  border: 0;
  background: transparent;
  color: var(--ink);
  text-align: center;
  font: 600 24px/1 var(--heading);
  letter-spacing: -0.04em;
}

.focus-kickoff__footer-plan-field input:focus {
  outline: none;
}

.focus-kickoff__footer-plan-field small {
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
}

@media (max-width: 960px) {
  .focus-kickoff__footer-quick-actions {
    grid-template-columns: 1fr;
    min-height: 0;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/focus-launch-layout.test.ts`
Expected: PASS for all footer quick-actions CSS assertions.

- [ ] **Step 5: Run broader verification**

Run: `npm run lint`
Expected: PASS with no ESLint errors.

- [ ] **Step 6: Commit**

```bash
git add src/App.css src/App.tsx tests/focus-launch-layout.test.ts
git commit -m "fix: replace empty launch space with quick actions"
```

## Self-Review

- **Spec coverage:** The plan covers the user-approved direction: use the empty area for moved-out controls rather than duplicate status info, specifically exposing both a step-management action and a planning control in the main surface.
- **Placeholder scan:** No `TODO`, `TBD`, or “implement later” placeholders remain.
- **Type consistency:** All referenced handlers and state already exist in `src/App.tsx` (`handleRewindTodoStep`, `openTodoEditor`, `plannedPomodoros`, `handlePlannedPomodorosSave`, `openLaunchMorePanel`). The proposed new class names are used consistently between TSX and CSS.

Plan complete and saved to `docs/superpowers/plans/2026-04-06-focus-launch-footer-quick-actions.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
