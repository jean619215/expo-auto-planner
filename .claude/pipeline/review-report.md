# Code Review Report — [FRONTEND] 程序化 PBR 材質(地板/牆/柱), 步驟 03
> Generated: 2026-07-27T02:10+08:00 | Review iteration: 1
> Story: `stories/venue-refined-3d.md` task 3 | Plan: `.claude/pipeline/architect-plan.md`
> Diff reviewed: uncommitted working tree vs `571330f`

## Overall Assessment

**CHANGES REQUIRED** — 1 🔴 Critical (anisotropic filtering never reaches the GPU; the
assertion that guards it reads a setting the renderer ignores), 5 🟡 Should Fix, 4 💡.

## Summary

The architecture is sound and the plan was followed closely: the meter-UV convention (D2/D3)
is correct on all six box faces, the per-octave `mod(period)` seamlessness invariant holds in
every noise layer, D5's "bake the brightness, keep `color` white" is implemented as designed,
and the resource lifecycle is genuinely clean — `<primitive>` is the right choice (R3F never
disposes primitive objects, verified in `events-b389eeca.esm.js:15221`), so the shared
materials are owned solely by the provider and no double-dispose or premature-dispose path
exists. Scope discipline is good: `VenueScene.tsx`, `PlanEditor.tsx`, `src/lib/venue/*`,
`FURNITURE_DEFAULTS`, the furniture meshes and every task-2 shadow/lighting constant are
untouched; step 02's wall is still `#78350f`.

The one serious problem is the same class of defect this task has already hit twice: a
mitigation that is asserted at the *setting* level while the renderer silently does something
else. `anisotropy` is assigned after three has already finalised the render target's GL texture
parameters, so anisotropic filtering — the plan's named defence against grazing-angle moiré on
a 200 m floor (D4/R2) — is a no-op on the GPU, and T6 cannot see it. Separately, the "fixed"
T2/T5 grid readback is dispersed across the target but *phase-locked* to the noise lattice, so
it still does not measure the texture-wide statistics its comment claims.

---

## 🔴 Critical Issues (Must Fix — Pipeline Paused)

### Issue 1 — `anisotropy` is set too late and is silently discarded by three; T6 asserts the setting, not the reality

- **File**: `src/components/venue/surfaceTextures.ts:259` (assignment),
  `playwright-tests/venue-refined-materials.spec.ts:196-198` (the assertion that cannot see it)
- **Issue**:

  ```ts
  gl.setRenderTarget(target);                  // line 253 — first setRenderTarget on this RT
  gl.render(quadScene, quadCamera);
  target.texture.anisotropy = maxAnisotropy;   // line 259 — too late
  ```

  Verified line-by-line against `node_modules/three` (r185), not from memory:

  1. `WebGLRenderer.setRenderTarget()` calls `textures.setupRenderTarget(renderTarget)` on the
     first use of a target (`WebGLRenderer.js:2922-2924`, guarded by
     `__webglFramebuffer === undefined`).
  2. `setupRenderTarget()` is the **only** place a render-target texture's GL parameters are
     applied — `setTextureParameters(glTextureType, texture)` at `WebGLTextures.js:2216`.
  3. `setTextureParameters()` applies anisotropy only under
     `if (texture.anisotropy > 1 || properties.get(texture).__currentAnisotropy)`
     (`WebGLTextures.js:696-706`). At that moment `texture.anisotropy` is still the default `1`
     and `__currentAnisotropy` is `undefined`, so the branch is **skipped entirely** —
     `TEXTURE_MAX_ANISOTROPY_EXT` is never issued.
  4. Nothing re-applies it afterwards: `setTexture2D()` early-outs for render-target textures
     (`texture.isRenderTargetTexture === false && …`, `WebGLTextures.js:559`) and only binds;
     `updateRenderTargetMipmap()` only binds and calls `generateMipmap()`
     (`WebGLTextures.js:2252-2272`).

  So all 8 baked textures render with **anisotropy 1**. `wrapS`/`wrapT`/`minFilter`/
  `magFilter`/`generateMipmaps` are *not* affected — those are passed in the constructor
  options and are correctly in place at setup time. Only anisotropy is lost.

  T6 reads `material.map.anisotropy` — the JS property the code just assigned — so it reports
  `8` and stays green regardless. This is exactly the task-2 failure mode the plan's
  「驗證紀律」 section was written to prevent (「斷言了設定,而 renderer 已把它靜默降級」).

- **Impact**: D4/R2's primary moiré mitigation is inert. The plan is explicit that this is
  invisible in close-up testing and only manifests at grazing angles on a large floor
  (「近距離測試完全看不出來,只有掠射角遠景才炸」) — and the grazing-angle screenshot that
  would have caught it by eye is also missing (see 🟡 Issue 4). This directly threatens the AC
  「Given 地板放大至 200m … 不出現明顯重複格線或接縫」/「不出現摩爾紋」. It is also an
  architect-plan compliance failure (D4 requires the setting to be *effective*, and the Test
  Plan requires assertions to read renderer reality).
- **Required fix**:
  1. Pass anisotropy in the render-target options so it is set before `setupRenderTarget()`
     runs. `RenderTarget`'s constructor already forwards it
     (`three/src/core/RenderTarget.js:233`:
     `if (options.anisotropy !== undefined) values.anisotropy = options.anisotropy;`):

     ```ts
     const target = new THREE.WebGLRenderTarget(resolution, resolution, {
       …,
       anisotropy: maxAnisotropy,
     });
     ```
     and delete the post-`gl.render()` assignment at line 259.
  2. Harden T6 so it can never again pass on a discarded setting: assert the value three
     actually pushed to GL, which the renderer exposes —
     `gl.properties.get(texture).__currentAnisotropy` — reported from `RefinedSceneProbe.tsx`
     alongside the JS property. Assert both, and that they agree. (The same technique is
     already used correctly for `shadowMapAllocatedWidth`.)
  3. Re-run the materials spec and confirm the new probe field is `min(8, maxAnisotropy)` and
     not `undefined`; a green run of the hardened assertion against the *current* code would
     prove the assertion is still blind.

---

## 🟡 Should Fix (Developer auto-resolves)

### Issue 2 — The "texture-wide" T2/T5 readback grid is phase-locked to the noise lattice

- **File**: `src/components/venue/RefinedSceneProbe.tsx:249-276`
- **Issue**: The grid genuinely spans the whole target (a real improvement over the old fixed
  centre block, and the sample budget is preserved as claimed). But `STAT_GRID_N = 8` was
  deliberately chosen to *match* `surfaceHeight()`'s macro base frequency, and every noise
  period in the shader is `8`, `24`, `64`, `96` or a power-of-two multiple thereof. With
  `size = 1024`, block centres land at `uv = gx/8 + 1/16`, so:
  - macro layer (`fbm(uv, vec2(8.0))`): every block sits at fractional cell phase exactly
    `(0.5, 0.5)` — the cell centre, where the `f*f*(3-2f)` interpolant's derivative is at its
    **maximum** (1.5). `varianceXY` is therefore measured at the most gradient-favourable
    points in the texture, biased high.
  - fine-tint layers (`fbm(uv, 64)` and `fbm(uv+37, 96)`): `uv*64 = 8·gx + 4` and
    `(uv+37)*96 = 12·gx + 3558` — both exact integers, so every block starts precisely on a
    lattice vertex and covers only the `[0, 0.5)` quadrant of its cell. Half of every cell is
    never sampled, at any location.

  The result is a systematic sub-sample, not the texture-wide statistic the doc comment claims
  (「reflect the bake's texture-wide statistics」). It matters most for `max`: T5 asserts
  `max <= mean * 1.05`, while `TINT_AMP.floor = 0.064` permits excursions up to ~6.4 % of the
  base — the assertion plausibly only holds because 4096 phase-aligned texels out of 1 048 576
  (0.39 %) never see the tail. The brightness bound T5 claims to prove is therefore not
  actually proven.
- **Suggested fix**: Break the commensurability — either use a grid count coprime with the
  noise periods (e.g. `STAT_GRID_N = 7` or `11`) *plus* a deterministic per-block sub-cell
  jitter, or, simplest and assumption-free, read the full 1024² target once (4 MB, one-off,
  already off the per-frame path). Re-measure and re-derive the thresholds from the new
  numbers, documenting measured red/green margins as the previous fix did.

### Issue 3 — R1 (the plan's highest-risk item) has no assertion at all

- **File**: `playwright-tests/venue-refined-materials.spec.ts` (no `colorSpace` assertion)
- **Issue**: `RefinedSceneProbe.tsx` reports `colorSpace` per texture, but no test reads it.
  R1 is named in the plan as the easiest trap to fall into and the hardest to notice
  (「畫面『只是有點亮』,極易被誤認為調得不錯」). Crucially, T5 **cannot** cover it: the
  `colorSpace` flag changes how the shader *decodes* the texture, not the bytes in the render
  target, so the readback mean is byte-identical either way. R1 is currently unguarded.
- **Suggested fix**: Add to T5 (or T6):
  `expect(diagnostics.floor?.map.colorSpace).toBe("srgb-linear")`, and the same for
  `normalMap` / `roughnessMap` / `aoMap` and the wall/column maps.

### Issue 4 — T14's grazing-angle and wall-contact screenshots were not produced

- **File**: `playwright-tests/venue-refined-materials.spec.ts:338-361`
- **Issue**: Only one screenshot is produced (default 10 m camera). The plan's T14 and its
  Definition of Done require three: 10 m top view, **large venue at grazing angle**, and a
  **wall-flush furniture contact-line close-up**. Those two are not decorative — the plan
  states the grazing angle is the only effective way to read moiré (and it is the sole
  remaining check on Issue 1's failure mode), and the contact-line shot is the designated
  verification for D8's shading-noise / VSM-bleed risk (R5). The plan also requires QA to give
  an explicit pass/fail on 對外提案品質, which is not possible from the single image provided.
- **Suggested fix**: Extend the visual-evidence test to orbit/dolly to a low grazing angle over
  an enlarged floor, and to a close-up of a furniture item placed flush against a wall, writing
  all three PNGs to `playwright-report/`.

### Issue 5 — The wall's new base colour has no brightness check of any kind

- **File**: `src/components/venue/refinedLighting.tsx:107`
- **Issue**: The `#78350f → #d6d3d1` override is in scope and human-approved (D9), and step 02
  is correctly untouched — no complaint about the change itself. But it raises the wall's
  linear value from ~0.19 to ~0.66 (≈3.5×) under ACES / exposure 1.1, and nothing verifies the
  result: T5's readback covers only the **floor** albedo target, and the wall never appears in
  any brightness assertion or screenshot. The AC 「材質在既有 ACES tone mapping 與曝光 1.1 下
  不過曝,陰影對比仍清楚可辨」 is now unverified for the one surface whose brightness actually
  changed.
- **Suggested fix**: Extend the probe's readback to the wall albedo target and mirror T5's
  mean/max assertions against `linear(#d6d3d1)`; the wall shot from Issue 4 covers the visual
  half.

### Issue 6 — T3's wall UV guard is not independent of the code it guards

- **File**: `src/components/venue/RefinedSceneProbe.tsx:405-446`
- **Issue**: `computeWallUvMeterError()` re-encodes the same face→span table as
  `boxGeometry.ts:49-56`. The mapping itself is correct (verified against three's
  `BoxGeometry.buildPlane()` call order: `+x/-x → (d,h)`, `+y/-y → (w,d)`, `+z/-z → (w,h)`,
  4 vertices per face, no material-index splitting). But the actual risk D3 names is a *three
  upgrade changing that group order* — and if it changed, `applyMeterUv()` and the probe would
  be wrong in exactly the same way, so `wallUvMeterError` would read 0 and T3 would stay green
  while the 0.2 m faces silently stretched into stripes. The floor half of T3 is correctly
  independent (uv bbox vs. position bbox); the wall half is not.
- **Suggested fix**: Derive the expected span per group from the geometry's own `position`
  attribute (the face's real extent along its two in-plane axes) rather than from a copied
  literal table, so the guard depends on the geometry rather than on the assumption.

---

## 💡 Suggestions (Consider — No Action Required)

1. **`queueMicrotask` weakens the stated paint-time guarantee** (`SurfaceMaterials.tsx:82`).
   The comment claims parity with a synchronous `setState`, but React schedules the resulting
   normal-priority re-render through the scheduler (MessageChannel macrotask), not the
   microtask queue — a paint can land in between. Harmless in practice: the loading overlay
   covers exactly that window and T13 does not assert it away. Worth softening the comment.
2. **T4 covers only the floor albedo target and only the horizontal seam.** The wall and column
   maps, and the vertical (column 0 vs. column N-1) seam, are never measured. The column height
   function is anisotropic (`vec2(3.0, 18.0)`), so a u-axis-only regression there would be
   invisible. Low risk — the mechanism is shared and verified — but cheap to widen.
3. **The exact bake counts in T7/T8 are StrictMode-brittle.** `next.config.ts` leaves
   `reactStrictMode` unset, so effects are not double-invoked today; enabling it would double
   `totalBakes` and turn these into confusing red herrings rather than real failures. A comment
   pinning that dependency would save a future debugging session.
4. **`texture.channel = 0` (`surfaceTextures.ts:209`) is already the default**, and **box
   geometries are rebuilt for every wall on any plan edit** (any `walls` identity change
   recreates the whole map). Both are intentional/harmless — the geometry churn matches the
   existing `useFloorGeometry` pattern and disposes correctly — noted only so they are not
   mistaken for defects later.

---

## Security Assessment

- Secrets scan: **PASS** — no credentials, tokens or connection strings introduced.
- Input validation: **N/A** — no API route, no user input reaches this path; the bake consumes
  no plan data (UV is world-meters, D2).
- Auth/authz: **N/A** — `src/proxy.ts`, `src/lib/supabase/*`, `admin.ts` untouched.
- Sensitive data in logs: **PASS** — no logging added; `data-*` diagnostics expose only
  renderer state (texture sizes, filter enums, GPU statistics), no user or account data.
- Dependencies: **PASS** — zero new npm packages.
- External network: **PASS** — fully procedural; T10 enforces it with a request listener.
- CORS/CSP: untouched.
- Test coverage: 14 Playwright tests added (reported green, 40/40 alongside the refined-3d and
  refined-lighting suites); the gaps are Issues 2-6 above, not an absence of tests.

## Plan Compliance

- [x] Architect plan implementation steps 1-11 implemented
- [x] D1-D8 implemented as specified; D9 applied per human approval (`#d6d3d1`, step-03 only)
- [x] No unauthorised scope additions — `VenueScene.tsx`, `PlanEditor.tsx`,
      `RefinedSceneLoader.tsx`, `floorGeometry.ts`, `src/lib/venue/*`, `FURNITURE_DEFAULTS`,
      furniture meshes/materials and all task-2 shadow/lighting constants are zero-diff
- [x] Step 02 wall remains `#78350f`; `REFINED_SURFACE.column` `#78716c` matches step 02 exactly
- [x] `RefinedScene` read-only constraint intact (no geometry state, no `TransformControls`,
      no `onSceneChange`); 02/03 mutual exclusion and `AiPanel` mounting untouched
- [x] AGENTS.md: `useMemo` + `dispose()` for every geometry / material / render target; nothing
      created during render; the documented constant-placement deviation is the approved one
- [ ] **D4 not effectively delivered** — anisotropy is inert (🔴 Issue 1)
- [ ] **DoD step 12 incomplete** — 2 of 3 manual-judgement screenshots missing (🟡 Issue 4)

## Conversation Log

| Issue | Developer Response | Resolution |
|---|---|---|
| 🔴 1 anisotropy discarded by three | — | Pending: pipeline paused for human review |
| 🟡 2-6 | — | Held pending the Critical decision |

---

**Pipeline action**: `flags.review_critical_pending = true`, `iteration.review = 1`,
`checkpoints.review = "changes_requested"`. Not advanced to QA.
