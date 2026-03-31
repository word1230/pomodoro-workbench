# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the React + TypeScript UI. Keep page-level UI in [`src/App.tsx`](/mnt/d/Project/myproject/pomodoro-workbench/src/App.tsx), shared browser/Tauri helpers in [`src/lib`](/mnt/d/Project/myproject/pomodoro-workbench/src/lib), and shared types in [`src/types.ts`](/mnt/d/Project/myproject/pomodoro-workbench/src/types.ts). Static assets live in [`src/assets`](/mnt/d/Project/myproject/pomodoro-workbench/src/assets) and [`public`](/mnt/d/Project/myproject/pomodoro-workbench/public). The Tauri backend is in [`src-tauri/src`](/mnt/d/Project/myproject/pomodoro-workbench/src-tauri/src), with database logic in `db.rs` and app models in `models.rs`. TypeScript tests live in [`tests`](/mnt/d/Project/myproject/pomodoro-workbench/tests).

## Build, Test, and Development Commands
Use `npm run dev` for the Vite web UI and `npm run tauri:dev` for the desktop app. Run `npm run lint` before opening a PR. Use `node --test tests/*.test.ts` to execute the current TypeScript test suite. Build the frontend with `npm run build`; if it fails with a missing `rolldown` native binding, reinstall dependencies with `npm install`. Validate the Rust side with `cargo check --manifest-path src-tauri/Cargo.toml`.

## Coding Style & Naming Conventions
Follow the existing style: 2-space indentation in TypeScript/TSX, 4 spaces in Rust, single quotes in TS, and trailing commas where the formatter leaves them. Use `PascalCase` for React components, `camelCase` for functions and helpers, and descriptive file names such as `timer-tick.ts` or `session-format.test.ts`. Keep Tauri command names aligned between [`src/lib/platform.ts`](/mnt/d/Project/myproject/pomodoro-workbench/src/lib/platform.ts) and [`src-tauri/src/lib.rs`](/mnt/d/Project/myproject/pomodoro-workbench/src-tauri/src/lib.rs). Linting is enforced with ESLint (`eslint.config.js`).

## Testing Guidelines
Tests use Node’s built-in `node:test` with `assert/strict`. Add new frontend utility tests under [`tests`](/mnt/d/Project/myproject/pomodoro-workbench/tests) using the `*.test.ts` suffix, usually mirroring the module name under `src/lib/`. Cover both success paths and fallback/error-handling behavior. For Rust changes, add focused unit tests near the affected module when practical and run `cargo check` at minimum.

## Commit & Pull Request Guidelines
Git history is not available in this workspace, so no repository-specific commit convention can be confirmed from local logs. Use short, imperative commit subjects and prefer Conventional Commit prefixes such as `feat:`, `fix:`, or `refactor:`. PRs should describe user-visible changes, list verification commands run, reference related issues, and include screenshots for UI changes in [`src/App.tsx`](/mnt/d/Project/myproject/pomodoro-workbench/src/App.tsx) or CSS updates.
