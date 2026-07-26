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

export const DEFAULT_FLOOR: FloorPolygon = [
  { x: 20, y: 20 },
  { x: 30, y: 20 },
  { x: 30, y: 30 },
  { x: 20, y: 30 },
];

function safeNumber(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

// Centered square floor sized proportionally to the venue (inset to the
// [0.4s, 0.6s] band, matching DEFAULT_FLOOR's 20-30 band at s=50), snapped
// to the 0.5m grid.
export function createDefaultFloor(sizeM: number = VENUE_SIZE_M): FloorPolygon {
  const inset = Math.round(sizeM * 0.4 * 2) / 2;
  const outset = Math.round(sizeM * 0.6 * 2) / 2;
  return [
    { x: inset, y: inset },
    { x: outset, y: inset },
    { x: outset, y: outset },
    { x: inset, y: outset },
  ];
}

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

export function formatMeters(v: number): string {
  return `${v.toFixed(1)} m`;
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
  });
}

// 未存讀過(savedBaseline === null)時的 dirty 判定基準:初始空場地快照。
export const EMPTY_PLAN_BASELINE = serializePlanSnapshot({
  polygon: createDefaultFloor(VENUE_SIZE_M),
  walls: [],
  columns: [],
  furniture: [],
  venueSizeM: PLAN_AREA_SIZE_M,
});
