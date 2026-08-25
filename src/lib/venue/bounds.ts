// Pure geometry module: computes the axis-aligned bounding box (and
// circumscribing-radius) of everything actually placed on a floor plan —
// polygon, walls, columns, furniture. No React / DOM / Three import, per
// AGENTS.md layering ("src/lib/venue/ 維持零 React / DOM / Konva / Three
// import"). Consumed by RefinedScene (architect-plan.md D2) to size the
// step-03 shadow camera frustum to the actual scene content rather than the
// editable plan area's upper bound.

import { WALL_THICKNESS_M, type Column, type FloorPolygon, type WallSegment } from "./plan";
import type { FurnitureItem } from "./furniture";

// Floor radius below which the shadow camera frustum would degenerate to a
// zero (or near-zero) span — guards against NaN/zero-size projection
// matrices for a single-point or empty content set.
export const MIN_SHADOW_RADIUS_M = 2;

export interface PlanBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
  radiusM: number;
}

interface Accumulator {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function expand(acc: Accumulator, x: number, y: number, halfExtent: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(halfExtent)) {
    return;
  }
  acc.minX = Math.min(acc.minX, x - halfExtent);
  acc.maxX = Math.max(acc.maxX, x + halfExtent);
  acc.minY = Math.min(acc.minY, y - halfExtent);
  acc.maxY = Math.max(acc.maxY, y + halfExtent);
}

// Computes the AABB (in meters, plan XY space) of the floor polygon plus
// every wall/column/furniture item, and the radius of the circle
// circumscribing that AABB (half the AABB diagonal — covers the AABB
// regardless of the shadow-casting light's azimuth).
export function planBoundsM(
  polygon: FloorPolygon,
  walls: WallSegment[],
  columns: Column[],
  furniture: FurnitureItem[],
): PlanBounds {
  const acc: Accumulator = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  };

  for (const vertex of polygon) {
    expand(acc, vertex.x, vertex.y, 0);
  }

  const wallHalfThickness = WALL_THICKNESS_M / 2;
  for (const wall of walls) {
    expand(acc, wall.start.x, wall.start.y, wallHalfThickness);
    expand(acc, wall.end.x, wall.end.y, wallHalfThickness);
  }

  // Columns/furniture are clamped to the editable plan area at creation, not
  // to the floor polygon — the 5m margin around the booth is a legitimate
  // place for them to sit, so both
  // must be folded into the bounds (not just the polygon). Circumscribing
  // radius (not w/2, h/2) is used because rotationDeg can be any angle, so
  // the unrotated w x h footprint would undercount a rotated item's extent.
  for (const column of columns) {
    expand(acc, column.center.x, column.center.y, Math.hypot(column.w, column.h) / 2);
  }
  for (const item of furniture) {
    expand(acc, item.center.x, item.center.y, Math.hypot(item.w, item.h) / 2);
  }

  if (
    !Number.isFinite(acc.minX) ||
    !Number.isFinite(acc.maxX) ||
    !Number.isFinite(acc.minY) ||
    !Number.isFinite(acc.maxY)
  ) {
    // No finite input at all (e.g. an empty polygon) — degrade to a
    // minimal bounds centered on the origin rather than propagating
    // Infinity/NaN into the shadow camera.
    return {
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      centerX: 0,
      centerY: 0,
      radiusM: MIN_SHADOW_RADIUS_M,
    };
  }

  const centerX = (acc.minX + acc.maxX) / 2;
  const centerY = (acc.minY + acc.maxY) / 2;
  const radiusM = Math.max(
    MIN_SHADOW_RADIUS_M,
    0.5 * Math.hypot(acc.maxX - acc.minX, acc.maxY - acc.minY),
  );

  return {
    minX: acc.minX,
    maxX: acc.maxX,
    minY: acc.minY,
    maxY: acc.maxY,
    centerX,
    centerY,
    radiusM,
  };
}
