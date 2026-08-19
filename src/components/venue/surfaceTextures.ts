"use client";

// architect-plan.md 階段 A 步驟 2 — 程序化貼圖的烘焙 / 釋放 / 存活計數。
// 只被 SurfaceMaterials.tsx(RefinedScene.tsx 專用)使用;不得被
// VenueScene.tsx(步驟 02)import。

import * as THREE from "three";
import {
  columnPreset,
  floorPreset,
  wallPreset,
  type SurfaceSelection,
} from "@/lib/venue/surfacePresets";
import {
  BAKE_VERTEX_SHADER,
  buildBakeFragmentShader,
  type BakeMode,
  type BakeSurface,
} from "./surfaceBakeShader";

// --- D3/D4: tile size, resolution --------------------------------------

export const FLOOR_TILE_M = 6;
export const WALL_TILE_M = 3;
export const COLUMN_TILE_M = 3;
export const FLOOR_MACRO_TILE_M = 64;

export const FLOOR_RES = 1024;
export const WALL_RES = 512;
export const COLUMN_RES = 512;
export const MACRO_RES = 256;

// D8 — final shading-time normal perturbation strength (material.normalScale).
export const NORMAL_SCALE: Record<BakeSurface, number> = {
  floor: 0.25,
  wall: 0.35,
  column: 0.5,
};

// Bake-time normal strength (how strongly surfaceHeight()'s gradient is
// converted into a perturbed normal *inside the baked texture itself*).
// Distinct from NORMAL_SCALE (D8, applied again at shading time) — kept
// moderate here so the baked map still has headroom before NORMAL_SCALE
// tones it down; larger for column to match its coarser formwork grain.
//
// floor: retuned down from an initial 3, empirically against the real GPU
// readback (not simulated — see TINT_AMP.floor's note below on why offline
// simulation of this hash function doesn't reliably predict a real
// readback's statistics). strength=3 (tuned by feel, pre-dating any
// real-GPU readback check) produced baked normals markedly tilted away
// from +Z in places where surfaceHeight()'s central-difference gradient is
// steep. 0.10 keeps T2's normal assertion (`floorNormal.meanZ > 0.9`,
// currently measured texture-wide via RefinedSceneProbe.tsx's dispersed
// grid readback — see STAT_GRID_N there) comfortably above the 0.9 floor
// while still producing a visible normal map; NORMAL_SCALE.floor (above)
// further tones it down at shading time as originally designed.
//
// Historical note: this value was originally tuned against
// RefinedSceneProbe.tsx's *old* readback, which sampled one fixed 64x64
// center block rather than the whole texture — at that block's exact
// location the gradient happened to be unusually steep (meanZ ~0.14 at
// strength=3 there specifically), which is why 0.10 was chosen. The
// readback has since been fixed to sample texture-wide (see
// RefinedSceneProbe.tsx's STAT_GRID_N doc), and 0.10 still clears the 0.9
// floor with real margin against that honest measurement — re-verified,
// not just carried over.
const NORMAL_BAKE_STRENGTH: Record<BakeSurface, number> = {
  floor: 0.1,
  wall: 4,
  column: 5,
};

// D4 — anisotropic filtering cap (device max is read per-bake and the
// smaller of the two is applied; see bakeSurfaceTextures()).
export const MAX_ANISOTROPY = 8;

// D7 — macro (aoMap) de-repetition parameters.
export const AO_MAP_INTENSITY = 0.6;
export const MACRO_ROTATION_RAD = 0.7;

// D5 — albedo tint amplitude (fraction of base color) per surface.
//
// floor: retuned from an initial 0.045. Root cause (verified against the
// real GPU readback, not guessed or purely simulated — offline JS
// reimplementations of the sin()-based hash consistently diverged from
// actual shader output, so every number below came from
// bakeSurfaceTextures() rendering for real and RefinedSceneProbe.tsx
// reading it back, not from prediction): RefinedSceneProbe.tsx's T2/T5
// readback originally sampled a *fixed, small* 64x64 center block of the
// 1024x1024 bake (~4% of its width). surfaceHeight()'s dominant "macro"
// layer has period 8 (128px cells), so that block sat inside roughly half
// of one cell and only ever saw that cell's local, near-linear
// interpolation — not the layer's texture-wide statistics. Whichever cell
// the block happened to land in, that alone decided whether the block read
// as near-flat (T2's variance failure) or off-center (T5's mean failure);
// amplitude alone could not fix that, and every amplitude tried against
// surfaceHeight() directly traded one failure for the other.
//
// Fixed structurally via `uFineTintWeight` in surfaceBakeShader.ts (a
// separate contrast layer mixed into ALBEDO_MAIN only, decoupled from
// surfaceHeight()/NORMAL_MAIN so the normal map's bump detail is
// unaffected — see FINE_TINT_WEIGHT below) built from two decorrelated
// period-64/96 fbm layers (so a small block always spans several full
// cells of each, regardless of where it lands) with a tanh-based soft tail
// compression (see ALBEDO_MAIN's `fineTint` — compresses only the rare
// samples nearing the layer's +-1 extreme, leaving the bulk that drives
// T2's variance close to linear).
//
// floor (second retune): 0.064 was verified against RefinedSceneProbe.tsx's
// *dispersed-grid* readback (STAT_GRID_N x STAT_GRID_N small blocks) — but
// review-report.md Issue 2 found that grid was itself under-sampling: only
// ~0.39% of the bake's texels were ever read, and the grid's cell count
// happened to be commensurate with the noise periods, so the rare
// near-extreme texels the tanh tail-compression is specifically there to
// bound were mostly never sampled. Once the readback was fixed to read the
// FULL 1024x1024 target (RefinedSceneProbe.tsx's `readFullAlbedoStats`),
// 0.064 measured a real `max/mean` of ~1.061 — over T5's 1.05 ceiling by a
// margin the grid-based readback had been structurally blind to. Retuned
// down to 0.05 and re-verified against that same honest, full-texture
// readback (not simulated): variance still clears T2's 0.0002 floor by a
// wide margin (this layer's contribution scales with amplitude, and 0.05
// is still far larger than what a flattened surfaceHeight() alone would
// produce — see T2's inline margin note in the spec), and `max/mean` now
// clears T5's 1.05 ceiling with real margin.
const TINT_AMP: Record<BakeSurface, number> = {
  floor: 0.05,
  wall: 0.025,
  column: 0.035,
};

// Fraction of ALBEDO_MAIN's tint sourced from the fine-detail layer vs.
// surfaceHeight() (see surfaceBakeShader.ts's `uFineTintWeight` doc
// comment) — 0 for wall/column, which never exhibited T2/T5's small-block
// sampling problem and keep their original surfaceHeight()-only tint
// unchanged.
const FINE_TINT_WEIGHT: Record<BakeSurface, number> = {
  floor: 1,
  wall: 0,
  column: 0,
};

// D6 — floor-only roughness map base/amplitude. Baked as the *full* value
// (not multiplied by material.roughness, which SurfaceMaterials.tsx sets
// to 1 for the floor) — mirrors the albedo trick (D5): the texture is the
// sole source of the final value, `material.color`/`material.roughness`
// stay neutral (white / 1).
// 地板 roughnessMap 的基準值。改成跟著 preset 走 —— 地毯與石材的差別
// 主要就在這裡,只換底色的話兩者在畫面上幾乎一樣。
function roughBaseFor(selection: SurfaceSelection): number {
  return floorPreset(selection.floor).roughness;
}
const ROUGH_AMP = 0.12;

function baseColorFor(
  surface: BakeSurface,
  selection: SurfaceSelection,
): THREE.Color {
  switch (surface) {
    case "floor":
      return new THREE.Color(floorPreset(selection.floor).color);
    case "wall":
      return new THREE.Color(wallPreset(selection.wall).color);
    case "column":
      return new THREE.Color(columnPreset(selection.wall).color);
  }
}

export interface SurfaceTextureSet {
  floor: {
    map: THREE.Texture;
    normalMap: THREE.Texture;
    roughnessMap: THREE.Texture;
    aoMap: THREE.Texture;
  };
  wall: { map: THREE.Texture; normalMap: THREE.Texture };
  column: { map: THREE.Texture; normalMap: THREE.Texture };
  // Exposed for RefinedSceneProbe's gl.readRenderTargetPixels() probes
  // (T2/T4/T5) — the render targets themselves, not just `.texture`.
  floorAlbedoTarget: THREE.WebGLRenderTarget;
  floorNormalTarget: THREE.WebGLRenderTarget;
  // Exposed for the wall brightness readback (review-report.md Issue 5 —
  // the wall's D9 base-color override had no GPU-readback brightness
  // check of any kind; T5 previously covered the floor albedo target
  // only).
  wallAlbedoTarget: THREE.WebGLRenderTarget;
  // 柱子 albedo:柱子材質跟隨牆面(feedback round 2, R6),而「跟隨」
  // 只有在烘焙出來的像素上看得見,貼圖參數描述不會因為底色而變。
  columnAlbedoTarget: THREE.WebGLRenderTarget;
  // All 8 targets, for disposeSurfaceTextureSet().
  targets: THREE.WebGLRenderTarget[];
}

// Real, GPU-event-driven counters (architect-plan.md D-note on
// WebGLRenderTarget's 'dispose' event) — NOT incremented/decremented by
// our own "intent" flags, so a leak in the caller (forgetting to call
// disposeSurfaceTextureSet) shows up here truthfully.
let liveTargets = 0;
let totalBakes = 0;

export function getSurfaceTextureStats(): { liveTargets: number; totalBakes: number } {
  return { liveTargets, totalBakes };
}

/**
 * Bakes all 8 procedural surface textures (floor albedo/normal/roughness/
 * macro-ao, wall albedo/normal, column albedo/normal) into
 * `WebGLRenderTarget`s via a fullscreen-quad shader pass, using the given
 * renderer's own GPU context. Must run inside a `useLayoutEffect` (see
 * SurfaceMaterials.tsx) so it completes before the browser paints.
 */
export function bakeSurfaceTextures(
  gl: THREE.WebGLRenderer,
  selection: SurfaceSelection,
): SurfaceTextureSet {
  totalBakes += 1;

  const prevTarget = gl.getRenderTarget();

  const quadGeometry = new THREE.PlaneGeometry(2, 2);
  const quadScene = new THREE.Scene();
  // Vertex shader (surfaceBakeShader.ts) writes gl_Position directly from
  // the quad's own [-1,1] xy, bypassing all camera matrices — this camera
  // only satisfies gl.render()'s API contract.
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const maxAnisotropy = Math.min(MAX_ANISOTROPY, gl.capabilities.getMaxAnisotropy());

  // Repeat/channel/rotation config is applied here — on a freshly-created
  // local `WebGLRenderTarget`, before it is ever handed to React state
  // (SurfaceMaterials.tsx stores the returned SurfaceTextureSet via
  // `useState`) — rather than in SurfaceMaterials.tsx's material-building
  // useMemo, which would mutate a value already held in React state (the
  // project's react-hooks/immutability lint rule forbids that; see
  // refinedLighting.tsx's precedent for the same class of imperative
  // Three.js configuration).
  function configureTexture(texture: THREE.Texture, surface: BakeSurface, mode: BakeMode): void {
    if (surface === "floor" && mode === "macro") {
      // D7: macro de-repetition — different tile scale, rotated (and
      // off-axis from the 6m tile) so the two periods never lock into a
      // visible combined pattern. aoMap reads UV channel 0 (three's
      // `getChannel(0) === 'uv'`), so no second UV attribute is needed.
      texture.channel = 0;
      texture.repeat.set(1 / FLOOR_MACRO_TILE_M, 1 / FLOOR_MACRO_TILE_M);
      texture.center.set(0.5, 0.5);
      texture.rotation = MACRO_ROTATION_RAD;
      return;
    }
    const tileM = surface === "floor" ? FLOOR_TILE_M : surface === "wall" ? WALL_TILE_M : COLUMN_TILE_M;
    texture.repeat.set(1 / tileM, 1 / tileM);
  }

  function bake(surface: BakeSurface, mode: BakeMode, resolution: number): THREE.WebGLRenderTarget {
    const material = new THREE.ShaderMaterial({
      vertexShader: BAKE_VERTEX_SHADER,
      fragmentShader: buildBakeFragmentShader(surface, mode),
      uniforms: {
        uBaseColor: { value: baseColorFor(surface, selection) },
        uResolution: { value: resolution },
        uNormalStrength: { value: NORMAL_BAKE_STRENGTH[surface] },
        uRoughBase: { value: roughBaseFor(selection) },
        uRoughAmp: { value: ROUGH_AMP },
        uTintAmp: { value: TINT_AMP[surface] },
        uFineTintWeight: { value: FINE_TINT_WEIGHT[surface] },
      },
    });
    const mesh = new THREE.Mesh(quadGeometry, material);
    quadScene.add(mesh);

    // architect-plan.md 事前查證表:非 XR render target 不做 sRGB 編碼
    // (WebGLPrograms.js:212),烘焙輸出是線性資料 — colorSpace 一律
    // LinearSRGBColorSpace,含 albedo(R1:誤設 SRGBColorSpace 會二次解碼、
    // 把地板炸亮,直接毀掉 task 2 的抗過曝調校)。generateMipmaps /
    // minFilter / wrapS / wrapT / anisotropy 皆須顯式設定 — WebGLRenderTarget
    // 的預設值(false / LinearFilter / ClampToEdgeWrapping / 1)全都是錯的
    // (R2)。**anisotropy 必須在建構子的 options 裡給,不能事後對
    // `target.texture` 賦值**:three r185 的 `WebGLRenderer.setRenderTarget()`
    // 只在該 target 第一次使用時呼叫 `textures.setupRenderTarget()` →
    // `setTextureParameters()`(WebGLRenderer.js:2922-2924,
    // WebGLTextures.js:2216),而各向異性只在
    // `texture.anisotropy > 1 || properties.get(texture).__currentAnisotropy`
    // 為真時才會呼叫 `TEXTURE_MAX_ANISOTROPY_EXT`(WebGLTextures.js:696-706)。
    // 若在 `gl.render()` 之後才寫 `target.texture.anisotropy = …`,那次
    // setup 早已跑完(此時 `texture.anisotropy` 還是預設值 1,分支被跳過),
    // 之後也沒有任何路徑會重新套用 —— 8 張烘焙貼圖會全部停在
    // anisotropy 1,D4/R2 的掠射角摩爾紋防護形同虛設,且 T6 若只讀
    // `texture.anisotropy`(我們自己剛賦的 JS 屬性)會誤判為綠燈(這正是本
    // task PR review 抓到的 Critical bug,見 review-report.md Issue 1)。
    const target = new THREE.WebGLRenderTarget(resolution, resolution, {
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      colorSpace: THREE.LinearSRGBColorSpace,
      anisotropy: maxAnisotropy,
    });

    gl.setRenderTarget(target);
    gl.render(quadScene, quadCamera);
    // WebGLRenderer.render() auto-generates the mipmap chain for the
    // current render target when generateMipmaps is true (three r185,
    // WebGLRenderer.js:1764-1774 / WebGLTextures.js:110). Anisotropy was
    // already applied above, during this same setRenderTarget() call's
    // setupRenderTarget() pass — nothing to do here.

    configureTexture(target.texture, surface, mode);

    quadScene.remove(mesh);
    material.dispose();

    liveTargets += 1;
    target.addEventListener("dispose", () => {
      liveTargets -= 1;
    });

    return target;
  }

  const floorAlbedoTarget = bake("floor", "albedo", FLOOR_RES);
  const floorNormalTarget = bake("floor", "normal", FLOOR_RES);
  const floorRoughnessTarget = bake("floor", "roughness", FLOOR_RES);
  const floorMacroTarget = bake("floor", "macro", MACRO_RES);
  const wallAlbedoTarget = bake("wall", "albedo", WALL_RES);
  const wallNormalTarget = bake("wall", "normal", WALL_RES);
  const columnAlbedoTarget = bake("column", "albedo", COLUMN_RES);
  const columnNormalTarget = bake("column", "normal", COLUMN_RES);

  gl.setRenderTarget(prevTarget);
  quadGeometry.dispose();

  return {
    floor: {
      map: floorAlbedoTarget.texture,
      normalMap: floorNormalTarget.texture,
      roughnessMap: floorRoughnessTarget.texture,
      aoMap: floorMacroTarget.texture,
    },
    wall: { map: wallAlbedoTarget.texture, normalMap: wallNormalTarget.texture },
    column: { map: columnAlbedoTarget.texture, normalMap: columnNormalTarget.texture },
    floorAlbedoTarget,
    floorNormalTarget,
    wallAlbedoTarget,
    columnAlbedoTarget,
    targets: [
      floorAlbedoTarget,
      floorNormalTarget,
      floorRoughnessTarget,
      floorMacroTarget,
      wallAlbedoTarget,
      wallNormalTarget,
      columnAlbedoTarget,
      columnNormalTarget,
    ],
  };
}

export function disposeSurfaceTextureSet(set: SurfaceTextureSet): void {
  for (const target of set.targets) {
    target.dispose();
  }
}
