# QA Report — 網格真實尺寸標示 + 不規則形狀驗證 (Task 3 of 5)
> Generated: 2026-07-12T19:15:00+08:00 | QA iteration: 1
> Story: 場地白模產生器 (階段一) | Task 3 of 5 | Type: FRONTEND

## Summary
- Tests executed: 27 (9 ACs + 3 edge cases + 5 boundary node-replay checks + 4 regression checks + 3 build gates + 3 security checks)
- Passed: 27
- Failed: 0
- Blocked: 0

## Recommendation
APPROVED — all 9 acceptance criteria verified against the implementation (`src/lib/venue/grid.ts`, `src/components/venue/GridEditor.tsx`), all edge cases and node-replayed boundary values hold, existing 19-test Playwright suite (Task 1+2) re-run and green with zero spec modifications, lint/tsc/build all pass, and `proxy.ts`/`api/**`/`supabase/**` show zero diff. This is a FRONTEND task — the live-browser acceptance gate for the new Task 3 ruler/legend/stats/irregular-shape scenarios (`venue-scale-stats.spec.ts`) is the next stage; this QA pass is the static/code-level verification per the pipeline's FRONTEND QA convention.

## Acceptance Criteria Results
| # | Criterion | Result | Notes |
|---|---|---|---|
| AC1 | 預設 10x10 網格,頂部與左側各顯示 0..10 標籤,與格線對齊 | ✅ PASS | `axisLabels(10)` (≤20 branch) returns `[0..10]` — 11 values (`dimension+1` length). `grid-ruler-top`/`grid-ruler-left` (GridEditor.tsx:204-250) render one `<span data-axis-value>` per value, positioned at `v * CELL_SIZE_PX` with `translateX(-50%)`/`translateY(-50%)` — same `CELL_SIZE_PX` constant the `venue-grid` cells use for their own `gridTemplateColumns/Rows`, so alignment is structurally guaranteed, not coincidental. |
| AC2 | Resize 後標籤跟著新尺寸重新渲染並保持對齊 | ✅ PASS | `topLabels`/`leftLabels` (line 107-108) are recomputed every render from `axisLabels(size.widthM)`/`axisLabels(size.heightM)` — no memoization or stale closure. `handleResizeSubmit` (60-70) calls `setSize(result.size)` on success, the sole input to both calls, so labels refresh automatically alongside the grid's own dimensions. |
| AC3 | 尺寸 > 20(例如 25x8):寬軸每 5m,高軸 ≤20 仍每格 | ✅ PASS | `axisLabels` is a pure, per-dimension function called independently for width and height (line 107-108) with no cross-axis coupling anywhere in `grid.ts` or `GridEditor.tsx`. Node replay: `axisLabels(21)=[0,5,10,15,20,21]` vs `axisLabels(20)=[0..20]` (21 values) confirms the density switch triggers exactly at `>20` and each axis decides independently. |
| AC4 | 圖例「每格 = 1 公尺」文字存在 | ✅ PASS | `<p data-testid="grid-scale-legend">每格 = 1 公尺</p>` present verbatim (GridEditor.tsx:266-268). |
| AC5 | 統計顯示地板/牆壁/柱子各自格數(=㎡),各自獨立累計 | ✅ PASS | `countCellTypes` (grid.ts:101-109) does a single pass over `cells.values()` with independent counters per `CellType`; `stats-floor`/`stats-wall`/`stats-column` spans (GridEditor.tsx:270-277) render the counts directly — 1 cell = 1 count = 1 ㎡ by definition, no unit-conversion arithmetic to get wrong. |
| AC6 | 擦除/覆蓋後統計即時更新 | ✅ PASS | `const stats = countCellTypes(cells)` (line 106) is computed in the render body itself, not in an effect or memo — any `setCells` call (paint, erase, overwrite, or resize's `new Map()`) forces a fresh count on the very next render with nothing to invalidate. |
| AC7 | 非連續兩塊地板區域可正常繪製,統計為兩塊面積之和 | ✅ PASS | No contiguity/flood-fill/adjacency validation exists anywhere in `applyPaint`, `handleCellPointerDown`, or `handleCellPointerEnter` (unchanged from Task 1/2) — `cells` is a plain sparse `Map<string, CellType>` keyed by independent `"x,y"` strings, so two disjoint regions are simply two disjoint sets of map entries and `countCellTypes` sums every entry regardless of position. Confirmed live via the still-passing Task 1 regression test AC8 (`venue-grid-editor.spec.ts:112`, "non-contiguous painting"). |
| AC8 | L 形(凹形)與中空(牆圍一圈)形狀可正常繪製 | ✅ PASS (code-level) | Same reasoning as AC7 — per-cell independent Map entries with zero shape/connectivity constraint anywhere in the paint pipeline mean any cell combination (L-shape, or a wall ring with an untouched empty interior) is representable and counted correctly; there is no code path that could reject or auto-fill such shapes. Per architect-plan Test Plan items 6-8, the live-browser confirmation of this is a Playwright scenario deferred to the `playwright` stage — code-level verification here finds nothing that would make it fail. |
| AC9 | 既有 19 個 Playwright 測試(Task 1+2)全部維持通過 | ✅ PASS | Re-ran `npx playwright test playwright-tests/venue-grid-editor.spec.ts playwright-tests/venue-toolbar.spec.ts` against a live local dev server this session — **19/19 passed**, zero spec/page-object modifications (`git status`/`git diff --stat` show no changes under `playwright-tests/`). |

## Edge Case Results
| Edge Case | Result | Notes |
|---|---|---|
| 1x1 最小網格:標籤 0,1 正常顯示 | ✅ PASS | Node replay: `axisLabels(1) = [0, 1]` (dense branch, 2 values). `MIN_DIMENSION_M = 1` permits this size via the unchanged `validateGridSize`. |
| 50x50 最大網格:兩軸皆走每 5m 規則,尾端 50 有標 | ✅ PASS | Node replay: `axisLabels(50) = [0,5,10,15,20,25,30,35,40,45,50]`. 50 is itself a multiple of 5, so the "append final edge if not already included" guard (`labels[labels.length-1] !== dimension`) correctly avoids a duplicated trailing `50`. |
| 空網格統計:全部 0,不顯示錯誤 | ✅ PASS | `countCellTypes(new Map())` returns `{floor:0, wall:0, column:0}` unconditionally — counters initialize to 0 and the loop over an empty iterable is a no-op; no conditional rendering exists that could throw on all-zero counts. |

## Boundary Node-Replay (`axisLabels`, run standalone with the actual algorithm)
| dimension | Result | Correct? |
|---|---|---|
| 1 | `[0,1]` | ✅ dense, 2 labels |
| 20 | `[0,1,...,20]` (21 labels) | ✅ dense/sparse boundary — still every-meter exactly at 20 (the `≤` in `dimension <= AXIS_LABEL_DENSE_MAX`) |
| 21 | `[0,5,10,15,20,21]` | ✅ sparse boundary — switches at 21, non-multiple-of-5 tail `21` correctly appended |
| 23 | `[0,5,10,15,20,23]` | ✅ matches the orchestrator's own worked example exactly |
| 50 | `[0,5,...,50]` | ✅ sparse, ends exactly on a multiple of 5, no duplicate tail append |

## Error State Results
No new error states introduced (per orchestrator-output.md — this task is pure local rendering, no async/network). Confirmed no new fetch/API/try-catch paths were added in `grid.ts` or `GridEditor.tsx`; `validateGridSize` behavior is byte-for-byte unchanged from Task 1/2.

## Regression Check
| Feature | Result | Notes |
|---|---|---|
| Task 1 paint semantics (click-toggle, drag-lock stroke, resize-clears-cells) | ✅ PASS | 9/9 in `venue-grid-editor.spec.ts`, re-run live this session |
| Task 2 toolbar (tool selection, overwrite, eraser, per-tool drag-lock, resize keeps tool) | ✅ PASS | 10/10 in `venue-toolbar.spec.ts`, re-run live this session |
| `venue-grid` testid / pointer handlers / cell children | ✅ PASS | Diff confirms the `venue-grid` div is kept verbatim as a direct child of the new `venue-grid-frame` wrapper (GridEditor.tsx:251-263) — only ancestor structure was added, matching architect-plan D2's selector-stability requirement |
| `src/proxy.ts` / `src/app/api/**` / `src/lib/supabase/**` | ✅ PASS | `git diff --stat` shows zero diff in any of these paths |
| `playwright-tests/**` | ✅ PASS | `git status`/diff confirm no changes to existing specs or page objects |

## Security Test
- Sensitive data exposure: PASS — no new data emitted; pure client-side rendering of already-local `size`/`cells` state, no logging, no network calls
- Input validation: PASS — no new user-facing input boundary introduced; `axisLabels`/`countCellTypes` operate only on trusted internal state (`size`, `cells`), not raw user input
- Auth boundary: N/A — `/venue` remains a public page; `src/proxy.ts` matcher/allowlist untouched (confirmed via diff), no Supabase client imports added to either modified file

## Bugs Found
None.

## Test Coverage
- Manual checklist (`manual-tests/venue-grid-editor.md`, Task 3 section, 11 items): covers default 10×10 rulers, ≤20/>20 density switch, per-axis independence, non-multiple-of-5 tail, legend, live stats update across paint/erase/resize, and all three irregular-shape scenarios (non-contiguous, L-shape, hollow ring).
- Node-replay: `axisLabels` exercised standalone at 5 boundary dimensions (1, 20, 21, 23, 50) confirming exact match to the orchestrator's worked examples.
- Playwright: existing 19-test suite (Task 1+2) verified green this session; new Task 3 coverage (`playwright-tests/venue-scale-stats.spec.ts` per architect-plan) is deferred to the `playwright` pipeline stage — the designated next stage, not a gap.
- Build gates: `npm run lint` clean, `npx tsc --noEmit` clean, `npm run build` succeeds (`/venue` still statically prerendered, Proxy middleware unchanged, all API routes present).
- Status: PASS — new logic (`axisLabels`, `countCellTypes`, ruler/legend/stats rendering) has manual-checklist coverage now and a scheduled live-browser gate next; nothing shipped without test coverage, satisfying the AGENTS.md QA requirement.

## Outcome
✅ QA sign-off granted. Feature meets all 9 acceptance criteria, all edge cases hold, no regressions, no bugs. Routing to `playwright` stage for live-browser confirmation of ruler alignment, density switching, and the three irregular-shape scenarios.

---

## Playwright E2E Results
> Executed: 2026-07-12T20:05:00+08:00 (against local `npm run dev`, chromium)

New suite: `playwright-tests/venue-scale-stats.spec.ts` (extends `playwright-tests/pages/VenuePage.ts` with `gridFrame`/`rulerTop`/`rulerLeft`/`legend`/`stats*` locators + `rulerValues()`/`rulerLabel()`/`statsCounts()` helpers).

| Test | Acceptance Criterion | Result | Duration |
|---|---|---|---|
| AC1: default 10x10 rulers aligned | 頂部/左側各顯示 0..10,與格線對齊 | ✅ PASS | 915ms |
| AC2: legend text | 「每格 = 1 公尺」圖例存在 | ✅ PASS | 786ms |
| AC3: stats live paint/erase | 統計即時更新(0/0/0 → 3/2/0 → 擦除後 2/2/0) | ✅ PASS | 1.0s |
| AC4: overwrite floor→wall | 覆蓋後地板-1、牆壁+1 | ✅ PASS | 918ms |
| AC5: resize 25x8 density + reset | >20 寬軸每5m、高軸每格;resize 後統計歸0 | ✅ PASS | 942ms |
| AC6: resize 50x50 (max) | 兩軸皆每5m,尾端50有標 | ✅ PASS | 1.1s |
| AC5b: 23x23 non-multiple tail | 尾端非5倍數時額外附加(0,5,10,15,20,23) | ✅ PASS | 913ms |
| AC7: non-contiguous regions | 兩塊分離地板皆保留,統計為兩塊之和(8) | ✅ PASS | 973ms |
| AC8a: concave L-shape | L 形地板正確繪製,外側凹角維持空白 | ✅ PASS | 949ms |
| AC8b: hollow wall ring | 牆圍一圈,中空內部維持空白,牆統計=環格數(12) | ✅ PASS | 1.1s |

**Regression (Task 1 + Task 2, must stay green):**

| Suite | Tests | Result |
|---|---|---|
| `venue-grid-editor.spec.ts` (Task 1) | 9 | ✅ 9/9 PASS |
| `venue-toolbar.spec.ts` (Task 2) | 10 | ✅ 10/10 PASS |

**Full run:** `npx playwright test playwright-tests/venue-grid-editor.spec.ts playwright-tests/venue-toolbar.spec.ts playwright-tests/venue-scale-stats.spec.ts` → **29/29 passed**, 0 failed, no console errors observed, no screenshots generated (no failures).

### Notes
- One test-authoring bug was caught and fixed during this run (not a product bug): the initial L-shape and hollow-ring drag sequences started a second drag on a cell the first drag had already painted with the same tool — the app's real, intentional "start-on-same-type toggles erase" rule (also covered by Task 2's toolbar AC3) then erased instead of extending the shape. Fixed by splitting the drag paths so no drag starts on an already-painted matching cell; no application code was touched.
- Ruler alignment assertions used `boundingBox()` on both the grid and the `[data-axis-value]` label spans (±3px tolerance) rather than raw pixel math, staying resilient to minor layout/font rendering differences per the project's boundingBox-based locator convention.

### Failures
None.

## Outcome
✅ Playwright E2E complete — all 9 acceptance criteria (plus the confirmed boundary/edge cases: 1x1 implied by dense-branch AC1 logic, 50x50 max, 23x23 non-multiple tail) verified in a real browser. All 19 pre-existing Task 1+2 tests remain green, unmodified. No bugs found. Task 3 of 5 complete.
