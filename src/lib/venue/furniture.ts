// Pure geometry/domain module for placeable furniture items, mirroring the
// style of plan.ts. Furniture is a rectangle-with-center like Column, so it
// reuses clampColumnCenter for boundary clamping.

import {
  VENUE_SIZE_M,
  clampColumnCenter,
  createObjectId,
  snapPoint,
  snapToGrid,
  type PlanPoint,
} from "./plan";

export type FurnitureKind = "table" | "chair" | "cabinet";

export interface FurnitureItem {
  id: string;
  kind: FurnitureKind;
  center: PlanPoint; // meters
  w: number; // meters
  h: number; // meters
  rotationDeg: number; // 0 = unrotated, normalized to [0, 360)
}

export const FURNITURE_DEFAULTS: Record<
  FurnitureKind,
  { w: number; h: number; label: string; color: string; height3d: number }
> = {
  table: { w: 1.2, h: 0.7, label: "桌子", color: "#8a6d3b", height3d: 0.75 },
  chair: { w: 0.45, h: 0.45, label: "椅子", color: "#5b7a9d", height3d: 0.9 },
  cabinet: { w: 0.6, h: 1.2, label: "櫃子", color: "#6b5b95", height3d: 1.8 },
};

function normalizeDeg(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

// Rotated footprints can poke slightly outside the venue boundary since
// clampColumnCenter only clamps the unrotated w x h axis-aligned box — an
// accepted limitation for a whitebox planning tool, not solved here.
export function createFurniture(
  kind: FurnitureKind,
  rawCenter: PlanPoint,
  sizeM: number = VENUE_SIZE_M,
): FurnitureItem {
  const defaults = FURNITURE_DEFAULTS[kind];
  return {
    id: createObjectId(),
    kind,
    center: clampColumnCenter(
      snapPoint(rawCenter, sizeM),
      defaults.w,
      defaults.h,
      sizeM,
    ),
    w: defaults.w,
    h: defaults.h,
    rotationDeg: 0,
  };
}

export function translateFurniture(
  item: FurnitureItem,
  deltaRaw: PlanPoint,
  sizeM: number = VENUE_SIZE_M,
): FurnitureItem {
  const deltaX = snapToGrid(deltaRaw.x);
  const deltaY = snapToGrid(deltaRaw.y);
  const moved = {
    x: item.center.x + deltaX,
    y: item.center.y + deltaY,
  };
  return {
    ...item,
    center: clampColumnCenter(moved, item.w, item.h, sizeM),
  };
}

export function rotateFurniture(item: FurnitureItem, rotationDeg: number): FurnitureItem {
  return { ...item, rotationDeg: normalizeDeg(rotationDeg) };
}
