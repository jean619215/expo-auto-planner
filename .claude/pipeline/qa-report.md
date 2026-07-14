# QA Report — 依平面圖資料建立 3D 白模 (Three.js + react-three-fiber)
> Generated: 2026-07-14T05:15:00+08:00 | QA iteration: 1

## Summary
- Tests executed: 8 acceptance criteria (via existing Playwright suite + independent re-verification) + 7 independent live-browser probes (script-driven, beyond the implementer's/reviewer's coverage) + 1 full-suite regression run
- Passed: 8/8 AC, 7/7 independent probes, 60/60 full Playwright suite
- Failed: 0
- Blocked: 0

## Recommendation
**APPROVED** — no bugs found. This is a genuinely independent QA pass (live `npm run dev` + a custom Playwright-driven exploration script reusing `PlanEditorPage`, not just re-running the implementer's spec file). All scenarios explicitly called out in the QA brief were probed and passed. Handing off to the `playwright` stage.

## Acceptance Criteria Results
| Criterion | Result | Notes |
|---|---|---|
| Button visible but disabled on default state (no walls/columns) | ✅ PASS | Re-confirmed via existing spec + independent probe (`columnOnlyCheck.disabledInitially: true`) |
| Button enables once ≥1 wall OR ≥1 column exists | ✅ PASS | Confirmed for wall-only (existing spec) **and independently for column-only**, which the implementer's own suite does not test (`columnOnlyCheck.enabledAfterColumnOnly: true`) |
| Click mounts R3F canvas below 2D canvas with correct floor/wall/column geometry, colors, sizing | ✅ PASS | Mesh counts match 2D state; visual screenshot of an L-shaped wall corner + diagonal wall + column shows continuous corner geometry and correctly non-axis-aligned rotation (see Independent Verification below) |
| Editing 2D plan after generation does not change already-rendered scene | ✅ PASS | Went beyond the automated test's "mesh count unchanged" check — independently verified via **structural 2D state diff** (wall moved, column resized via corner-drag, floor vertex dragged — `objectsAfter` genuinely differs from `objectsBefore`) while scene `data-*` attributes and pixel screenshots stayed byte-identical (`frozenSceneCheck.attrsUnchanged: true`) |
| Regenerating after edit rebuilds from scratch, no stale meshes | ✅ PASS | Re-confirmed via existing spec (60/60 suite) |
| Removing all walls/columns disables button but leaves existing scene as-is | ✅ PASS | Independently tested a **mixed deletion sequence** (Delete key on one wall, 刪除 button on another wall, Delete key on the column) not covered by the implementer's suite (which only tests a single deletion path) — button correctly disabled, stale scene's wall-mesh-count unchanged (`deleteAllSequenceCheck.wallMeshFinal === wallMeshAfterGenerate === 2`) |
| Concave floor polygon extrudes correctly via Shape/ExtrudeGeometry | ✅ PASS | Re-confirmed via existing spec, no crash |
| No SSR/hydration error on page load | ✅ PASS | Independently re-verified across **4 consecutive hard reloads** (not just one load) — 0 console errors of any kind, 0 hydration-pattern matches |

## Edge Case Results
| Edge Case | Result | Notes |
|---|---|---|
| Many walls/columns (dozens) placed rapidly | ✅ PASS | 20 walls + 20 columns placed sequentially (re-selecting the tool each time, since the app intentionally reverts to 選取 mode after each placement — confirmed this is by design, not a bug); all 20+20 rendered in the scene (`wallMesh: 20, colMesh: 20`), page stayed responsive (`document.readyState: "complete"`), generation took ~520ms, no visible glitch in screenshot |
| Column-only generation (no walls) | ✅ PASS | Button enable logic and generation both work correctly for this variant, which the implementer's own 9-test suite does not appear to isolate |
| Mixed-method deletion of all objects (Delete key + 刪除 button, in sequence, across wall+wall+column) | ✅ PASS | Button correctly disables; previously-generated scene is left fully intact, not cleared |
| Clicking "產生 3D 模型" mid-drag (mouse still down on a vertex elsewhere) | ✅ PASS (no functional issue) | Button remained enabled/reachable throughout; no crash, no error thrown. A synthetic click released over the button while a drag was captured elsewhere did not fire a scene generation — this matches standard DOM click semantics (a `click` event requires mousedown+mouseup on the same target) and is not an application bug; a real user's mouseup during an active vertex drag would land on the vertex/canvas, not trigger the button in the first place |
| Visual eyeball of generated 3D scene (floor under walls, continuous corners, columns as boxes) | ✅ PASS | Screenshot of an L-shaped 2-wall corner + a diagonal (non-axis-aligned) wall + a column shows: the two walls meet with **no visible gap** at the 90° corner (continuous box geometry, not detached), the diagonal wall renders at the correct oblique angle (confirms wall rotation independently of the reviewer's earlier script-based verification), and the floor slab is visible directly beneath the wall geometry, not floating/detached |
| Concave/zig-zag floor polygon | ✅ PASS | Re-confirmed via existing spec |
| Rapid double-click, no duplicate meshes | ✅ PASS | Re-confirmed via existing spec |

## Error State Results
| Error State | Result | Notes |
|---|---|---|
| WebGL/R3F init failure does not crash rest of page | N/A (not independently re-tested) | No WebGL-disable harness available in this environment; deferred to the implementer's/reviewer's prior assessment (console-error baseline acceptable per spec, no crash observed in any of this session's probes) |

## Regression Check
| Feature | Result |
|---|---|
| Task 1 — floor polygon editor (vertex drag/insert/delete, bounds, concave) | ✅ PASS (9/9 specs) |
| Task 2 — wall/column object system (draw, select, drag, delete, bounds) | ✅ PASS (17/17 specs) |
| Task 3 — resize handles, live dimension labels | ✅ PASS (12/12 specs) |
| Task 4 — 3D whitebox scene (this task) | ✅ PASS (9/9 specs) |
| Full suite, single clean run | ✅ PASS (60/60, ~2.4 min, zero failures/flakes) |

## Security Test
- Sensitive data exposure: PASS — no new data surface; pure client-side geometry from already-validated in-memory `plan.ts` state, nothing rendered that wasn't already visible in the 2D editor's own `data-*` attributes
- Input validation: PASS — no new external input surface introduced by this task (confirmed by reading the diff, consistent with orchestrator-output.md's Security Notes)
- Auth boundary: N/A — `/venue` has no auth gate, unchanged by this task

## Bugs Found
None.

## Independent Verification Performed (beyond the implementer's/reviewer's coverage)
1. **Deep frozen-scene check**: rather than only checking mesh counts stay constant after a 2D edit (as the automated suite does), moved a wall body, resized a column via a corner handle, and dragged a floor vertex after generation — confirmed the underlying 2D state (`data-objects`, `data-vertices`) genuinely changed while the mounted scene's `data-*` attributes and pixel screenshots remained byte-identical.
2. **Column-only generation path**: the automated suite's generation tests all start from a wall; independently verified the button enable/disable and generation both work when only a column exists (no walls at all).
3. **Mixed-method full deletion**: deleted objects via a combination of the Delete key and the 刪除 button (not just one method) across multiple objects, confirming the button disables and the stale scene is preserved regardless of deletion method.
4. **Load/stress test**: placed 20 walls + 20 columns in rapid succession via script (re-toggling the tool each time, since the app intentionally returns to 選取 mode after each placement — verified this is existing, intended Task 2 behavior, not a Task 4 regression) and confirmed all 40 objects rendered correctly with no hang.
5. **Visual inspection**: took a direct screenshot of `[data-testid="venue-scene"]` with an L-shaped 2-wall corner, a diagonal wall, and a column — confirmed walls join with no visible gap at the corner and the diagonal wall's orientation is visually correct, independently corroborating the reviewer's earlier algebraic/script-based rotation verification.
6. **Mid-drag click semantics**: clicked the generate button while a vertex drag was captured mid-gesture; confirmed no crash and the button stayed reachable — the absence of a fired scene generation in this specific synthetic case matches standard DOM click semantics, not an app defect.
7. **Multi-reload hydration check**: hard-reloaded `/venue` four times in one session and captured all console output; zero errors of any kind, zero hydration-pattern matches.
8. **Full-suite regression**: ran `npx playwright test playwright-tests/` clean, independently, once — 60/60 passed with no flakes.

## Test Coverage
- New code coverage: 9 Playwright tests (`playwright-tests/venue-3d-scene.spec.ts`) covering all 8 Clarified ACs plus 2 flagged edge cases, plus this session's 7 additional independent live-browser probes covering scenarios the automated suite does not isolate
- Minimum required (AGENTS.md): Playwright IS the FRONTEND acceptance gate; task ships with full spec coverage — requirement met
- Status: PASS
