# Backend Review Fix Todo

Source: full backend code review on 2026-04-05

## Status legend
- [ ] pending
- [-] in progress
- [x] done

## Tasks

1. [x] Harden database integrity in `src-tauri/src/db.rs`
   - Add real foreign keys for relational tables
   - Ensure deletes cascade appropriately
   - Validate referenced rows on write paths

2. [x] Make focus session recording transactional in `src-tauri/src/db.rs`
   - Wrap insert/select/update in one transaction
   - Use atomic increment for `completed_pomodoros`

3. [x] Secure AI API key handling across Rust + TS boundary
   - Stop exposing plaintext key in snapshots/settings payloads
   - Store key outside normal snapshot flow
   - Update frontend platform helpers/types accordingly

4. [x] Deduplicate AI feedback logging in `src-tauri/src/ai.rs` and `src-tauri/src/db.rs`
   - Only persist continuation feedback after successful generation, or otherwise prevent duplicates

5. [x] Fix timer correctness in `src/lib/timer-tick.ts` and `src/lib/activation-session.ts`
   - Base countdown on wall-clock elapsed time
   - Normalize invalid running states

6. [x] Harden browser snapshot recovery and platform wrappers in `src/lib/platform.ts`
   - Recover from invalid `localStorage` JSON
   - Catch backend failures in `showMainWindow`

7. [x] Fix AI todo application consistency in `src/lib/todo-ai.ts`
   - Prevent stale `steps` from overriding AI-updated description/quick start data

8. [x] Align recent-session date windows in `src/lib/ai-review.ts`
   - Use calendar-day boundaries consistent with analytics expectations

9. [x] Normalize focus session typing and secret exposure in `src/types.ts`
   - Represent break sessions without fake `projectId`/`todoId`
   - Remove `aiApiKey` from broad snapshot/domain types where possible

10. [x] Make step parsing more tolerant in `src/lib/todo-steps.ts`
    - Handle leading/trailing prose around list content more safely
