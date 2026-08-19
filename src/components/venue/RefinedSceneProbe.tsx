"use client";

// architect-plan.md D8 — a scene-internal probe that reads the *actual*
// renderer/scene state (not source-literal values) so Playwright can assert
// shadows are genuinely running. In particular, `shadowMapAllocatedWidth`
// reads `keyLight.shadow.map?.width`, a WebGLRenderTarget that only
// `WebGLShadowMap.render()` ever allocates — its presence at the expected
// size is the strongest available proof, short of pixel inspection, that
// the shadow pass actually executed for that light.
//
// architect-plan.md 階段 C 步驟 8 (task 3) extends this with material
// diagnostics: actual texture objects on the actual floor/wall/column
// materials (not the constants file), plus `gl.readRenderTargetPixels()`
// readback of the baked albedo/normal render targets — the only way to
// prove the bake shader really ran (see Test Plan T2/T4/T5). The readback
// reads the render target's FULL width x height (see `readFullAlbedoStats`/
// `readFullNormalStats` below) rather than a sub-sample, so mean/max/
// variance are the bake's true texture-wide statistics with no sampling
// assumption of any kind. It is computed once (cached in a ref) rather than
// every frame.
//
// PR-review history (review-report.md, this task's iteration 1): an earlier
// version of this readback sampled a small fixed center block, then a grid
// of blocks dispersed across the target — but the grid's cell count
// (`STAT_GRID_N = 8`) was accidentally commensurate with
// `surfaceHeight()`'s noise periods (8/24/64/96, all multiples of 8), so
// every sample block landed on the same fractional phase within its noise
// cell instead of covering the texture's real distribution (Issue 2). Fixed
// by reading the whole target once instead of trying to choose a
// sub-sampling scheme that is provably independent of the shader's own
// periods — the full read is a one-off ~4MB transfer off the per-frame
// path, so there is no performance reason to sub-sample at all.

import { useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useSurfaceMaterials } from "./SurfaceMaterials";
import { getSurfaceTextureStats } from "./surfaceTextures";
import {
  getProceduralFurnitureStats,
  type ProceduralFurnitureStats,
} from "./proceduralFurnitureStats";
import {
  getFurnitureModelStats,
  type FurnitureModelStats,
} from "./furnitureModelStats";

// The floor/wall/column meshes tag themselves with these names
// (RefinedScene.tsx) so the probe can report *actual* scene-graph state
// (flags, materials, geometry) instead of source-code literals.
export const REFINED_FLOOR_NAME = "refined-floor";
export const REFINED_WALL_NAME = "refined-wall";
export const REFINED_COLUMN_NAME = "refined-column";

/**
 * 白模 box 的保底路徑。task 6 之後九種家具已經全部有造型(六種匯入模型、
 * 三種程序化),所以正常情況下場上不會有這種 mesh —— 它只在「有人往
 * FURNITURE_DEFAULTS 加了新 kind、卻還沒給它模型或程序化造型」時出現,
 * 讓那件家具至少畫得出來、也仍然被算進投影件數,而不是無聲消失。
 */
export const REFINED_FURNITURE_BOX_NAME = "refined-furniture-box";

/**
 * 用 `<Instances>` 畫出來的家具。名稱帶 kind 與 part 序號 ——
 * `refined-furniture-instance:cabinet:3`。
 *
 * 匯入模型(task 5)與程序化造型(task 6)**共用**這個命名,探針因此不需要
 * 分辨一件家具是哪一種來源 —— 兩邊的座標約定與 instancing 方式本來就一樣。
 *
 * 為什麼要把 kind 編進名字:一件家具可能由多個零件組成(cabinet 的 GLB 有 5
 * 個 mesh,櫃檯/講台/展示架各 3 個零件),每個零件各自是一個 `<Instances>`
 * → 一個 `InstancedMesh`。所以「castShadow 的 mesh 數」跟「投影的家具件數」
 * 已經不是同一回事,探針必須先照 kind 分組、每組只取一個代表讀它的 instance
 * 數,才能還原真正的家具件數。
 */
export const REFINED_FURNITURE_INSTANCE_PREFIX = "refined-furniture-instance:";

export function refinedFurnitureInstanceName(kind: string, partIndex: number): string {
  return `${REFINED_FURNITURE_INSTANCE_PREFIX}${kind}:${partIndex}`;
}

/** 從 `refined-furniture-instance:cabinet:3` 取回 `cabinet`。 */
function furnitureInstanceKindFromName(name: string): string | null {
  if (!name.startsWith(REFINED_FURNITURE_INSTANCE_PREFIX)) return null;
  const rest = name.slice(REFINED_FURNITURE_INSTANCE_PREFIX.length);
  const separator = rest.lastIndexOf(":");
  return separator > 0 ? rest.slice(0, separator) : null;
}

// Diagnostics are only collected for this many frames after mount / after a
// `resetKey` change. Long enough for the shadow pass, the environment cube
// render and gl.info.memory to settle (~2s at 60fps), short enough that the
// probe does not traverse the scene + JSON.stringify on every frame forever
// while the user orbits — 03 is judged on staying smooth with dozens of
// furniture items.
const PROBE_ACTIVE_FRAMES = 120;

// 量測用的 Box3 重複使用 —— 每幀新建是白白製造垃圾。
const MEASURE_BOX = new THREE.Box3();

/** mesh 的實際世界高度(公尺),四捨五入到 mm;無 mesh 或包圍盒無效時 null。 */
function measureHeightM(mesh: THREE.Object3D | null): number | null {
  if (!mesh) return null;
  const box = MEASURE_BOX.setFromObject(mesh);
  const height = box.max.y - box.min.y;
  return Number.isFinite(height) ? Math.round(height * 1000) / 1000 : null;
}

export interface RefinedDiagnostics {
  lightCount: number;
  shadowCastingLightCount: number;
  shadowCasterMeshCount: number;
  // AC2(地板受影但不投影,牆/柱/家具投影)按類別拆開的投影計數。
  //
  // 為什麼不繼續只看 `shadowCasterMeshCount`:task 5 匯入真實模型後,那個
  // 數字同時被兩件事扭曲 —— 一個 kind 的 N 件家具共用一個 `InstancedMesh`
  // (N 件只算 1),而一個多 mesh 的 GLB 又會拆成 partCount 個
  // `InstancedMesh`(1 件算 partCount)。cabinet 是 5 個 part,所以
  // 「2 件家具」在 mesh 數上會是 6。下面三個計數各自還原成**件數**,才是
  // AC2 真正要斷言的東西。
  shadowCasterWallCount: number;
  shadowCasterColumnCount: number;
  /**
   * 第一面牆 / 第一根柱子的**實際**世界高度(公尺),無則為 null。
   *
   * 為什麼不用 `data-wall-height-m` 就好:那個屬性是把 prop 印回 DOM,
   * 幾何就算被寫死成別的值也照樣正確。牆高改成可調之後(feedback round 2
   * T1),唯一能區分「幾何真的跟著變」與「只是設定值換了個數字」的讀數
   * 就是這裡量到的包圍盒 —— 破壞驗證時把 h 寫死成 3,靠的就是這兩個數字
   * 才抓得到。
   */
  wallMeshHeightM: number | null;
  columnMeshHeightM: number | null;
  shadowCasterFurnitureCount: number;
  floorReceivesShadow: boolean;
  floorCastsShadow: boolean;
  shadowsEnabled: boolean;
  shadowMapType: "Basic" | "PCF" | "PCFSoft" | "VSM" | "unknown";
  shadowMapSize: number | null;
  shadowMapAllocatedWidth: number | null;
  shadowCameraSpanM: number | null;
  shadowCameraNearM: number | null;
  shadowCameraFarM: number | null;
  toneMapping:
    | "None"
    | "Linear"
    | "Reinhard"
    | "Cineon"
    | "ACESFilmic"
    | "AgX"
    | "Neutral"
    | "unknown";
  toneMappingExposure: string;
  outputColorSpace: string;
  environmentSet: boolean;
  rendererTextures: number;
  rendererGeometries: number;
  // task 6 — 程序化家具的存活資源計數。刻意**不**併進 rendererTextures /
  // rendererGeometries:那兩個來自 gl.info.memory,而 gl.info 根本不統計
  // material,漏放 material 在那裡是看不見的。
  proceduralFurniture: ProceduralFurnitureStats;
  // task 7 — 匯入模型那條路的對應計數。同樣不併進 gl.info.memory 的數字:
  // 正規化後的 clone 在真正被畫出來之前不會上傳 GPU,gl.info 看不見它,
  // 而 StrictMode 丟棄的那一份正好就是這種看不見的洩漏。
  furnitureModels: FurnitureModelStats;
  materials: MaterialProbeReport;
}

// --- task 3: material diagnostics ---------------------------------------

interface TextureDiagnostics {
  present: boolean;
  width: number | null;
  wrapS: string | null;
  wrapT: string | null;
  minFilter: string | null;
  magFilter: string | null;
  anisotropy: number | null;
  // review-report.md Issue 1 — `anisotropy` above is the JS property, which
  // stays whatever we last *requested* even if three silently discarded it
  // (exactly what happened before the fix: assigned after
  // setupRenderTarget() had already run its one-time setTextureParameters()
  // pass, so the GPU never got TEXTURE_MAX_ANISOTROPY_EXT). This field reads
  // the renderer's own bookkeeping of what it actually pushed to GL —
  // `gl.properties.get(texture).__currentAnisotropy`
  // (WebGLTextures.js:696-706, the same technique already used for
  // `shadowMapAllocatedWidth`) — so T6 can assert reality, not intent.
  anisotropyGpu: number | null;
  colorSpace: string | null;
  generateMipmaps: boolean | null;
  channel: number | null;
  repeatX: number | null;
}

interface SurfaceTextureDiagnostics {
  map: TextureDiagnostics;
  normalMap: TextureDiagnostics;
  roughnessMap: TextureDiagnostics | null;
  aoMap: TextureDiagnostics | null;
  materialColorHex: string;
  normalScaleX: number;
}

interface AlbedoReadback {
  mean: number;
  max: number;
  variance: number;
  seamDelta: number;
  adjacentDelta: number;
}

interface NormalReadback {
  meanZ: number;
  varianceXY: number;
}

export interface MaterialProbeReport {
  ready: boolean;
  maxAnisotropy: number | null;
  floor: SurfaceTextureDiagnostics | null;
  wall: SurfaceTextureDiagnostics | null;
  column: SurfaceTextureDiagnostics | null;
  floorAlbedo: AlbedoReadback | null;
  floorNormal: NormalReadback | null;
  // review-report.md Issue 5 — the wall's D9 base-color override
  // (`#78350f` -> `#d6d3d1`, ~3.5x the linear brightness) previously had no
  // GPU-readback brightness check at all; T5 covered only the floor.
  wallAlbedo: AlbedoReadback | null;
  /** 柱子 albedo 的全域統計。柱子沒有獨立材質選項,跟隨牆面 —— 這個讀數
   *  是「跟隨」這件事唯一能被看見的地方(貼圖參數描述不會因為底色而變)。 */
  columnAlbedo: AlbedoReadback | null;
  floorUvMeterError: number | null;
  wallUvMeterError: number | null;
  liveSurfaceTargets: number | null;
  totalSurfaceBakes: number | null;
}

const NOT_READY_MATERIALS: MaterialProbeReport = {
  ready: false,
  maxAnisotropy: null,
  floor: null,
  wall: null,
  column: null,
  floorAlbedo: null,
  floorNormal: null,
  wallAlbedo: null,
  columnAlbedo: null,
  floorUvMeterError: null,
  wallUvMeterError: null,
  liveSurfaceTargets: null,
  totalSurfaceBakes: null,
};

const WRAP_LABELS: Record<number, string> = {
  [THREE.RepeatWrapping]: "RepeatWrapping",
  [THREE.ClampToEdgeWrapping]: "ClampToEdgeWrapping",
  [THREE.MirroredRepeatWrapping]: "MirroredRepeatWrapping",
};

const FILTER_LABELS: Record<number, string> = {
  [THREE.NearestFilter]: "NearestFilter",
  [THREE.LinearFilter]: "LinearFilter",
  [THREE.NearestMipmapNearestFilter]: "NearestMipmapNearestFilter",
  [THREE.NearestMipmapLinearFilter]: "NearestMipmapLinearFilter",
  [THREE.LinearMipmapNearestFilter]: "LinearMipmapNearestFilter",
  [THREE.LinearMipmapLinearFilter]: "LinearMipmapLinearFilter",
};

function describeTexture(
  gl: THREE.WebGLRenderer,
  texture: THREE.Texture | null | undefined,
): TextureDiagnostics {
  if (!texture) {
    return {
      present: false,
      width: null,
      wrapS: null,
      wrapT: null,
      minFilter: null,
      magFilter: null,
      anisotropy: null,
      anisotropyGpu: null,
      colorSpace: null,
      generateMipmaps: null,
      channel: null,
      repeatX: null,
    };
  }
  const image = texture.image as { width?: number } | undefined;
  // review-report.md Issue 1 — read three's own record of what it actually
  // pushed to GL (`__currentAnisotropy`, set only inside
  // `setTextureParameters()`'s anisotropy branch, WebGLTextures.js:696-706),
  // not just the JS property the app requested.
  const gpuProps = gl.properties.get(texture) as { __currentAnisotropy?: number } | undefined;
  return {
    present: true,
    width: image?.width ?? null,
    wrapS: WRAP_LABELS[texture.wrapS] ?? null,
    wrapT: WRAP_LABELS[texture.wrapT] ?? null,
    minFilter: FILTER_LABELS[texture.minFilter] ?? null,
    magFilter: FILTER_LABELS[texture.magFilter] ?? null,
    anisotropy: texture.anisotropy,
    anisotropyGpu: gpuProps?.__currentAnisotropy ?? null,
    colorSpace: texture.colorSpace,
    generateMipmaps: texture.generateMipmaps,
    channel: texture.channel,
    repeatX: texture.repeat.x,
  };
}

function describeSurfaceMaterial(
  gl: THREE.WebGLRenderer,
  material: THREE.MeshStandardMaterial,
  includeRoughnessAo: boolean,
): SurfaceTextureDiagnostics {
  return {
    map: describeTexture(gl, material.map),
    normalMap: describeTexture(gl, material.normalMap),
    roughnessMap: includeRoughnessAo ? describeTexture(gl, material.roughnessMap) : null,
    aoMap: includeRoughnessAo ? describeTexture(gl, material.aoMap) : null,
    materialColorHex: material.color.getHexString(),
    normalScaleX: material.normalScale.x,
  };
}

function readRegionLuminance(
  gl: THREE.WebGLRenderer,
  target: THREE.WebGLRenderTarget,
  x: number,
  y: number,
  width: number,
  height: number,
): number[] {
  const buffer = new Uint8Array(width * height * 4);
  gl.readRenderTargetPixels(target, x, y, width, height, buffer);
  const values: number[] = [];
  for (let i = 0; i < width * height; i++) {
    const r = buffer[i * 4] / 255;
    const g = buffer[i * 4 + 1] / 255;
    const b = buffer[i * 4 + 2] / 255;
    values.push((r + g + b) / 3);
  }
  return values;
}

function averageAbsDiff(a: number[], b: number[]): number {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

// T2/T4/T5 — reads the real GPU output of a baked albedo target in full:
// texture-wide mean/max/variance from EVERY texel (proves the shader
// produced non-flat, on-brightness output across the WHOLE bake, not a
// sub-sample that could be biased by the noise function's own periods —
// see the file-header PR-review note), plus the seam-vs-adjacent-row delta
// (already full-width reads — proves the noise tiles seamlessly, R4's
// mitigation). Used for both the floor (T2/T4/T5) and the wall
// (review-report.md Issue 5) albedo targets.
function readFullAlbedoStats(gl: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): AlbedoReadback {
  const size = target.width;
  const buffer = new Uint8Array(size * size * 4);
  gl.readRenderTargetPixels(target, 0, 0, size, size, buffer);

  const count = size * size;
  let sum = 0;
  let max = -Infinity;
  for (let i = 0; i < count; i++) {
    const r = buffer[i * 4] / 255;
    const g = buffer[i * 4 + 1] / 255;
    const b = buffer[i * 4 + 2] / 255;
    const v = (r + g + b) / 3;
    sum += v;
    if (v > max) max = v;
  }
  const valuesMean = sum / count;

  let varianceSum = 0;
  for (let i = 0; i < count; i++) {
    const r = buffer[i * 4] / 255;
    const g = buffer[i * 4 + 1] / 255;
    const b = buffer[i * 4 + 2] / 255;
    const v = (r + g + b) / 3;
    varianceSum += (v - valuesMean) * (v - valuesMean);
  }

  const rowFirst = readRegionLuminance(gl, target, 0, 0, size, 1);
  const rowLast = readRegionLuminance(gl, target, 0, size - 1, size, 1);
  const midRow = Math.floor(size / 2);
  const rowMidA = readRegionLuminance(gl, target, 0, midRow, size, 1);
  const rowMidB = readRegionLuminance(gl, target, 0, midRow + 1, size, 1);

  return {
    mean: valuesMean,
    max,
    variance: varianceSum / count,
    seamDelta: averageAbsDiff(rowFirst, rowLast),
    adjacentDelta: averageAbsDiff(rowMidA, rowMidB),
  };
}

// T2 — reads the floor normal target in full (see readFullAlbedoStats doc
// above): mean Z (should be close to 1 — the baked normal points mostly
// "up") and a magnitude proxy for the XY perturbation (should be > 0 —
// proves the shader actually derived a non-flat normal from
// surfaceHeight(), not the blank (0.5,0.5,1) normal), both computed over
// every texel.
function readFullNormalStats(gl: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): NormalReadback {
  const size = target.width;
  const buffer = new Uint8Array(size * size * 4);
  gl.readRenderTargetPixels(target, 0, 0, size, size, buffer);

  const count = size * size;
  let sumZ = 0;
  let sumXY = 0;
  for (let i = 0; i < count; i++) {
    const nx = (buffer[i * 4] / 255) * 2 - 1;
    const ny = (buffer[i * 4 + 1] / 255) * 2 - 1;
    const nz = (buffer[i * 4 + 2] / 255) * 2 - 1;
    sumZ += nz;
    sumXY += nx * nx + ny * ny;
  }
  return { meanZ: sumZ / count, varianceXY: sumXY / count };
}

// T3 — D2's UV assumption guard: the floor's `uv` attribute should equal
// its local (x, y) position exactly (ExtrudeGeometry's WorldUVGenerator).
// Returns the largest absolute bounding-box discrepancy between the two.
//
// Restricted to the CAP group (top + bottom faces, `materialIndex === 0` —
// three r185 ExtrudeGeometry.js's `buildLidFaces()` calls
// `addGroup(start, count, 0)`, `buildSideFaces()` calls
// `addGroup(start, count, 1)`). Only the caps use `generateTopUV()`
// (`(vertex.x, vertex.y)`, meters — D2's claim). The side-wall group uses
// `generateSideWallUV()`, whose `v` is `1 - extrudeDepth` (architect-plan.md
// event 查證表) — i.e. genuinely NOT meters, by design, for a different
// purpose (D2 doesn't claim anything about it). Mixing both groups into one
// bounding box (as an earlier version of this probe did) compares the
// side group's [0,1]-ish `v` against the position bbox's absolute meter
// coordinates (e.g. floor at x/y ~20-30), producing a spurious ~19 error
// that has nothing to do with whether `generateTopUV()` still behaves as
// D2 assumes. Non-indexed geometry (ExtrudeGeometry never calls
// `setIndex()`) means `group.start`/`group.count` address the
// position/uv attributes directly.
function computeFloorUvMeterError(mesh: THREE.Mesh): number | null {
  const position = mesh.geometry.getAttribute("position");
  const uv = mesh.geometry.getAttribute("uv");
  if (!position || !uv) return null;

  const capGroup = mesh.geometry.groups.find((group) => group.materialIndex === 0);
  if (!capGroup) return null;
  const start = capGroup.start;
  const end = Math.min(start + capGroup.count, position.count);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = start; i < end; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    const u = uv.getX(i);
    const v = uv.getY(i);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  return Math.max(
    Math.abs(minU - minX),
    Math.abs(maxU - maxX),
    Math.abs(minV - minY),
    Math.abs(maxV - maxY),
  );
}

// T3 — D3's applyMeterUv() guard: for each of BoxGeometry's 6 fixed
// face-groups, the actual uv span (max - min) should equal the face's real
// meter extent. Returns the largest relative deviation from 1 across all 6
// faces (so a narrow 0.2m side face stretched into a stripe would read as a
// huge error, not a tiny absolute one).
//
// review-report.md Issue 6: an earlier version compared the uv span against
// a literal `[d, h] / [w, d] / [w, h]` table copied from boxGeometry.ts's
// own face->span table, keyed by the same group index. That is not an
// independent guard — the real risk D3 names is a future three upgrade
// changing BoxGeometry's face/group emission order; if it did,
// `applyMeterUv()` (indexed by that same order) and this literal table
// would both be wrong in exactly the same way, so `wallUvMeterError` would
// still read ~0 while the geometry silently stretched. Fixed by deriving
// the "expected" span directly from the face's own `position` data instead
// of from `w`/`h`/`d` + a table: for each 4-vertex face group, the largest
// two of the three axis-aligned position spans ARE that face's real extent,
// whatever axis they happen to be on and whatever BoxGeometry's group order
// is. Comparing that (order-independent, geometry-derived) pair against the
// uv span pair now only depends on the actual vertex data — a group-order
// change that fed `applyMeterUv()` the wrong span would show up here as a
// real mismatch, not a coincidental match.
function computeWallUvMeterError(mesh: THREE.Mesh): number | null {
  const geometry = mesh.geometry as THREE.BoxGeometry;
  const uv = geometry.getAttribute("uv");
  const position = geometry.getAttribute("position");
  if (!uv || !position) return null;

  const faceCount = 6;
  let maxError = 0;
  for (let face = 0; face < faceCount; face++) {
    const base = face * 4;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let v = 0; v < 4; v++) {
      const i = base + v;
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    // A box face is planar: exactly one of the three axis spans is ~0 (the
    // face normal's axis). The other two ARE the face's real in-plane
    // extent, in whatever order they fall — sorted so comparison below
    // doesn't need to know which position axis maps to u vs v.
    const positionSpans = [maxX - minX, maxY - minY, maxZ - minZ]
      .filter((span) => span > 1e-6)
      .sort((a, b) => a - b);
    if (positionSpans.length !== 2) continue;

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (let v = 0; v < 4; v++) {
      const i = base + v;
      const u = uv.getX(i);
      const vv = uv.getY(i);
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, vv);
      maxV = Math.max(maxV, vv);
    }
    const uvSpans = [maxU - minU, maxV - minV].sort((a, b) => a - b);

    for (let k = 0; k < 2; k++) {
      const expected = positionSpans[k];
      const actual = uvSpans[k];
      const error = expected > 0 ? Math.abs(actual / expected - 1) : 0;
      maxError = Math.max(maxError, error);
    }
  }
  return maxError;
}

// --- task 2: lighting/shadow diagnostics (unchanged) --------------------

const TONE_MAPPING_LABELS: Record<number, RefinedDiagnostics["toneMapping"]> = {
  [THREE.NoToneMapping]: "None",
  [THREE.LinearToneMapping]: "Linear",
  [THREE.ReinhardToneMapping]: "Reinhard",
  [THREE.CineonToneMapping]: "Cineon",
  [THREE.ACESFilmicToneMapping]: "ACESFilmic",
  [THREE.AgXToneMapping]: "AgX",
  [THREE.NeutralToneMapping]: "Neutral",
};

const SHADOW_MAP_TYPE_LABELS: Record<number, RefinedDiagnostics["shadowMapType"]> = {
  [THREE.BasicShadowMap]: "Basic",
  [THREE.PCFShadowMap]: "PCF",
  [THREE.PCFSoftShadowMap]: "PCFSoft",
  [THREE.VSMShadowMap]: "VSM",
};

// `gl.shadowMap.type` is a *setting*, not proof of what the shadow pass
// actually rendered with — three r185's WebGLShadowMap.render() silently
// coerces the (now-deprecated) PCFSoftShadowMap to PCFShadowMap the first
// time it runs (three.module.js:9148-9153), so reading the setting alone
// can report a mechanism the renderer already abandoned. Once a light's
// shadow map has actually been allocated, its GPU resource shape is real,
// render-time evidence instead: VSM allocates its `shadow.map` render
// target itself with `{ format: RGFormat, type: HalfFloatType }`
// (three.module.js:9243-9247), whereas PCF/Basic leave `shadow.map`'s own
// texture at the WebGLRenderTarget default and instead attach a
// `depthTexture` with `compareFunction` set only for PCF
// (three.module.js:9301-9319). Preferring this over the raw setting is
// what makes this diagnostic tell the truth even if a future regression
// reintroduces a deprecated/coerced type.
function resolveShadowMapType(
  gl: THREE.WebGLRenderer,
  key: THREE.DirectionalLight | null,
): RefinedDiagnostics["shadowMapType"] {
  const map = key?.shadow.map ?? null;
  if (map) {
    if (map.texture.type === THREE.HalfFloatType && map.texture.format === THREE.RGFormat) {
      return "VSM";
    }
    if (map.depthTexture?.compareFunction != null) {
      return "PCF";
    }
    return "Basic";
  }
  // No shadow pass has allocated a map yet (only possible on the very
  // first probed frames) — fall back to the setting.
  return SHADOW_MAP_TYPE_LABELS[gl.shadowMap.type] ?? "unknown";
}

interface RefinedSceneProbeProps {
  /**
   * 值一變就把 frame 計數歸零、重新武裝探針。
   *
   * 除了幾何 revision,家具模型的載入狀態也編在裡面(RefinedScene 組出
   * 複合字串)—— GLB 走 `useGLTF` + Draco worker 解碼是非同步的,在慢機器
   * 上很可能超過 `PROBE_ACTIVE_FRAMES` 才 mount 完。少了這一項,探針早就
   * 停了,家具的 `InstancedMesh` 永遠不會被算進 `shadowCasterMeshCount`,
   * 對外的診斷會停在一份「還沒有家具」的過期快照。
   */
  resetKey: number | string;
  /**
   * 材質本身換了才會變的鍵(feedback round 2, T8 的材質選擇)。
   *
   * 與 `resetKey` 分開的理由:材質診斷是一次 GPU readback,刻意每次掛載
   * 只做一次、不進每幀路徑,所以場景編輯(resetKey 變動)不會重算它 ——
   * 烘焙與場景內容本來就是解耦的。但使用者換材質時,那份快取就過期了,
   * 不清掉的話回報的會是換之前那一份,看起來像「換材質沒生效」。
   */
  materialsKey: string;
  onReport: (diagnostics: RefinedDiagnostics) => void;
}

export default function RefinedSceneProbe({
  resetKey,
  materialsKey,
  onReport,
}: RefinedSceneProbeProps) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const { ready: materialsReady, textureSet } = useSurfaceMaterials();
  const frameRef = useRef(0);
  const lastReportRef = useRef<string | null>(null);
  // Cached once per mount — the material readback (T2/T4/T5) is real GPU
  // work and does not need to repeat every frame (architect-plan.md Test
  // Plan: "只在首次報告時做一次,不進每幀路徑").
  const materialsCacheRef = useRef<MaterialProbeReport | null>(null);

  // `resetKey` changes whenever RefinedScene's geometry props change
  // identity (a new revision) or a furniture model finishes loading — re-arm
  // the frame counter so the probe waits for a fresh shadow pass before
  // reporting again (see the prop's own doc comment). Deliberately
  // does NOT reset `materialsCacheRef` — the bake is decoupled from scene
  // content (D2/D3), so a scene edit must never re-trigger the readback.
  useLayoutEffect(() => {
    frameRef.current = 0;
  }, [resetKey]);

  // 材質換了:清掉 readback 快取並重新武裝,下一輪會量新的那一份。
  useLayoutEffect(() => {
    materialsCacheRef.current = null;
    frameRef.current = 0;
  }, [materialsKey]);

  useFrame(() => {
    frameRef.current += 1;
    // Wait until at least the second frame so the shadow pass (which runs
    // once autoUpdate/needsUpdate settle after mount/revision change) has
    // had a chance to allocate `shadow.map`.
    if (frameRef.current < 2) return;
    if (frameRef.current > PROBE_ACTIVE_FRAMES) return;

    let lightCount = 0;
    let shadowCastingLightCount = 0;
    let shadowCasterMeshCount = 0;
    let shadowCasterWallCount = 0;
    let shadowCasterColumnCount = 0;
    let shadowCasterFurnitureBoxCount = 0;
    // kind -> 該 kind 的 instance 數。用 Map 而非累加:同一個 kind 的每個
    // part 都是獨立的 InstancedMesh 但共用同一份 instance 清單,累加會把
    // 件數乘上 partCount。
    const furnitureInstances = new Map<string, number>();
    // Held on an object rather than in `let` bindings: TypeScript's control
    // flow analysis cannot see assignments made inside the traverse callback
    // and would otherwise narrow the locals to `null` (then to `never` at every
    // use site), forcing a cast on each read.
    const found: {
      key: THREE.DirectionalLight | null;
      floor: THREE.Mesh | null;
      wall: THREE.Mesh | null;
      column: THREE.Mesh | null;
    } = {
      key: null,
      floor: null,
      wall: null,
      column: null,
    };

    scene.traverse((object) => {
      if ((object as THREE.Light).isLight) {
        lightCount += 1;
        if (object.castShadow) {
          shadowCastingLightCount += 1;
          if (!found.key && (object as THREE.DirectionalLight).isDirectionalLight) {
            found.key = object as THREE.DirectionalLight;
          }
        }
      }
      if ((object as THREE.Mesh).isMesh) {
        if (object.castShadow) {
          shadowCasterMeshCount += 1;
          if (object.name === REFINED_WALL_NAME) shadowCasterWallCount += 1;
          if (object.name === REFINED_COLUMN_NAME) shadowCasterColumnCount += 1;
          if (object.name === REFINED_FURNITURE_BOX_NAME) {
            shadowCasterFurnitureBoxCount += 1;
          }
          const instancedKind = furnitureInstanceKindFromName(object.name);
          if (instancedKind) {
            // `InstancedMesh.count` is drei <Instances>'s own per-frame
            // bookkeeping (`min(limit, range, instances.length)`), so it is
            // the live instance count, not the buffer capacity. The probe's
            // useFrame subscribes before <Instances>'s (tree order), so on
            // the very first frame after mount this still reads 0 — harmless,
            // the next frame has it, and the probe stays armed for
            // PROBE_ACTIVE_FRAMES.
            furnitureInstances.set(
              instancedKind,
              (object as THREE.InstancedMesh).count,
            );
          }
        }
        if (!found.floor && object.name === REFINED_FLOOR_NAME) {
          found.floor = object as THREE.Mesh;
        }
        if (!found.wall && object.name === REFINED_WALL_NAME) {
          found.wall = object as THREE.Mesh;
        }
        if (!found.column && object.name === REFINED_COLUMN_NAME) {
          found.column = object as THREE.Mesh;
        }
      }
    });

    const key = found.key;
    const floor = found.floor;
    const shadowCamera = key ? key.shadow.camera : null;

    if (
      !materialsCacheRef.current &&
      materialsReady &&
      textureSet &&
      floor &&
      (floor.material as THREE.MeshStandardMaterial).map
    ) {
      const floorMaterial = floor.material as THREE.MeshStandardMaterial;
      const wallMaterial = found.wall?.material as THREE.MeshStandardMaterial | undefined;
      const columnMaterial = found.column?.material as THREE.MeshStandardMaterial | undefined;
      const stats = getSurfaceTextureStats();

      materialsCacheRef.current = {
        ready: true,
        maxAnisotropy: gl.capabilities.getMaxAnisotropy(),
        floor: describeSurfaceMaterial(gl, floorMaterial, true),
        wall: wallMaterial ? describeSurfaceMaterial(gl, wallMaterial, false) : null,
        column: columnMaterial ? describeSurfaceMaterial(gl, columnMaterial, false) : null,
        floorAlbedo: readFullAlbedoStats(gl, textureSet.floorAlbedoTarget),
        floorNormal: readFullNormalStats(gl, textureSet.floorNormalTarget),
        wallAlbedo: readFullAlbedoStats(gl, textureSet.wallAlbedoTarget),
        columnAlbedo: readFullAlbedoStats(gl, textureSet.columnAlbedoTarget),
        floorUvMeterError: computeFloorUvMeterError(floor),
        wallUvMeterError: found.wall ? computeWallUvMeterError(found.wall) : null,
        liveSurfaceTargets: stats.liveTargets,
        totalSurfaceBakes: stats.totalBakes,
      };
    }

    const diagnostics: RefinedDiagnostics = {
      lightCount,
      shadowCastingLightCount,
      shadowCasterMeshCount,
      shadowCasterWallCount,
      shadowCasterColumnCount,
      wallMeshHeightM: measureHeightM(found.wall),
      columnMeshHeightM: measureHeightM(found.column),
      shadowCasterFurnitureCount:
        shadowCasterFurnitureBoxCount +
        [...furnitureInstances.values()].reduce((sum, n) => sum + n, 0),
      floorReceivesShadow: floor ? floor.receiveShadow : false,
      floorCastsShadow: floor ? floor.castShadow : false,
      shadowsEnabled: gl.shadowMap.enabled,
      shadowMapType: resolveShadowMapType(gl, key),
      shadowMapSize: key ? key.shadow.mapSize.width : null,
      // `shadow.map` is a WebGLRenderTarget that only WebGLShadowMap.render()
      // ever allocates (three r185, WebGLShadowMap.js:227) — unlike
      // `mapSize.width`, which is a mere setting, a non-null width here proves
      // the shadow pass actually ran for this light.
      shadowMapAllocatedWidth: key ? (key.shadow.map?.width ?? null) : null,
      shadowCameraSpanM: shadowCamera
        ? Math.round(shadowCamera.right - shadowCamera.left)
        : null,
      shadowCameraNearM: shadowCamera ? Math.round(shadowCamera.near) : null,
      shadowCameraFarM: shadowCamera ? Math.round(shadowCamera.far) : null,
      toneMapping: TONE_MAPPING_LABELS[gl.toneMapping] ?? "unknown",
      toneMappingExposure: gl.toneMappingExposure.toFixed(2),
      outputColorSpace: gl.outputColorSpace,
      environmentSet: scene.environment !== null,
      rendererTextures: gl.info.memory.textures,
      rendererGeometries: gl.info.memory.geometries,
      proceduralFurniture: getProceduralFurnitureStats(),
      furnitureModels: getFurnitureModelStats(),
      materials: materialsCacheRef.current ?? NOT_READY_MATERIALS,
    };

    const serialized = JSON.stringify(diagnostics);
    if (serialized !== lastReportRef.current) {
      lastReportRef.current = serialized;
      onReport(diagnostics);
    }
  });

  return null;
}
