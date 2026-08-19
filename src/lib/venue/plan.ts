// Pure geometry/domain module for the venue floor-plan editor.
// No React, no Konva, no DOM — all state here is expressed in meters and
// is directly reusable by the future 3D whitebox scene builder.

// Type-only import from ./furniture (which itself imports from this module)
// — safe under isolatedModules: `import type` is fully erased at compile
// time, so there is no runtime circular dependency, only a type-level one
// TS resolves structurally. Kept here (rather than duplicating the shape,
// or relocating PlanSnapshot to a components-level file) per
// architect-plan.md D3: single source of truth for FurnitureItem.
import type { FurnitureItem } from "./furniture";
import {
  DEFAULT_SURFACE_SELECTION,
  type SurfaceSelection,
} from "./surfacePresets";

export interface PlanPoint {
  x: number;
  y: number;
}

export type FloorPolygon = PlanPoint[];

// 預設地板生成尺寸與預設視圖 fit 尺寸(非可規劃範圍上限 — 見 PLAN_AREA_SIZE_M)。
export const VENUE_SIZE_M = 50;
// 可規劃範圍上限(公尺),前端 clamp 唯一來源。
export const PLAN_AREA_SIZE_M = 200;
export const SNAP_M = 0.5;
export const MIN_FLOOR_VERTICES = 3;
export const GRID_MINOR_M = 1;
export const GRID_MAJOR_M = 5;

// 常見展位尺寸(公尺)。回饋:「展場絕大多數的都是 3*3 / 3*6 / 3*9 / 6*6」。
export const BOOTH_PRESETS: { w: number; h: number }[] = [
  { w: 3, h: 3 },
  { w: 3, h: 6 },
  { w: 3, h: 9 },
  { w: 6, h: 6 },
];

/** 預設攤位尺寸 —— 四種 preset 裡最常見的單位攤位。 */
export const DEFAULT_BOOTH = BOOTH_PRESETS[0];

/** 攤位左上角在平面座標系中的錨點。換尺寸時固定不動,場地往右下長。 */
export const BOOTH_ORIGIN: PlanPoint = { x: 20, y: 20 };

/** 以 origin 為左上角的矩形地板。 */
export function createBoothFloor(
  widthM: number,
  heightM: number,
  origin: PlanPoint = BOOTH_ORIGIN,
): FloorPolygon {
  return [
    { x: origin.x, y: origin.y },
    { x: origin.x + widthM, y: origin.y },
    { x: origin.x + widthM, y: origin.y + heightM },
    { x: origin.x, y: origin.y + heightM },
  ];
}

export const DEFAULT_FLOOR: FloorPolygon = createBoothFloor(
  DEFAULT_BOOTH.w,
  DEFAULT_BOOTH.h,
);

function safeNumber(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

// Centered square floor sized proportionally to the venue (inset to the
// [0.4s, 0.6s] band, matching DEFAULT_FLOOR's 20-30 band at s=50), snapped
// to the 0.5m grid.
// createDefaultFloor(以場地尺寸的 40%~60% 取一個置中方形)在展位 preset
// 之後沒有呼叫端了 —— 預設地板改由 createBoothFloor 產生,錨在
// BOOTH_ORIGIN 而不是隨場地尺寸浮動。

export function snapToGrid(v: number): number {
  const safe = safeNumber(v);
  return Math.round(safe / SNAP_M) * SNAP_M;
}

export function clampToBounds(v: number, sizeM: number = VENUE_SIZE_M): number {
  const safe = safeNumber(v);
  return Math.min(sizeM, Math.max(0, safe));
}

export function snapPoint(p: PlanPoint, sizeM: number = VENUE_SIZE_M): PlanPoint {
  return {
    x: clampToBounds(snapToGrid(p.x), sizeM),
    y: clampToBounds(snapToGrid(p.y), sizeM),
  };
}

export function closestPointOnSegment(
  a: PlanPoint,
  b: PlanPoint,
  p: PlanPoint,
): PlanPoint {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSquared = abx * abx + aby * aby;

  if (lengthSquared === 0) {
    return { x: a.x, y: a.y };
  }

  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const t = Math.min(1, Math.max(0, (apx * abx + apy * aby) / lengthSquared));

  return {
    x: a.x + abx * t,
    y: a.y + aby * t,
  };
}

export function findClosestEdge(
  polygon: FloorPolygon,
  p: PlanPoint,
): { edgeIndex: number; point: PlanPoint; distance: number } {
  let bestEdgeIndex = 0;
  let bestPoint: PlanPoint = polygon[0];
  let bestDistance = Infinity;

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const candidate = closestPointOnSegment(a, b, p);
    const dx = candidate.x - p.x;
    const dy = candidate.y - p.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestEdgeIndex = i;
      bestPoint = candidate;
    }
  }

  return { edgeIndex: bestEdgeIndex, point: bestPoint, distance: bestDistance };
}

export function samePoint(a: PlanPoint, b: PlanPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

export function insertVertexOnEdge(
  polygon: FloorPolygon,
  edgeIndex: number,
  rawPoint: PlanPoint,
  sizeM: number = VENUE_SIZE_M,
): FloorPolygon {
  const a = polygon[edgeIndex];
  const b = polygon[(edgeIndex + 1) % polygon.length];
  const projected = closestPointOnSegment(a, b, rawPoint);
  const snapped = snapPoint(projected, sizeM);

  if (samePoint(snapped, a) || samePoint(snapped, b)) {
    return polygon;
  }

  const next = [...polygon];
  next.splice(edgeIndex + 1, 0, snapped);
  return next;
}

export function removeVertex(
  polygon: FloorPolygon,
  index: number,
): FloorPolygon {
  if (polygon.length <= MIN_FLOOR_VERTICES) {
    return polygon;
  }
  return polygon.filter((_, i) => i !== index);
}

export function moveVertex(
  polygon: FloorPolygon,
  index: number,
  rawPoint: PlanPoint,
  sizeM: number = VENUE_SIZE_M,
): FloorPolygon {
  const snapped = snapPoint(rawPoint, sizeM);
  return polygon.map((vertex, i) => (i === index ? snapped : vertex));
}

export function computePxPerMeter(stagePx: number, sizeM: number = VENUE_SIZE_M): number {
  return stagePx / sizeM;
}

export function metersToPx(p: PlanPoint, pxPerMeter: number): PlanPoint {
  return { x: p.x * pxPerMeter, y: p.y * pxPerMeter };
}

export function pxToMeters(
  p: { x: number; y: number },
  pxPerMeter: number,
): PlanPoint {
  return { x: p.x / pxPerMeter, y: p.y / pxPerMeter };
}

// --- Wall / column object system (Task 2) ---------------------------------

export const WALL_THICKNESS_M = 0.2;

// --- 牆高(全域一個值,非 per-wall)----------------------------------------
//
// 牆與柱共用同一個高度 —— 展場實務上整場牆體是統一高度,所以 `WallSegment`
// 刻意不加 height 欄位(那會連帶動到存檔格式與 AI 的 add_wall schema)。
// 使用者回饋:「牆壁通常 4-6 米高」;4-6 是常態不是上限,硬夾在 4-6 會讓
// 挑高場地做不了,所以範圍開到 2-10、預設落在常態的下緣 4。
export const DEFAULT_WALL_HEIGHT_M = 4;
export const MIN_WALL_HEIGHT_M = 2;
export const MAX_WALL_HEIGHT_M = 10;

/** 把任意輸入(含 NaN / 非數字)夾成合法牆高。非有限數一律回預設值。 */
export function clampWallHeight(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_WALL_HEIGHT_M;
  return Math.min(MAX_WALL_HEIGHT_M, Math.max(MIN_WALL_HEIGHT_M, raw));
}
// Default size at creation time only — per-instance `w`/`h` may differ after resize.
export const COLUMN_SIZE_M = 0.5;

export interface WallSegment {
  id: string;
  start: PlanPoint; // meters
  end: PlanPoint; // meters
}

export interface Column {
  id: string;
  center: PlanPoint; // meters
  w: number; // meters; default COLUMN_SIZE_M at creation, resizable per-instance
  h: number; // meters; default COLUMN_SIZE_M at creation, resizable per-instance
}

let objectIdCounter = 0;

export function createObjectId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  objectIdCounter += 1;
  return `obj-${objectIdCounter}`;
}

export function createWall(
  rawStart: PlanPoint,
  rawEnd: PlanPoint,
  sizeM: number = VENUE_SIZE_M,
): WallSegment | null {
  const start = snapPoint(rawStart, sizeM);
  const end = snapPoint(rawEnd, sizeM);
  if (samePoint(start, end)) {
    return null;
  }
  return { id: createObjectId(), start, end };
}

// Clamps an already-grid-aligned-or-boundary center into
// [w/2, VENUE_SIZE_M - w/2] x [h/2, VENUE_SIZE_M - h/2] per-axis. Deliberately
// does NOT re-snap to the 0.5m grid: the boundary values themselves
// (e.g. 0.25 / 49.75 for the default 0.5m size) are half-grid offsets, so
// re-snapping an already-clamped center (as would happen on repeated
// translateColumn calls during a multi-step drag) would corrupt it back onto
// the grid (e.g. 0.25 -> 0.5). Callers that need to snap first (e.g.
// createColumn) do so explicitly before calling this.
export function clampColumnCenter(
  p: PlanPoint,
  w: number,
  h: number,
  sizeM: number = VENUE_SIZE_M,
): PlanPoint {
  const halfW = w / 2;
  const halfH = h / 2;
  const safe = { x: safeNumber(p.x), y: safeNumber(p.y) };
  return {
    x: Math.min(sizeM - halfW, Math.max(halfW, safe.x)),
    y: Math.min(sizeM - halfH, Math.max(halfH, safe.y)),
  };
}

export function createColumn(rawCenter: PlanPoint, sizeM: number = VENUE_SIZE_M): Column {
  return {
    id: createObjectId(),
    center: clampColumnCenter(
      snapPoint(rawCenter, sizeM),
      COLUMN_SIZE_M,
      COLUMN_SIZE_M,
      sizeM,
    ),
    w: COLUMN_SIZE_M,
    h: COLUMN_SIZE_M,
  };
}

export function translateWall(
  wall: WallSegment,
  deltaRaw: PlanPoint,
  sizeM: number = VENUE_SIZE_M,
): WallSegment {
  const deltaX = snapToGrid(deltaRaw.x);
  const deltaY = snapToGrid(deltaRaw.y);

  const minX = Math.min(wall.start.x, wall.end.x);
  const maxX = Math.max(wall.start.x, wall.end.x);
  const minY = Math.min(wall.start.y, wall.end.y);
  const maxY = Math.max(wall.start.y, wall.end.y);

  const clampedDeltaX = Math.min(
    sizeM - maxX,
    Math.max(-minX, deltaX),
  );
  const clampedDeltaY = Math.min(
    sizeM - maxY,
    Math.max(-minY, deltaY),
  );

  return {
    id: wall.id,
    start: {
      x: wall.start.x + clampedDeltaX,
      y: wall.start.y + clampedDeltaY,
    },
    end: {
      x: wall.end.x + clampedDeltaX,
      y: wall.end.y + clampedDeltaY,
    },
  };
}

export function translateColumn(
  col: Column,
  deltaRaw: PlanPoint,
  sizeM: number = VENUE_SIZE_M,
): Column {
  const deltaX = snapToGrid(deltaRaw.x);
  const deltaY = snapToGrid(deltaRaw.y);
  const moved = {
    x: col.center.x + deltaX,
    y: col.center.y + deltaY,
  };
  return {
    id: col.id,
    center: clampColumnCenter(moved, col.w, col.h, sizeM),
    w: col.w,
    h: col.h,
  };
}

// Resizes a column by dragging one bounding-box corner while the opposite
// (anchor) corner stays mathematically fixed. `corner` is a sign-pair
// identifying which corner is being dragged relative to the center
// (x: -1 = left, +1 = right; y: -1 = top, +1 = bottom), chosen over a
// "nw"|"ne"|"sw"|"se" string union so the math below is one generic formula
// instead of a 4-way switch.
//
// Order matters: the minimum-size clamp (0.5m per axis) is applied BEFORE
// the venue-boundary clamp. Applying them in the other order (or merging
// them) risks the anchor corner silently drifting away from its fixed
// position when both constraints are active near a corner of the venue.
export function resizeColumnCorner(
  column: Column,
  corner: { x: -1 | 1; y: -1 | 1 },
  rawPoint: PlanPoint,
  sizeM: number = VENUE_SIZE_M,
): Column {
  const left = column.center.x - column.w / 2;
  const right = column.center.x + column.w / 2;
  const top = column.center.y - column.h / 2;
  const bottom = column.center.y + column.h / 2;

  const anchor = {
    x: corner.x === -1 ? right : left,
    y: corner.y === -1 ? bottom : top,
  };

  const snapped = snapPoint(rawPoint, sizeM);

  // 1) Minimum-size clamp: floor the new width/height at SNAP_M.
  //
  // Use the SIGNED directional distance along each axis (corner.x/y applied
  // as a sign, not Math.abs) so that a drag which overshoots past the
  // opposite (anchor) corner is treated as a negative extent on that axis
  // rather than an unsigned distance. Math.abs would let the dragged corner
  // silently flip to the far side of the anchor while the sign used to
  // re-project the center below stays keyed to the original corner — moving
  // the box away from the cursor instead of tracking it. Clamping the signed
  // distance at SNAP_M keeps the corner identity stable: an overshoot simply
  // saturates at the minimum size on that side.
  let newWidth = Math.max(SNAP_M, corner.x * (snapped.x - anchor.x));
  let newHeight = Math.max(SNAP_M, corner.y * (snapped.y - anchor.y));

  // 2) Boundary clamp: cap growth so the anchor-relative extent stays within
  // [0, sizeM], without moving the anchor.
  if (corner.x === 1 && anchor.x + newWidth > sizeM) {
    newWidth = sizeM - anchor.x;
  } else if (corner.x === -1 && anchor.x - newWidth < 0) {
    newWidth = anchor.x;
  }
  if (corner.y === 1 && anchor.y + newHeight > sizeM) {
    newHeight = sizeM - anchor.y;
  } else if (corner.y === -1 && anchor.y - newHeight < 0) {
    newHeight = anchor.y;
  }

  const newCenter = {
    x: anchor.x + (corner.x * newWidth) / 2,
    y: anchor.y + (corner.y * newHeight) / 2,
  };

  return { id: column.id, center: newCenter, w: newWidth, h: newHeight };
}

/**
 * 尺寸標註字串。依台灣建築圖慣例以**公分**標註,取整數公分。
 *
 * 運算單位仍然是公尺 —— 這裡只做顯示層換算。取整是刻意的:平面圖上不需要
 * 公釐級精度,而 `7.071 m` 這種對角線長度顯示成 `707cm` 比 `707.1cm` 乾淨。
 */
export function formatCentimeters(meters: number): string {
  return `${Math.round(meters * 100)}cm`;
}

// --- 場地邊界與柱子到邊界的距離(feedback round 2, R2)--------------------
//
// 「場地四邊」定義為地板多邊形的**外接矩形**。地板可以是任意多邊形,而
// 回饋參考圖那種「距左/距右/距上/距下」的標註方式只在矩形上有意義 ——
// 對凹多邊形去問「距離左邊多遠」沒有單一答案。

export interface FloorBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  widthM: number;
  heightM: number;
}

/** 地板多邊形的外接矩形。空多邊形回全 0(呼叫端不必再防 Infinity)。 */
export function floorBoundsM(polygon: FloorPolygon): FloorBounds {
  if (polygon.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, widthM: 0, heightM: 0 };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const vertex of polygon) {
    minX = Math.min(minX, vertex.x);
    maxX = Math.max(maxX, vertex.x);
    minY = Math.min(minY, vertex.y);
    maxY = Math.max(maxY, vertex.y);
  }
  return { minX, maxX, minY, maxY, widthM: maxX - minX, heightM: maxY - minY };
}

export interface BoundaryOffsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * 柱子四邊到場地邊界的距離(公尺)。
 *
 * 量的是**邊到邊**:柱子左緣到左邊界,不是中心到左邊界。這個定義的驗證
 * 方式很直接 —— `left + w + right` 必然等於場地總寬(參考圖上的
 * 1525 + 150 + 525 = 2200)。中心距的話會多算一個柱寬。
 *
 * 柱子可能被擺到地板外(柱子夾制的是 venueSizeM 而非地板多邊形),此時
 * 對應方向會是負值 —— 不特別處理,負號本身就是「跑出去了」的正確資訊。
 */
export function columnBoundaryOffsetsM(
  column: Column,
  bounds: FloorBounds,
): BoundaryOffsets {
  return {
    left: column.center.x - column.w / 2 - bounds.minX,
    right: bounds.maxX - (column.center.x + column.w / 2),
    top: column.center.y - column.h / 2 - bounds.minY,
    bottom: bounds.maxY - (column.center.y + column.h / 2),
  };
}

export type BoundarySide = "left" | "right" | "top" | "bottom";

/**
 * 把「柱子某一邊離場地邊界 offsetM 公尺」換算成柱子新的中心點。
 *
 * **刻意不吸附**(不經過 snapToGrid):拖曳有 SNAP_M 吸附是為了快,輸入
 * 框存在的理由正好相反 —— 使用者打 137cm 就是要停在 137cm。兩種行為並存
 * 是決策,不是疏漏;UI 需要明講「再拖曳一次會回到吸附格線」。
 *
 * 值會夾在 [0, 場地邊長 − 柱子邊長],所以柱子不會被輸入推出場地。
 */
export function columnCenterForOffsetM(
  column: Column,
  bounds: FloorBounds,
  side: BoundarySide,
  offsetM: number,
): PlanPoint {
  const spanX = Math.max(0, bounds.widthM - column.w);
  const spanY = Math.max(0, bounds.heightM - column.h);
  const clamp = (v: number, span: number) => Math.min(span, Math.max(0, v));

  switch (side) {
    case "left":
      return {
        x: bounds.minX + clamp(offsetM, spanX) + column.w / 2,
        y: column.center.y,
      };
    case "right":
      return {
        x: bounds.maxX - clamp(offsetM, spanX) - column.w / 2,
        y: column.center.y,
      };
    case "top":
      return {
        x: column.center.x,
        y: bounds.minY + clamp(offsetM, spanY) + column.h / 2,
      };
    case "bottom":
      return {
        x: column.center.x,
        y: bounds.maxY - clamp(offsetM, spanY) - column.h / 2,
      };
  }
}

// --- 換展位尺寸時的越界處理(feedback round 2, R1)-----------------------
//
// 柱子與家具夾制的基準是 venueSizeM(200),不是地板多邊形 —— 它們本來就
// 可以擺在地板外。換到較小的展位時,這些東西會落在新場地之外,所以換尺寸
// 前要先數出有幾件、讓使用者知道代價,確認後才把它們夾回來。

/** 中心點 + 寬高的矩形物件(柱子與家具共用這個形狀)。 */
interface RectObject {
  center: PlanPoint;
  w: number;
  h: number;
}

/** 物件的軸對齊外框是否有任何部分超出邊界。 */
export function isRectOutsideBounds(
  rect: RectObject,
  bounds: FloorBounds,
): boolean {
  return (
    rect.center.x - rect.w / 2 < bounds.minX ||
    rect.center.x + rect.w / 2 > bounds.maxX ||
    rect.center.y - rect.h / 2 < bounds.minY ||
    rect.center.y + rect.h / 2 > bounds.maxY
  );
}

/**
 * 把物件中心夾進邊界內。物件比場地還大時,退回置中 —— 夾制無解,置中至少
 * 是可預期的結果。
 */
export function clampRectCenterToBounds(
  rect: RectObject,
  bounds: FloorBounds,
): PlanPoint {
  const clampAxis = (
    value: number,
    half: number,
    min: number,
    max: number,
  ): number => {
    if (max - min < half * 2) return (min + max) / 2;
    return Math.min(max - half, Math.max(min + half, value));
  };
  return {
    x: clampAxis(rect.center.x, rect.w / 2, bounds.minX, bounds.maxX),
    y: clampAxis(rect.center.y, rect.h / 2, bounds.minY, bounds.maxY),
  };
}

/** 牆的任一端點是否落在邊界外。 */
export function isWallOutsideBounds(
  wall: WallSegment,
  bounds: FloorBounds,
): boolean {
  const outside = (p: PlanPoint) =>
    p.x < bounds.minX || p.x > bounds.maxX || p.y < bounds.minY || p.y > bounds.maxY;
  return outside(wall.start) || outside(wall.end);
}

/** 把牆的端點夾進邊界內。 */
export function clampWallToBounds(
  wall: WallSegment,
  bounds: FloorBounds,
): WallSegment {
  const clampPoint = (p: PlanPoint): PlanPoint => ({
    x: Math.min(bounds.maxX, Math.max(bounds.minX, p.x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, p.y)),
  });
  return { id: wall.id, start: clampPoint(wall.start), end: clampPoint(wall.end) };
}

export function wallLengthM(wall: WallSegment): number {
  return Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
}

export function moveWallEndpoint(
  wall: WallSegment,
  which: "start" | "end",
  rawPoint: PlanPoint,
  sizeM: number = VENUE_SIZE_M,
): WallSegment {
  const snapped = snapPoint(rawPoint, sizeM);
  const newStart = which === "start" ? snapped : wall.start;
  const newEnd = which === "end" ? snapped : wall.end;
  if (samePoint(newStart, newEnd)) {
    return wall;
  }
  return { id: wall.id, start: newStart, end: newEnd };
}

// --- 存檔快照(Task 3:存檔 UI) --------------------------------------------

export interface PlanSnapshot {
  polygon: FloorPolygon;
  walls: WallSegment[];
  columns: Column[];
  furniture: FurnitureItem[];
  venueSizeM: number;
  wallHeightM: number;
  surfaces: SurfaceSelection;
}

// 固定欄位順序 stringify — 快照物件永遠以下面的字面量順序組裝,不會出現
// JSON key 順序不穩定的風險(見 architect-plan.md Architecture Notes)。
export function serializePlanSnapshot(snapshot: PlanSnapshot): string {
  return JSON.stringify({
    polygon: snapshot.polygon,
    walls: snapshot.walls,
    columns: snapshot.columns,
    furniture: snapshot.furniture,
    venueSizeM: snapshot.venueSizeM,
    wallHeightM: snapshot.wallHeightM,
    surfaces: snapshot.surfaces,
  });
}

// 未存讀過(savedBaseline === null)時的 dirty 判定基準:初始空場地快照。
// 未存讀過時的 dirty 判定基準,必須與編輯器的初始 state 逐欄位相同 ——
// 對不上的話一開畫面就被判定為已修改,讀檔會無故彈出「捨棄變更?」。
export const EMPTY_PLAN_BASELINE = serializePlanSnapshot({
  polygon: DEFAULT_FLOOR,
  walls: [],
  columns: [],
  furniture: [],
  venueSizeM: PLAN_AREA_SIZE_M,
  wallHeightM: DEFAULT_WALL_HEIGHT_M,
  surfaces: DEFAULT_SURFACE_SELECTION,
});
