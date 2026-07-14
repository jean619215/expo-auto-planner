# Code Review Report — 依平面圖資料建立 3D 白模 (Three.js + react-three-fiber)
> Generated: 2026-07-14T04:30:00+08:00 | Review iteration: 1

## Overall Assessment
APPROVED

## Summary
Task 4 implements the 3D whitebox generator (floor extrusion, per-wall/column boxes, snapshot-on-click generation) exactly per the architect plan. Both sign-convention risks the plan flagged as needing manual verification (floor extrusion direction, wall rotation formula) were independently re-verified in this review using the actual installed `three` library, not just the developer's report — both are mathematically and empirically correct. All 60 Playwright tests (51 pre-existing + 9 new) pass on a clean run against a live dev server. Code is clean: no `any`, no TODOs, correct dependency placement, lint/tsc clean.

## 🔴 Critical Issues (Must Fix — Pipeline Paused)
None.

## 🟡 Should Fix (Auto-resolved by Developer)
None.

## 💡 Suggestions (Consider — No Action Required)
### Suggestion 1
- **File**: `src/components/venue/VenueScene.tsx:25-34`
- **Issue**: `FloorMesh`'s `useMemo` on `geometry` is dead weight in practice — the whole `VenueScene` subtree is unmounted/remounted on every regeneration via `key={generation}` on `VenueSceneLoader`, so this component only ever mounts once per snapshot and the memo never has a chance to skip a recompute.
- **Note**: Harmless, and arguably good defensive practice if the remount-per-generation strategy ever changes. No action needed.

### Suggestion 2
- **File**: `src/components/venue/VenueScene.tsx:41`
- **Issue**: `data-generated="true"` on the `venue-scene` wrapper is redundant with the element's own existence (as the architect's own plan note acknowledges). Purely informational, not asked to be removed.

## Security Assessment
- Secrets scan: PASS (no secrets/tokens/credentials introduced)
- Input validation: N/A (pure client-side geometry from already-validated `plan.ts` state, no new user input surface)
- Auth/authz: N/A (`/venue` has no auth gate today, unchanged by this task; per AGENTS.md's PR Reviewer instruction, this task touches no auth/session/`DATABASE_URL` surface so the automatic 🔴 rule does not apply — confirmed, no such code touched)
- Test coverage: 9 new Playwright tests covering all 8 Clarified ACs plus both flagged edge cases (concave polygon, rapid double-click); independently re-run and verified 9/9 passing plus 60/60 full-suite passing with zero regressions

## Independent Verification Performed (beyond trusting the implementer's report)

1. **Floor extrusion direction** (`VenueScene.tsx:37`, `rotation={[Math.PI / 2, 0, 0]}`): Wrote a standalone Node script using the project's actual installed `three` package, built the identical `Shape`/`ExtrudeGeometry`/rotation as the real component, and computed a `THREE.Box3` bounding box. Result: `min.y ≈ -0.1`, `max.y ≈ 0` — confirms the slab's top face is at y=0 and it extrudes downward to y=-0.1, exactly matching the spec. The developer's reported bug (previously `-Math.PI/2` extruding upward to y=+0.1) was also reproduced and matched via hand derivation of the rotation matrix before checking the script, confirming the root cause diagnosis was correct, not just the symptom.

2. **Wall rotation formula** (`VenueScene.tsx:63-66`, `rotationY = -Math.atan2(dy, dx)`): Derived algebraically that this formula is the unique correct solution for aligning a box's local +X axis with a plan-space direction `(dx, dy)` mapped to Three world `(x, z)` under Three's standard right-handed Y-axis rotation convention. Independently re-verified with a script building actual `THREE.Mesh`/`BoxGeometry` objects for 6 wall segments (four non-axis-aligned diagonals in different quadrants plus 2 axis-aligned controls), computing each box's world-space local-X direction via quaternion, and checking `dot(planDir, worldDir) ≈ 1` for all six. All passed exactly.

3. **Playwright suite**: Ran independently against a fresh `npm run dev` server (not reusing developer's session) — `playwright-tests/venue-3d-scene.spec.ts` 9/9 passed in isolation, then full suite 60/60 passed with zero regressions on a second clean run (a prior run showed spurious failures caused by this reviewer's own accidental `pkill` of the dev server mid-suite — re-run cleanly to rule out a false positive).

4. **Snapshot-on-click / full-replace semantics** (`PlanEditor.tsx`): Read the actual diff — `sceneSnapshot`/`generation` state is declared after `polygon`/`walls`/`columns` (no reference-before-declaration issue), `handleGenerate3D` does a shallow-copy snapshot exactly as planned, `VenueSceneLoader` is keyed by `generation` and conditionally rendered only when `sceneSnapshot !== null`, matching the plan's Data Flow section exactly. Confirmed structurally (not just by trusting the plan) that `VenueScene` receives snapshot props only, with no subscription to `PlanEditor`'s live state — verified further by Playwright test 4 (edit-after-generate does not change rendered mesh counts) and test 5 (regenerate reflects new state) both passing.

5. **Button placement**: Confirmed in the diff that the "產生 3D 模型" button is rendered directly inside `PlanEditor.tsx`'s JSX between `<PlanToolbar />` and `<Stage>`, not inside `PlanToolbar.tsx` — matches the architect's explicit judgment call and stated rationale (keeping `PlanToolbar` scoped to 2D-editor-mode-only props).

6. **Dependencies**: `three`, `@react-three/fiber`, `@react-three/drei` are correctly under `dependencies` in `package.json` (not `devDependencies`). No `--legacy-peer-deps` or `--force` flags found in `package-lock.json`; `package-lock.json` shows normal peer-dependency resolution (`three: ">=0.159.0"` etc. all satisfied by the installed `0.185.1`).

7. **Code quality**: `npm run lint` and `npx tsc --noEmit` both clean (re-run independently, zero output/errors). `grep` for `TODO`/`FIXME`/stray `console.*`/`debugger`/`: any`/`as any` across all changed files returned nothing.

## Plan Compliance
- [x] All architect plan steps implemented (install deps, `VenueScene.tsx`, `VenueSceneLoader.tsx`, `PlanEditor.tsx` changes, manual-tests section, Playwright spec + page-object accessors)
- [x] Implementation matches plan intent, including both explicitly-flagged sign-convention risks resolved correctly (independently re-verified, not just trusted)
- [x] No unauthorised scope additions — no orbit controls, no 2D/3D toggle, no persistence, no mesh merging/instancing, consistent with Task 4's stated Out of Scope

## Conversation Log
| Issue | Developer Response | Resolution |
|---|---|---|
| N/A — no should-fix or critical issues raised this iteration | — | — |
