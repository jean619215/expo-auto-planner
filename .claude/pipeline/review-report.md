# Code Review Report — 建立 Konva 平面圖編輯器基礎
> Generated: 2026-07-12T (review stage) | Review iteration: 1

## Overall Assessment
APPROVED WITH MINOR FIXES

## Summary
Clean, faithful implementation of the architect plan: full deletion of the old grid editor (7 files, zero dangling references), pure meter-space geometry module, and a Konva editor that keeps all state in meters with px only at render time. Lint, tsc, and `npm run build` all pass; `/venue` prerenders statically, proving no SSR evaluation of Konva. Two behavioral gaps in interaction handling (edge-insert distance threshold, stale vertex selection after deletion) are flagged as Should Fix.

## 🔴 Critical Issues (Must Fix — Pipeline Paused)
None.

## 🟡 Should Fix (Auto-resolved by Developer)

### Issue 1 — Double-click anywhere inside the polygon inserts a vertex (missing distance threshold)
- **File**: `src/components/venue/PlanEditor.tsx:98-107`
- **Issue**: `handleEdgeDblClick` is attached to the closed, filled `Line`, so its hit region includes the polygon interior. The handler calls `findClosestEdge` but discards the returned `distance`, so a double-click in the middle of the floor (far from any edge) still inserts a vertex on the nearest edge. Spec/plan require insertion only when double-clicking *on an edge* (architect plan step 4 explicitly called for filtering to ~0.5m of an edge).
- **Suggested fix**: Destructure `distance` from `findClosestEdge` and return early (no-op) when `distance > 0.5` (meters) before calling `insertVertexOnEdge`.

### Issue 2 — Stale `selectedVertex` after right-click deletion of a lower-index vertex
- **File**: `src/components/venue/PlanEditor.tsx:109-117`
- **Issue**: After `removeVertex(polygon, index)`, indices above `index` shift down by one, but `selectedVertex` is only cleared when it equals the deleted index. Example: polygon `[A,B,C,D,E]`, select D (index 3), right-click-delete B (index 1) → selection stays 3, which now highlights E; pressing Delete then removes E instead of the vertex the user selected. Architect plan step 4 required "clear/adjust selectedVertex after deletion".
- **Suggested fix**: In `handleVertexContextMenu`, when deletion actually occurred (`next !== polygon`), update selection: `null` if `current === index`, `current - 1` if `current > index`, else unchanged. (Or simply clear selection on any successful deletion.)

## 💡 Suggestions (Consider — No Action Required)
1. `src/components/venue/PlanEditor.tsx:86-96` — `handleVertexDragEnd` is a verbatim copy of `handleVertexDragMove`; it could simply delegate to it. Functionally correct (idempotent settle step per plan), duplication only.
2. `src/components/venue/PlanEditor.tsx:194-210` — Scale-bar label (`5 公尺`) starts at `y = stagePx - 14` with a 12px font, so glyph bottoms land ~2px from the canvas edge and sit under the bar line drawn at `stagePx - 16`. Legibility is on the manual checklist; nudging the label up or the bar line down a few px would give clearer separation.
3. `src/components/venue/PlanEditor.tsx:22,61` — With `MIN_STAGE_PX = 320`, containers narrower than 320px cause the canvas to overflow its wrapper (no `overflow-x` handling). Acceptable per spec ("minimum practical scale"), noted for the small-viewport manual check.

## Security Assessment
- Secrets scan: PASS (no secrets, tokens, credentials; no network/API/persistence added)
- Input validation: PASS (pointer coords are NaN-guarded via `safeNumber`, snapped to 0.5m, clamped to [0,50] in `plan.ts`)
- Auth/authz: N/A — `/venue` remains public; `src/proxy.ts`, `src/lib/supabase/*`, `src/app/api/*` all untouched (verified via git diff)
- Dependency additions: `konva@10.3.0`, `react-konva@19.2.5` only; `react-konva` peer range `react ^19.2.0` satisfied by project `react@19.2.4`
- Test coverage: no unit framework in repo (per AGENTS.md); manual checklist created (`manual-tests/venue-plan-editor.md`), Playwright specs planned for the `playwright` stage per architect Test Plan

## Plan Compliance
- [x] All architect plan steps implemented (deps installed; 7 old files deleted; `plan.ts` / `PlanEditor.tsx` / `PlanEditorLoader.tsx` / rewritten `page.tsx` / manual checklist created)
- [x] Implementation matches plan intent (meter-space state, pure lib module with no React/Konva imports, `ssr: false` inside a Client Component loader, server-component page shell, data-testid/data-vertices/data-vertex-count/data-px-per-meter/data-stage-size hooks, 1m/5m gridlines, axis labels + 5m scale bar, drag write-back via `node.position()`, min-3-vertex guard, duplicate-vertex insert no-op, Traditional Chinese UI text)
- [x] No unauthorised scope additions (no zoom/pan, no walls/columns, no persistence, no proxy/matcher changes)

Verification evidence:
- `grep -rn "GridEditor|venue/grid|VenuePage" src playwright-tests manual-tests` → only the coincidental `function VenuePage()` component name in `src/app/venue/page.tsx`; no imports of deleted modules remain.
- `npm run lint` → clean. `npx tsc --noEmit` → clean. `npm run build` → succeeds; `/venue` listed as ○ (static prerender), confirming no `window is not defined` at build.

## Conversation Log
| Issue | Developer Response | Resolution |
|---|---|---|
| 🟡 Issue 1 (edge-insert distance threshold) | Pending — handed to developer for auto-resolution | Open |
| 🟡 Issue 2 (stale selectedVertex after deletion) | Pending — handed to developer for auto-resolution | Open |
