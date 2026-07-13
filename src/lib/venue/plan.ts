// Pure geometry/domain module for the venue floor-plan editor.
// No React, no Konva, no DOM — all state here is expressed in meters and
// is directly reusable by the future 3D whitebox scene builder.

export interface PlanPoint {
  x: number;
  y: number;
}

export type FloorPolygon = PlanPoint[];

export const VENUE_SIZE_M = 50;
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

export function snapToGrid(v: number): number {
  const safe = safeNumber(v);
  return Math.round(safe / SNAP_M) * SNAP_M;
}

export function clampToBounds(v: number): number {
  const safe = safeNumber(v);
  return Math.min(VENUE_SIZE_M, Math.max(0, safe));
}

export function snapPoint(p: PlanPoint): PlanPoint {
  return {
    x: clampToBounds(snapToGrid(p.x)),
    y: clampToBounds(snapToGrid(p.y)),
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
): FloorPolygon {
  const a = polygon[edgeIndex];
  const b = polygon[(edgeIndex + 1) % polygon.length];
  const projected = closestPointOnSegment(a, b, rawPoint);
  const snapped = snapPoint(projected);

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
): FloorPolygon {
  const snapped = snapPoint(rawPoint);
  return polygon.map((vertex, i) => (i === index ? snapped : vertex));
}

export function computePxPerMeter(stagePx: number): number {
  return stagePx / VENUE_SIZE_M;
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
export const COLUMN_SIZE_M = 0.5;

export interface WallSegment {
  id: string;
  start: PlanPoint; // meters
  end: PlanPoint; // meters
}

export interface Column {
  id: string;
  center: PlanPoint; // meters; fixed COLUMN_SIZE_M square this task
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
): WallSegment | null {
  const start = snapPoint(rawStart);
  const end = snapPoint(rawEnd);
  if (samePoint(start, end)) {
    return null;
  }
  return { id: createObjectId(), start, end };
}

// Clamps an already-grid-aligned-or-boundary center into
// [COLUMN_SIZE_M/2, VENUE_SIZE_M - COLUMN_SIZE_M/2] on each axis. Deliberately
// does NOT re-snap to the 0.5m grid: the boundary values themselves
// (0.25 / 49.75) are half-grid offsets, so re-snapping an already-clamped
// center (as would happen on repeated translateColumn calls during a
// multi-step drag) would corrupt it back onto the grid (e.g. 0.25 -> 0.5).
// Callers that need to snap first (e.g. createColumn) do so explicitly
// before calling this.
export function clampColumnCenter(p: PlanPoint): PlanPoint {
  const half = COLUMN_SIZE_M / 2;
  const safe = { x: safeNumber(p.x), y: safeNumber(p.y) };
  return {
    x: Math.min(VENUE_SIZE_M - half, Math.max(half, safe.x)),
    y: Math.min(VENUE_SIZE_M - half, Math.max(half, safe.y)),
  };
}

export function createColumn(rawCenter: PlanPoint): Column {
  return { id: createObjectId(), center: clampColumnCenter(snapPoint(rawCenter)) };
}

export function translateWall(
  wall: WallSegment,
  deltaRaw: PlanPoint,
): WallSegment {
  const deltaX = snapToGrid(deltaRaw.x);
  const deltaY = snapToGrid(deltaRaw.y);

  const minX = Math.min(wall.start.x, wall.end.x);
  const maxX = Math.max(wall.start.x, wall.end.x);
  const minY = Math.min(wall.start.y, wall.end.y);
  const maxY = Math.max(wall.start.y, wall.end.y);

  const clampedDeltaX = Math.min(
    VENUE_SIZE_M - maxX,
    Math.max(-minX, deltaX),
  );
  const clampedDeltaY = Math.min(
    VENUE_SIZE_M - maxY,
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

export function translateColumn(col: Column, deltaRaw: PlanPoint): Column {
  const deltaX = snapToGrid(deltaRaw.x);
  const deltaY = snapToGrid(deltaRaw.y);
  const moved = {
    x: col.center.x + deltaX,
    y: col.center.y + deltaY,
  };
  return { id: col.id, center: clampColumnCenter(moved) };
}

export function moveWallEndpoint(
  wall: WallSegment,
  which: "start" | "end",
  rawPoint: PlanPoint,
): WallSegment {
  const snapped = snapPoint(rawPoint);
  const newStart = which === "start" ? snapped : wall.start;
  const newEnd = which === "end" ? snapped : wall.end;
  if (samePoint(newStart, newEnd)) {
    return wall;
  }
  return { id: wall.id, start: newStart, end: newEnd };
}
