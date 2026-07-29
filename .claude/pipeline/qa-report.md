# QA Report — 打光與陰影(步驟 03) / venue-refined-3d.md task 2
> Generated: 2026-07-26T11:20+08:00 | QA iteration: 1

## Summary

- Tests executed: 14 automated (`venue-refined-lighting.spec.ts`) + 8 manual visual-checklist items (executed live against a running dev server, not rubber-stamped) + 2 supplementary QA debug probes (root-cause + product-behavior confirmation for the one automated failure)
- Passed: 13 automated + 8 manual
- Failed: 1 automated (案例9, **test-authoring bug**, confirmed not a product defect — see Bug 1)
- Blocked: 0

## Recommendation

**REJECTED — one High-severity bug must be fixed before sign-off.**

The product code itself is in very good shape (see Acceptance Criteria table — all 10 ACs pass, all edge cases the product needs to handle are handled correctly, including 極大場地 which I independently re-verified). The blocker is entirely inside the new spec file: `venue-refined-lighting.spec.ts` 案例9 fails deterministically (3/3 runs) because the wall it tries to draw is placed off-canvas and is silently never created, so the 「極大場地」edge case currently has **zero working automated coverage** even though architect-plan.md's Definition of Done requires 14/14 green. This is exactly the risk the reviewer flagged in Suggestion 4 ("案例 9…是本 spec 中對畫布座標最敏感的一條…若出現 flake,優先懷疑此處而非產品程式碼") — it materialized, and it isn't a flake, it's 100% reproducible.

Per AGENTS.md/ship-mate QA rules this routes back to **implement** (test file only — no production code change needed). `iteration.qa` is currently 0, well under the 2-loop cap.

---

## Acceptance Criteria Results

| # | Criterion (orchestrator-output.md) | Result | Evidence |
| --- | --- | --- | --- |
| AC1 | 多盞光源打亮,暗部有補光,無全黑死角 | ✅ PASS | 案例1 (`lightCount≥4`, `shadowCastingLightCount===1`); manual checklist item 1/3 — live screenshot `qa-check-2-detail.png` shows visible fill light on shadowed faces, no dead-black areas |
| AC2 | 物件投射柔邊(PCF soft)陰影 | ✅ PASS | 案例2 (`shadowMapType==="PCFSoft"`), 案例4 (caster/receiver counts correct: 4 = 1 wall+1 column+2 furniture, floor excluded); manual checklist item 2 — screenshots show soft, non-jagged shadow edges |
| AC3 | 陰影解析度 2048,清晰不鋸齒不糊 | ✅ PASS | 案例3 (`shadowMapSize==="2048"` **and** `shadowMapAllocatedWidth==="2048"` — the latter only ever set by an actual `WebGLShadowMap.render()` pass, so this proves the shadow pass genuinely ran, not just that the prop was set) |
| AC4 | Tone mapping / color space,多光疊加不過曝死白 | ✅ PASS | 案例5 (`toneMapping==="ACESFilmic"`, `outputColorSpace==="srgb"`, exposure 0.8–1.6); manual checklist item 4 — no blown-white patches in any of the 5 live screenshots I captured, including the overlapping-light floor center |
| AC5 | 步驟02維持現況(無陰影,原 ambient+directional) | ✅ PASS | 案例7 (`venue-scene` has no `data-lighting-ready` attribute — probe genuinely absent from 02, not just hidden); `git status`/`git diff` for this task's changeset touches only `RefinedScene.tsx` + 3 new files — `VenueScene.tsx` is absent from the diff entirely |
| AC6 | 數十件家具下仍可流暢旋轉,無明顯卡頓 | ✅ PASS (structural, see note) | 案例1 (`shadowCastingLightCount===1`, i.e. exactly one shadow-pass light regardless of furniture count) + D6 `autoUpdate=false` (verified by reading `refinedLighting.tsx:136-148`: shadow map is only re-baked in the `[gl, bounds, revision]` layout effect, never per-frame) → shadow pass count while orbiting is structurally 0. **Caveat**: I did not (and could not, as a non-interactive QA agent) measure actual frame rate with 30+ furniture items under continuous 10s rotation — this is the one manual-checklist item architect-plan.md itself designed to be un-automatable ("不做 FPS 斷言…在真實 dev server + 開發機 GPU 上必然 flaky"). Recommend a human spot-check per manual checklist item 6 before final ship, but nothing in the implementation contradicts the structural guarantee. |
| AC7 | 返回02時光源/shadow map資源釋放,往返不累積 | ✅ PASS | 案例12 (`lightCount`/`shadowCastingLightCount`/`rendererTextures`/`rendererGeometries` identical after 3 round trips; `canvas` count stays 1 throughout — mutual-exclusion never breaks) |
| AC8 | 唯讀行為不變(無選取/無 gizmo,僅 OrbitControls) | ✅ PASS | 案例13 (click on canvas center leaves `data-furniture` unchanged; sidebar/place/reset controls all absent) |
| AC9 | AI側欄仍隱藏;返回02後對話與草稿保留 | ✅ PASS (by construction) | `PlanEditor.tsx:1605-1607` (`data-hidden`, `inert`, `className="hidden"` when `step==="refined"`) is untouched by this task's diff, and `AiPanel.tsx` is absent from the diff entirely — the persistence behavior this AC restates was established and tested by the prior task and cannot have regressed since neither file changed |
| AC10 | 步驟01/02既有行為全部不變 | ✅ PASS | `PlanEditor.tsx` / `VenueScene.tsx` / `floorGeometry.ts` / `plan.ts` / `furniture.ts` all absent from this task's diff (git status confirms only `RefinedScene.tsx` + 3 new files changed); I additionally exercised 2D wall/column/furniture placement and a mocked AI `move_item` tool call live against the running dev server as part of my own verification runs below — all worked exactly as before |

## Edge Case Results

| Edge Case | Result | Notes |
| --- | --- | --- |
| 空場景(僅地板,無牆/柱/家具) | ✅ PASS | 案例11: enters 03 cleanly, `shadowCasterMeshCount==="0"`, `shadowCameraSpanM > 0` (MIN_SHADOW_RADIUS_M guard works), zero `pageerror` events |
| 極大場地(可達 200m) | ⚠️ **Product PASS, automated test FAILS** | See Bug 1 below. I independently confirmed the underlying D2 dynamic-frustum logic works correctly for large scenes using a wall that stays within the visible canvas (`span` returned **73** vs. the default-floor baseline of ~22, i.e. it does grow with content as designed) — the failure is confined to `venue-refined-lighting.spec.ts`'s own coordinate math, not to `bounds.ts` / `refinedLighting.tsx` |
| 極小場地(遠小於 200m) | ✅ PASS | 案例8: default 10m floor → `span < 60`, i.e. not opened to the 200m worst case |
| 凹多邊形地板 | ✅ PASS (by construction, not independently re-exercised) | `FloorMesh` still calls the shared `useFloorGeometry(polygon)` unchanged; this task only added material props + `receiveShadow` to the same mesh. Concave-polygon geometry itself is out of this task's scope and already covered by task 1's `venue-refined-3d.spec.ts` regression suite, which passed unmodified |
| 高瘦物件(bannerStand 2.0m / cabinet 1.8m)不被 near/far 截斷 | ✅ PASS | 案例10 (`near≥0`, `far>near`, **and** the real invariant `far-near ≥ span+3`, which rules out a degenerate near/far formula that would still pass the weaker bounds checks); I also placed both items live and confirmed `shadowCasterMeshCount==="2"` with no visual clipping |
| 家具貼牆(shadow acne / peter-panning) | ✅ PASS | Not covered by an automated assertion (D8 explicitly rejects pixel comparison as too flaky) — I built and ran a live QA script placing a `cabinet` directly against a wall and captured a zoomed screenshot (`qa-check-5-wall-flush.png`, described below): clean contact shadow, no visible striping/noise on the wall face, no bright gap between the cabinet's base and the floor |
| 往返累積(02→03→02→03…) | ✅ PASS | 案例12, see AC7 |

## Manual Visual Checklist (architect-plan.md Test Plan, executed live via a QA browser automation script against the running dev server — screenshots saved to `playwright-report/`, not committed since that directory is gitignored)

| # | Item | Result | Evidence |
| --- | --- | --- | --- |
| 1 | 進入03不是平光白模,有亮暗面與可辨識落地陰影 | ✅ PASS | `qa-check-2-detail.png`: table/cabinet/bannerStand show distinct light/shadow faces, soft shadow blobs beneath each |
| 2 | 陰影邊緣柔和、無鋸齒、未糊成大方塊 | ✅ PASS | Same screenshot — shadow edges are visibly blurred/soft, not stair-stepped or blocky |
| 3 | 暗部不死黑 | ✅ PASS | Object faces away from the key light remain visibly colored (not pure black) in all captured screenshots |
| 4 | 多光重疊處無過曝死白 | ✅ PASS | No blown-white patches anywhere on the floor across 5 screenshots, including areas directly under the key light |
| 5 | 貼牆家具無亮縫(peter-panning)/無條紋雜訊(acne) | ✅ PASS | `qa-check-5-wall-flush.png`: cabinet pushed flush against a wall — clean contact, wall face shows no noise, no gap between cabinet base and floor |
| 6 | 數十件家具連續旋轉10秒無明顯掉幀 | ⚠️ Not independently measurable by QA agent | See AC6 note — structural guarantee holds (0 shadow passes/frame while orbiting); recommend human spot-check, does not block sign-off given the structural evidence and the architect's own explicit decision not to assert FPS automatically |
| 7 | 02→03→02各兩次,02畫面逐項相同 | ✅ PASS | 案例7 + 案例12 automated coverage; `VenueScene.tsx` untouched by this task's diff |
| 8 | **03停留時用AI面板移動一件家具,陰影跟著移動**(carried forward, see below) | ✅ PASS | See dedicated section below |

### Item 8 — concrete verification method (the carried-forward item)

The reviewer flagged this as the only end-to-end verification of D2 (`updateProjectionMatrix`) + D6 (`autoUpdate=false` + revision-driven rebake), and asked QA to decide concretely how it gets verified. My conclusion: **it cannot be a pure Playwright assertion** — `RefinedScene`'s diagnostic `data-*` attributes (deliberately, per D8) expose only renderer/camera state (light count, shadow map size, camera span/near/far, tone mapping, etc.), never object positions, so there is no DOM-readable signal that a specific mesh moved. Asserting "the shadow followed" therefore requires either pixel comparison (D8 already rejected this project-wide as flaky across machines/GPUs) or a human eyeball. I did not want to leave this as a bare "TODO: ask a human" though, so I ran it myself:

1. Built a throwaway Playwright script (deleted after use, never committed — confirmed via `git status`) that mocks `/api/ai/chat` with a delayed (`delayMs: 2000`) `move_item` tool-call response, following the exact mocking convention already used in `ai-panel-persistent.spec.ts`.
2. Discovered along the way that `AiPanel` is `hidden`+`inert` while `step==="refined"` (`PlanEditor.tsx:1605-1607`), so "using the AI panel while sitting on 03" is only possible in the sense the architect's D6 note describes: the request is sent from step 02, then the user switches to 03 *before the response lands*, and the tool call applies to the shared top-level state asynchronously while 03 is the active view. My script reproduces exactly that sequence.
3. Result: comparing the pre-move screenshot to the post-move screenshot, the moved furniture item (and its shadow) relocated together, landing next to the item that was already at the target coordinates — the shadow never lagged behind or stayed at the old position. This confirms D2/D6 work end-to-end for the "AI mutates the scene while the user is looking at 03" scenario, not just at entry to 03.

**Recommendation for the permanent test suite** (not applied by me — QA does not edit code): a lightweight version of this could become a real automated case using the same delayed-mock pattern plus a "did *some* region of the canvas change between before/after" bounding-box screenshot diff (not full pixel comparison) if the team wants permanent regression coverage here. I did not add it since it's outside my mandate.

---

## Regression Check

| Feature | Result |
| --- | --- |
| 步驟 01 (2D 平面圖編輯 — wall/column tools) | ✅ PASS — exercised live in my own verification scripts, worked identically to existing spec expectations |
| 步驟 02 (白模預覽 / 3D 手動編輯) | ✅ PASS — 案例7/12; `VenueScene.tsx` untouched |
| AI tool call 套用 (`move_item`) | ✅ PASS — exercised live with a mocked delayed response, applied correctly to top-level state while 03 was active |
| `venue-refined-3d.spec.ts` (task 1, 12 cases) | Not re-run by me in this pass (unmodified by this task's diff per `git status`; already reviewer-verified) — recommend the upcoming playwright stage runs it per architect-plan.md 步驟13 requirement |
| Other 8 listed regression specs (步驟13) | Not re-run by me — same reasoning; none of their source files are in this task's diff |

## Security Test

- Sensitive data exposure: **PASS** — probe reads only renderer/scene state (`gl`, `scene`, light/shadow properties), never logs anything, no new API surface
- Input validation: **N/A** — no new API routes or user input paths introduced
- Auth boundary: **N/A** — `src/proxy.ts` untouched, `/venue` was already unauthenticated before this task
- Network egress: **PASS** — re-confirmed via 案例6 (zero requests to `githack.com`/`polyhaven`/`.hdr`/`.exr`) and observed directly during my own live sessions (no external requests logged)
- Static checks: `npx tsc --noEmit` → 0 errors; `npm run lint` → 0 errors/warnings (both re-run by me, not just trusted from the review report)

## Bugs Found

### Bug 1: `venue-refined-lighting.spec.ts` 案例9 (極大場地 edge case) fails deterministically — off-canvas wall never gets drawn

- **Severity**: High
- **Acceptance Criterion / edge case affected**: Edge case 「極大場地」(orchestrator-output.md) — currently has **no working automated coverage**, and this is one of `architect-plan.md`'s Definition of Done items ("14 個案例全綠")
- **File**: `playwright-tests/venue-refined-lighting.spec.ts:211-233`
- **Steps to Reproduce**:
  1. `npx playwright test venue-refined-lighting.spec.ts -g "案例9" --project=chromium` (reproduced 3/3 runs, not a flake)
  2. Or manually: zoom out 30× on `/venue`, draw a wall from meter (5,5) to (195,5), check `wallCount()` — it is `0`
- **Root cause** (confirmed by direct instrumentation of `meterToScreen`): at the zoom level the 30 `clickZoomOut()` calls converge to (25%, i.e. `pxPerMeter=16 × scale=0.25 = 4px/m`), the endpoint (195,5) maps to screen x≈1208, but the canvas element's bounding box only spans x∈[128, 928] (800px wide). The drag's `mouseup` lands ~280px outside the canvas, so Konva never registers the wall — `wallCount()` stays 0, and the scene entering 03 is just the untouched default 10m floor (`data-shadow-camera-span-m` comes back **22**, matching 案例8's baseline, not a large-scene value).
- **Expected**: `shadowCameraSpanM` for a scene containing a ~190m-long wall should be well over 60 (strictly greater than 案例8's baseline).
- **Actual**: The wall is never created; the test measures the default-floor case again and fails the `toBeGreaterThan(60)` assertion with `22`.
- **This is confirmed to be a test-authoring bug, not a product defect** — I built a second throwaway script that draws a *shorter* wall ((5,5)→(65,5), which stays within the canvas at the same 25% zoom floor) and got `wallCount=1`, `shadowCameraSpanM=73` (correctly > 60 and clearly larger than the small-venue baseline), proving `bounds.ts`'s `planBoundsM` and `refinedLighting.tsx`'s dynamic-frustum effect both work correctly for large scenes. The reviewer's own Suggestion 4 predicted this exact failure mode in advance ("案例 9…是本 spec 中對畫布座標最敏感的一條").
- **Impact**: Blocks a clean playwright-stage run (14/14 required by Definition of Done) and leaves an orchestrator-mandated edge case with zero real automated protection against a future regression in the large-scene frustum path — low product risk today (the logic is simple and I independently verified it), but the gap itself must be closed.
- **Suggested fix** (for implement, not applied by me): shrink the wall's target x from 195 to something that both (a) stays within the canvas at whatever zoom level the test settles on, and (b) still clears the `> 60` threshold with margin — e.g. the (5,5)→(65,5) wall I used above already produces `span=73`. Alternatively, keep the far endpoint but pan the stage first, or assert against the actual `pxPerMeter()`/`stageScale()`/`stagePosition()` to pick a target guaranteed to land within `canvas.boundingBox()` regardless of exact zoom convergence.

No Medium or Low bugs found in the production code changes themselves.

## Test Coverage

- New code coverage: 14/14 spec cases target every AC + edge case per architect-plan.md's Test Plan table; 13/14 currently pass, with the 1 failure isolated to test code (Bug 1) rather than the feature under test
- Minimum required (AGENTS.md): Playwright is the FRONTEND acceptance gate; no unit/integration framework exists for this project, consistent with prior tasks
- Status: **FAIL** pending Bug 1 fix — cannot proceed to the `playwright` pipeline stage with a known-failing case in the suite it will run

---

## Routing

- `flags.qa_bugs_pending` → `true`
- `checkpoints.qa` → stays unset (not `"completed"`)
- Routes back to **implement** to fix `venue-refined-lighting.spec.ts` 案例9 only (High severity; no production code changes indicated)
- `iteration.qa` was 0 going into this pass, well under the 2-loop escalation cap
