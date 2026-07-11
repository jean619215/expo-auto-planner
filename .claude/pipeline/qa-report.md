# QA Report — 擴充工具列:新增「畫牆壁」「畫柱子」「擦除」工具 (Task 2 of 5)
> Generated: 2026-07-12T16:00:00+08:00 | QA iteration: 1
> Story: 場地白模產生器 (階段一) | Task 2 of 5 | Type: FRONTEND

## Summary
- Tests executed: 24 (11 ACs + 4 edge cases + 4 regression checks + 3 build gates + 2 security checks)
- Passed: 24
- Failed: 0
- Blocked: 0

## Recommendation
APPROVED — all 11 acceptance criteria verified against the implementation (`src/lib/venue/grid.ts`, `src/components/venue/GridEditor.tsx`), all edge cases hold, Task 1 regression suite is 9/9 green, manual checklist covers the new toolbar scenarios, and lint/tsc/build all pass. This is a FRONTEND task — the live-browser acceptance gate for the new Task 2 toolbar scenarios (Playwright) is the next stage; this QA pass is the static/code-level verification per the pipeline's FRONTEND QA convention.

## Acceptance Criteria Results
| # | Criterion | Result | Notes |
|---|---|---|---|
| AC1 | 畫地板 pre-selected on mount/after resize | ✅ PASS | `useState<Tool>("floor")` (GridEditor.tsx:30); `handleResizeSubmit` never writes `activeTool` (58-68) |
| AC2 | Selecting a toolbar tool makes it sole active tool, radio semantics | ✅ PASS | Single `activeTool` state + `aria-pressed={activeTool === tool.id}` (166-186) guarantees exactly one filled button at all times |
| AC3 | Paint tool on empty cell → sets that type | ✅ PASS | `handleCellPointerDown` (80-88): `current` undefined, `!== activeTool` (non-eraser) → `mode = activeTool` |
| AC4 | Paint tool on same-type cell → reverts to empty | ✅ PASS | `current === activeTool → mode = "empty"`; `applyPaint` deletes the key |
| AC5 | Paint tool on different occupied type → direct overwrite | ✅ PASS | `current !== activeTool` (not eraser, not same-type) → `mode = activeTool`; `applyPaint` sets new type directly, no forced erase step |
| AC6 | 擦除 on any occupied cell → empty | ✅ PASS | `activeTool === "eraser" → mode = "empty"` unconditionally |
| AC7 | 擦除 on already-empty cell → no-op | ✅ PASS | `mode = "empty"`; `applyPaint`'s `next.delete(key)` on an absent key is a Map no-op — no error, no visual change |
| AC8 | Drag stroke applies first-cell-resolved action to every cell entered | ✅ PASS | `mode` computed once in `handleCellPointerDown`, stored in `paintModeRef.current`; `handleCellPointerEnter` (91-94) applies the ref value verbatim with no re-evaluation |
| AC9 | Pointer release anywhere ends stroke cleanly; new stroke re-evaluates | ✅ PASS | Grid `onPointerUp`/`onPointerLeave` (100-102) and window-level `pointerup` listener (36-44) all null `paintModeRef.current`; unchanged from Task 1, confirmed still wired |
| AC10 | 地板/牆壁/柱子/空白 each a distinct, easily distinguishable color | ✅ PASS | `CELL_CLASSES` (17-22): floor `bg-sky-300`/`border-sky-400`, wall `bg-amber-700`/`border-amber-800`, column `bg-gray-500`/`border-gray-600`, empty `bg-white`/`border-gray-300` — four visually distinct literal Tailwind classes (no dynamic class concatenation, v4-scanner-safe) |
| AC11 | Resize clears cell Map but keeps active tool | ✅ PASS | `handleResizeSubmit` calls `setCells(new Map())` only; `activeTool` untouched, so a subsequently-selected non-floor tool survives a resize |

## Edge Case Results
| Edge Case | Result | Notes |
|---|---|---|
| Tool switch mid-drag has no effect on locked stroke | ✅ PASS | Mode is captured once at pointerdown into `paintModeRef`; `activeTool` state changes from toolbar clicks during an in-flight drag are never re-read by `handleCellPointerEnter` |
| Eraser dragged across mixed floor/wall/column/empty cells | ✅ PASS | `mode` is fixed to `"empty"` for the whole stroke once resolved at pointerdown (since `activeTool === "eraser"` is stroke-invariant); every occupied cell entered gets deleted, already-empty cells are no-ops via the same `delete` call |
| Re-click already-active toolbar button | ✅ PASS | `onClick={() => setActiveTool(tool.id)}` with an unchanged value — React's state-update bailout means no re-render, no flicker, consistent with spec's "no-op" requirement |
| Resize while a non-floor tool is active | ✅ PASS | Same code path as AC11 — `setCells` only, `activeTool` state is independent of the resize handler and is not part of `handleResizeSubmit`'s closure writes |

## Error State Results
No new error states introduced by this task (per orchestrator-output.md — painting is synchronous local state, no async/network paths). `validateGridSize` behavior is unchanged from Task 1; re-verified no diff in that function's logic in `grid.ts`.

## Regression Check
| Feature | Result | Notes |
|---|---|---|
| Task 1 floor toggle / drag paint / drag erase | ✅ PASS | Re-ran `npx playwright test playwright-tests/venue-grid-editor.spec.ts` against a live dev server (this session, not just trusting the review report) — **9/9 passed**, zero spec/page-object modifications (`git status` confirms `playwright-tests/` has no diff for this task) |
| Resize validation (min/max/cap/non-integer) | ✅ PASS | Covered by Task 1 suite ACs 5–7, all green; `validateGridSize` untouched in `grid.ts` |
| Pointer capture handling (`releasePointerCapture`) | ✅ PASS | `handleCellPointerDown` (74-79) retains the exact Task 1 capture-release logic, untouched |
| `src/app/venue/page.tsx` | ✅ PASS | Confirmed no diff — toolbar lives entirely inside `GridEditor`, as planned |
| `playwright-tests/venue-grid-editor.spec.ts` and `playwright-tests/pages/` | ✅ PASS | Confirmed no diff via `git status` (only `.claude/pipeline/*`, `manual-tests/venue-grid-editor.md`, `src/components/venue/GridEditor.tsx`, `src/lib/venue/grid.ts` are modified) |

## Security Test
- Sensitive data exposure: PASS — no logging added, no data emitted beyond client-side DOM (`data-cell-state`), purely local UI state
- Input validation: PASS — only boundary is `validateGridSize` (unchanged); painting has no external input surface
- Auth boundary: N/A — confirmed zero diff on `src/proxy.ts`, `src/app/api/**`, `src/lib/supabase/**` (`git status` shows none of these paths touched); no Supabase client imports added to `GridEditor.tsx` or `grid.ts`

## Bugs Found
None.

## Test Coverage
- Manual checklist (`manual-tests/venue-grid-editor.md`): Task 2 section added with 13 items covering default tool, radio switching, re-click no-op, all four paint colors, same-type toggle, cross-type overwrite, eraser on occupied/empty, per-tool drag stroke lock (including eraser over mixed cells), mid-drag toolbar-click isolation, and resize-keeps-tool — matches every AC and edge case above.
- Playwright: existing Task 1 suite (9 ACs) verified green this session; new Task 2 coverage (`playwright-tests/venue-toolbar.spec.ts` + `VenuePage` additions) is deferred to the `playwright` pipeline stage per the architect plan — this is the designated next stage, not a gap.
- Build gates: `npm run lint` clean, `npx tsc --noEmit` clean, `npm run build` succeeds (`/venue` still statically prerendered).
- Status: PASS — new logic (toolbar, generalized paint semantics, per-type colors) has manual-checklist coverage now and a scheduled live-browser gate next; no new logic shipped without any test coverage, satisfying the AGENTS.md QA requirement.

## Playwright E2E Results
> Executed: 2026-07-12T16:30:00+08:00 (against `npm run dev`, local, no auth/Supabase involved)

| Test | Acceptance Criterion | Result | Duration |
|---|---|---|---|
| AC1: 畫地板 is the default active tool on load | Default tool on mount is 畫地板, others `aria-pressed=false` | ✅ PASS | 766ms |
| AC2: selecting 畫牆壁 makes it the sole active tool and paints wall on empty cell | Selecting a tool makes it sole active; wall paints empty cell | ✅ PASS | 889ms |
| AC3: wall tool on existing wall cell toggles back to empty | Same-type click reverts to empty | ✅ PASS | 894ms |
| AC3b: wall tool on a floor cell overwrites directly to wall | Different-type click overwrites directly, no forced erase | ✅ PASS | 902ms |
| AC4: 畫柱子 paints column cells | Column tool paints/toggles column cells | ✅ PASS | 898ms |
| AC5: 擦除 clears occupied cells and no-ops on empty | Eraser clears floor/wall; no-op on already-empty | ✅ PASS | 1.0s |
| AC7: drag with wall tool paints every cell in stroke | Stroke-lock applies wall to every dragged-over cell | ✅ PASS | 953ms |
| AC8: drag with eraser across mixed floor/wall/column clears all | Eraser stroke-lock clears mixed-type run uniformly | ✅ PASS | 1.1s |
| AC9/AC11: resize clears cells but keeps selected tool active | Resize clears Map, tool selection persists (wall stays active and paintable) | ✅ PASS | 985ms |
| AC10: floor/wall/column/empty render with distinct color classes | 4 distinct `bg-*` classes present, one per cell type | ✅ PASS | 960ms |

**Regression — Task 1 suite (`playwright-tests/venue-grid-editor.spec.ts`, zero modifications):** 9/9 PASS (AC1–AC9, default grid, click toggle, drag paint, drag erase, resize valid/invalid, 2500-cell cap, non-contiguous painting, no persistence on reload).

**Totals: 19/19 passed, 0 failures.**

### Failures
None.

## Outcome
✅ Playwright E2E complete — all 11 acceptance criteria verified in browser, Task 1 regression suite green, no bugs found.
