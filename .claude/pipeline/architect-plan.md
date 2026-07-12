# Architect Plan — 網格真實尺寸標示（座標軸公尺標籤 + 比例尺圖例 + 面積統計）與不規則形狀驗證

> Story: 場地白模產生器 (階段一) | Task type: FRONTEND | Task 3 of 5 | Generated: 2026-07-12T17:30:00+08:00

## Overview

Add real-world scale affordances to the existing `GridEditor`: a top and left meter ruler aligned to the grid, a 「每格 = 1 公尺」 legend line, and a live painted-area stats line (floor/wall/column cell counts = ㎡). The second half of the task is **verification only** — prove via Playwright scenarios that irregular (non-contiguous, concave, hollow) painted shapes already work; no new painting features.

## Task Type Confirmed

FRONTEND. Purely client-side rendering additions in `src/components/venue/GridEditor.tsx` plus pure helpers in `src/lib/venue/grid.ts`. No API, no proxy, no auth, no persistence. Consistent with `state.json` `current_task`.

> ⚠️ Note for reviewer: `.claude/pipeline/orchestrator-output.md` on disk still contains the **Task 2** spec — the Task 3 orchestrate stage's decisions were recorded in `task-log.md` (2026-07-12T17:10 entry) but the output file was not rewritten. This plan is based on those logged, human-confirmed decisions (axis labels top+left 0-based, ≤20 every meter / >20 every 5 m per dimension, 每格=1公尺 legend, live area stats, irregular shapes as verification). Not an escalation blocker, but the orchestrator-output.md staleness should be fixed when convenient so downstream QA reads the right spec.

## Confirmed Decisions (from orchestrate stage)

- Axis labels on **top + left**, in meters, **0-based** (「0起算」).
- Label density per dimension, evaluated **independently** for width and height: dimension ≤ 20 → label every meter; dimension > 20 → label every 5 m. Gridlines themselves are unchanged (still one border per cell).
- Legend line: 「每格 = 1 公尺」.
- Stats line: live counts of floor/wall/column cells; 1 cell = 1 平方公尺; updates on every paint/erase/resize.
- Irregular-shape support (non-contiguous, concave, hollow) = **test scenarios**, not new code.

## Design Decisions

### D1 — Label semantics: 0-based *edge* labels (ruler convention)

Labels mark **gridline edges** `0 .. dimension` (a 10 m axis shows 0–10, i.e. 11 labels), not cell centers. Rationale: this is how physical rulers/architectural drawings work, it matches the confirmed 0起算 decision, and it lets the user read the total dimension directly off the last label. For a >20 dimension, labels are the multiples of 5 (`0, 5, 10, …`) **plus the final edge** (e.g. 23 m → `0, 5, 10, 15, 20, 23`) so the total is always visible; at 24 px/m the tightest pair (e.g. 20 vs 21) still has ~10 px clearance for 2-digit text at ~10px font.

### D2 — Ruler layout: absolutely-positioned label strips inside a 2×2 CSS-grid wrapper

Chosen approach: wrap the existing grid in a wrapper using CSS grid `grid-template-columns: auto auto; grid-template-rows: auto auto` producing four areas — corner spacer / top ruler / left ruler / `venue-grid`. Each ruler is a `position: relative` strip sized exactly to the grid edge (`widthM * CELL_SIZE_PX` wide, resp. `heightM * CELL_SIZE_PX` tall) containing absolutely-positioned `<span>` labels at `left: value * CELL_SIZE_PX; transform: translateX(-50%)` (top ruler) / `top: value * CELL_SIZE_PX; transform: translateY(-50%)` (left ruler).

Why this over a "one ruler cell per grid column" CSS-grid ruler:
- Edge labels (D1) sit at gridline positions, i.e. **between** cells — a cell-per-label grid can only center labels on cells, forcing 1-based cell-center semantics we rejected.
- The 5 m-step density is trivially expressed (render only the labels you want at exact pixel offsets) with no empty filler cells.
- All positions derive from `CELL_SIZE_PX` (imported from `grid.ts`) and the `size` state, so a resize re-renders rulers in perfect alignment automatically — same single source of truth the grid itself uses.

The existing `venue-grid` div keeps its `data-testid`, its pointer handlers, and its cells as direct children — the wrapper is purely structural, so `VenuePage` locators (`venue-grid` + `[data-x][data-y]` descendants) are untouched.

### D3 — Logic/rendering split

Pure, React-free helpers go in `src/lib/venue/grid.ts` (same pattern as `validateGridSize`/`TOOLS`): label-position generation and cell-type counting. `GridEditor.tsx` only maps helper output to JSX. This keeps the rules verifiable through Playwright at both densities and reusable by Task 4 if the 3D view wants the same scale/stats.

### D4 — Stats derivation

Compute counts by a single pass over the `cells` Map on each render (max 2,500 entries — negligible; no memoization needed, matching the codebase's no-premature-abstraction rule). Empty is implicit (`total cells − painted`), and the confirmed scope is floor/wall/column only.

## Files to Create

| File path | Purpose |
| --------- | ------- |
| *(none in implement stage)* | |
| `playwright-tests/venue-scale-stats.spec.ts` *(playwright stage)* | Task 3 acceptance suite: rulers at both densities, legend, live stats, irregular-shape scenarios (see Test Plan) |

## Files to Modify

| File path | What changes |
| --------- | ------------ |
| `src/lib/venue/grid.ts` | Add `AXIS_LABEL_DENSE_MAX = 20`, `AXIS_LABEL_STEP = 5`; add `axisLabels(dimension: number): number[]` (≤20 → `[0..dimension]`; >20 → multiples of 5 plus `dimension` if not already included); add `countCellTypes(cells: ReadonlyMap<string, CellType>): Record<CellType, number>`. Pure functions, zero React deps, JSDoc in the file's existing 繁中 comment style |
| `src/components/venue/GridEditor.tsx` | Wrap grid in the 2×2 ruler layout (corner spacer + top ruler + left ruler + existing `venue-grid` unchanged); render labels from `axisLabels(size.widthM)` / `axisLabels(size.heightM)`; add legend line 「每格 = 1 公尺」; add stats line from `countCellTypes(cells)`; new data-testids (see below) |
| `manual-tests/venue-grid-editor.md` | Append 「Task 3 — 尺寸標示與不規則形狀」 checklist section (see step 8) |
| `playwright-tests/pages/VenuePage.ts` *(playwright stage)* | Add locators/helpers: `rulerTop`, `rulerLeft`, `rulerLabel(axis, value)`, `legend`, `statsFloor/Wall/Column` count readers |

## Implementation Steps

1. **`src/lib/venue/grid.ts` — constants.** Below `CELL_SIZE_PX`, add `export const AXIS_LABEL_DENSE_MAX = 20;` and `export const AXIS_LABEL_STEP = 5;` with a 繁中 comment explaining the density rule.
2. **`src/lib/venue/grid.ts` — `axisLabels(dimension: number): number[]`.** Returns edge-label values for one axis: if `dimension <= AXIS_LABEL_DENSE_MAX`, return `[0, 1, …, dimension]`; else return `[0, 5, 10, …]` up to `dimension`, appending `dimension` itself when it is not a multiple of `AXIS_LABEL_STEP`. Document the edge-label (not cell-center) semantics in the JSDoc.
3. **`src/lib/venue/grid.ts` — `countCellTypes(cells: ReadonlyMap<string, CellType>): Record<CellType, number>`.** Single iteration over `cells.values()`, initializing `{ floor: 0, wall: 0, column: 0 }`. No React/DOM imports.
4. **`GridEditor.tsx` — ruler layout wrapper.** Replace the current bare `venue-grid` block with:
   - Outer wrapper `data-testid="venue-grid-frame"`, `display: grid; gridTemplateColumns: auto auto; gridTemplateRows: auto auto`, `w-fit select-none` (move `select-none` up so ruler text is also unselectable; `venue-grid` keeps its own classes otherwise).
   - Cell (1,1): empty corner spacer div (sized implicitly by the ruler tracks).
   - Cell (1,2): top ruler `data-testid="grid-ruler-top"` — `position: relative`, `width: size.widthM * CELL_SIZE_PX`, fixed height (~`1rem`), containing `axisLabels(size.widthM).map(v => <span key={v} data-axis-value={v} style={{ position: "absolute", left: v * CELL_SIZE_PX, transform: "translateX(-50%)" }} className="text-[10px] text-zinc-500">{v}</span>)`.
   - Cell (2,1): left ruler `data-testid="grid-ruler-left"` — `position: relative`, `height: size.heightM * CELL_SIZE_PX`, fixed width (~`1.5rem`), labels at `top: v * CELL_SIZE_PX; transform: translateY(-50%)`, right-aligned with small right padding so digits sit against the grid edge.
   - Cell (2,2): the existing `venue-grid` div **verbatim** — same testid, same pointer handlers (`onPointerUp`/`onPointerLeave`), same inline grid styles, same cell children. Do not rename or re-nest cells.
5. **`GridEditor.tsx` — legend line.** Directly below the grid frame: `<p data-testid="grid-scale-legend" className="text-sm text-zinc-600">每格 = 1 公尺</p>`.
6. **`GridEditor.tsx` — stats line.** Compute `const stats = countCellTypes(cells);` in the render body. Render `<p data-testid="grid-stats" className="text-sm text-zinc-600">` containing three spans: `地板 <span data-testid="stats-floor">{stats.floor}</span> 平方公尺`、`牆壁 <span data-testid="stats-wall">{stats.wall}</span> 平方公尺`、`柱子 <span data-testid="stats-column">{stats.column}</span> 平方公尺`, separated by 「・」. Numeric-only testid spans keep Playwright assertions exact. (Stats update automatically on paint/erase/resize because they derive from `cells` state — resize clears the Map, so all counts drop to 0; verify this stays true.)
7. **Alignment sanity check (developer, in-browser).** With default 10×10, confirm label "0" sits on the top-left grid corner, "10" on the top-right/bottom-left corners, and each intermediate label on its gridline. Resize to 30×10 and confirm the top ruler switches to `0,5,…,30` while the left ruler still labels every meter (per-dimension independence), and to 23×23 to confirm the appended final edge label.
8. **`manual-tests/venue-grid-editor.md` — append Task 3 section** with checklist items:
   1. 預設 10×10:上/左標尺各顯示 0–10 共 11 個標籤,對齊格線邊緣(0 在左上角)。
   2. ≤20 密度:調整為 20×20,每公尺都有標籤。
   3. >20 密度:調整為 30×30,標籤為 0,5,10,15,20,25,30(格線本身不變)。
   4. 每軸獨立:調整為 30×10,上標尺每 5 公尺、左標尺每 1 公尺。
   5. 非 5 倍數尾端:調整為 23×23,尾端顯示 20 與 23 兩個標籤且不重疊。
   6. 圖例:網格下方顯示「每格 = 1 公尺」。
   7. 統計即時更新:畫 3 格地板、2 格牆壁、1 格柱子,統計列顯示 地板 3/牆壁 2/柱子 1 平方公尺;擦除 1 格地板後變 2;套用尺寸後全部歸 0。
   8. 不規則形狀 — 非連續:畫兩塊分離的地板區域,兩塊皆保留、中間不自動連接,統計為兩塊面積之和。
   9. 不規則形狀 — 凹形:畫一個 L 形/凹形地板,形狀如實保留。
   10. 不規則形狀 — 中空:畫一圈牆壁圍住空白內部,內部維持空白,統計只計牆壁格數。
   11. 標尺對齊拖曳:拖曳繪製一整列後,該列端點與標尺數字對齊(目視確認格與公尺對應正確)。
9. **Quality gates (developer, before handoff):** `npm run lint`, `npx tsc --noEmit`, `npm run build` all pass; rerun existing suites `npx playwright test playwright-tests/venue-grid-editor.spec.ts playwright-tests/venue-toolbar.spec.ts` against a dev server — all 19 must pass **with zero spec modifications**.

## Data Flow

```
size (state) ──► axisLabels(size.widthM)  ──► top-ruler spans   (left = v × CELL_SIZE_PX)
            └──► axisLabels(size.heightM) ──► left-ruler spans  (top  = v × CELL_SIZE_PX)
cells (Map state) ──► countCellTypes(cells) ──► stats line (地板/牆壁/柱子 ㎡)
paint / erase / 套用尺寸 mutate `cells`/`size` → normal React re-render refreshes rulers + stats.
No refs, effects, network, or persistence involved.
```

## Test Plan

No unit test framework exists (per AGENTS.md) — helper correctness is exercised through Playwright + the manual checklist.

- **Manual checklist:** `manual-tests/venue-grid-editor.md` Task 3 section (step 8) — written by the developer as part of implement.
- **Playwright (acceptance gate, playwright stage):** new `playwright-tests/venue-scale-stats.spec.ts` using extended `VenuePage`:
  1. Default 10×10: `grid-ruler-top`/`grid-ruler-left` visible; top ruler has 11 labels (`[data-axis-value]` count = 11) including `0` and `10`.
  2. Density switch: resize to `30×10` → top ruler labels are exactly `0,5,10,15,20,25,30`; left ruler still has 11 labels (per-dimension independence).
  3. Non-multiple tail: resize to `23×10` → top ruler ends with `…,20,23`.
  4. Legend: `grid-scale-legend` has text `每格 = 1 公尺`.
  5. Stats live update: paint 3 floor + 2 wall + 1 column → `stats-floor/wall/column` read `3/2/1`; erase one floor → `2`; toggle-off one wall (same-type click) → `1`; resize → all `0`.
  6. Irregular — non-contiguous: two separated floor regions (reuse `dragPaint`) → both intact, gap empty, `stats-floor` = sum.
  7. Irregular — concave: paint an L-shape (two perpendicular drags) → every L cell `floor`, the concave-corner cell outside the L `empty`, stats match cell count.
  8. Irregular — hollow: wall ring around an empty interior (e.g. 4×4 ring) → interior cells `empty`, `stats-wall` = ring size, `stats-floor` = 0.
  9. Regression: existing 19 tests in `venue-grid-editor.spec.ts` + `venue-toolbar.spec.ts` pass unmodified.
- **Edge cases covered:** dimension exactly 20 (dense) vs 21 (sparse) boundary — include one assertion pair (resize 20×20 → 21 labels on each axis; 21×21 → `0,5,10,15,20,21`).

## Architecture Notes

- **Selector-stability audit:** `VenuePage` addresses everything via `data-testid` (`venue-grid`, inputs, toolbar) and `data-x`/`data-y` descendants of `venue-grid`; the new wrapper adds ancestors only, never touching `venue-grid`'s identity or its children, and `cellCenter`/`dragPaint` use `boundingBox()` (layout-shift-proof). All 19 existing tests should pass untouched; step 9 verifies empirically.
- **Deviation check:** none — pure-helper-in-`grid.ts` + rendering-in-component mirrors the Task 1/2 structure; inline styles for pixel-exact positioning follow the existing precedent (`venue-grid`'s own inline `gridTemplateColumns`).
- **Stale orchestrator-output.md** (see banner at top) — plan built from the logged, human-confirmed Task 3 decisions.
- **Performance:** `countCellTypes` is O(painted cells) ≤ 2,500 per render; ruler spans ≤ 51 per axis. No memoization warranted.
- **Risk — label overflow at grid edges:** `translateX(-50%)` makes the `0` label overhang the left ruler edge by half its width; the corner spacer (left-ruler track width) absorbs it. Developer should confirm no horizontal clipping at 50×50.

## Security Checklist

- [ ] No hardcoded secrets or credentials (task introduces none; pure UI)
- [ ] Input validation at system boundaries — unchanged `validateGridSize`; no new inputs added
- [ ] Auth/permission checks — N/A; `/venue` remains a public page, `src/proxy.ts` untouched
- [ ] No sensitive data logged — no logging added
- [ ] No Supabase client usage introduced in client components (project rule) — none
- [ ] `src/proxy.ts`, `src/app/api/**`, `src/lib/supabase/**` must show zero diff at review

## Definition of Done

- [ ] All implementation steps 1–9 complete
- [ ] Rulers align with gridlines at 10×10, 20×20, 21×21, 30×10, 23×23, 50×50
- [ ] Legend 「每格 = 1 公尺」 and live stats line render with the specified testids
- [ ] Manual checklist Task 3 section added
- [ ] Playwright: existing 19 tests green unmodified; new Task 3 suite (playwright stage) green
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm run build` pass
- [ ] No TODOs, commented-out code, or debug logs
- [ ] Code follows AGENTS.md (`@/*` imports, no new deps, no direct Supabase calls)
- [ ] Security checklist passed
