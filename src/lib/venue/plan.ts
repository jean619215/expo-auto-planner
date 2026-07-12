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

export function insertVertexOnEdge(
  polygon: FloorPolygon,
  edgeIndex: number,
  rawPoint: PlanPoint,
): FloorPolygon {
  const a = polygon[edgeIndex];
  const b = polygon[(edgeIndex + 1) % polygon.length];
  const projected = closestPointOnSegment(a, b, rawPoint);
  const snapped = snapPoint(projected);

  const isSamePoint = (x: PlanPoint, y: PlanPoint) =>
    x.x === y.x && x.y === y.y;

  if (isSamePoint(snapped, a) || isSamePoint(snapped, b)) {
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
