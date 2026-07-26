"use client";

// architect-plan.md 階段 B 步驟 4 — 公尺單位 UV 的 box geometry(D3)。
// `BoxGeometry` 六面各自 0..1 的 UV 若沿用,窄面(例如
// `WALL_THICKNESS_M = 0.2`)會被拉伸成條紋。`applyMeterUv` 依每面實際公尺
// 數重寫 UV,讓全場(地板 + 牆 + 柱)共用同一套「UV 單位 = 公尺」約定。

import { useEffect, useMemo } from "react";
import * as THREE from "three";

export interface MeterUvBoxSpec {
  id: string;
  w: number;
  h: number;
  d: number;
  /** Deterministic per-instance U offset (meters) so adjacent boxes using
   * the same shared material don't all start at the same texture phase. */
  uOffset?: number;
}

// `BoxGeometry`'s fixed group order (three's BoxGeometry.js buildPlane
// call sequence): +x, -x, +y, -y, +z, -z, 4 vertices each. group index
// === face index here because BoxGeometry emits exactly one group per
// face with no material-index splitting.
const FACE_COUNT = 6;
const VERTICES_PER_FACE = 4;

/**
 * Rewrites `geometry`'s `uv` attribute in place so each of the 6
 * `BoxGeometry` faces spans its own real-world extent in meters, instead
 * of the default 0..1 per face. Face -> (u span, v span) mapping:
 *   +x/-x (the w=0.2m narrow side faces on a wall): d, h
 *   +y/-y (top/bottom):                              w, d
 *   +z/-z (front/back, the wall's long faces):        w, h
 * `uOffset` (meters) is added to every face's `u` so instances sharing one
 * material don't all start at the same texture phase (RefinedScene.tsx
 * passes a per-wall deterministic hash-based offset).
 */
export function applyMeterUv(
  geometry: THREE.BufferGeometry,
  w: number,
  h: number,
  d: number,
  uOffset = 0,
): void {
  const uv = geometry.getAttribute("uv");
  if (!uv) return;

  const spans: [number, number][] = [
    [d, h], // +x
    [d, h], // -x
    [w, d], // +y
    [w, d], // -y
    [w, h], // +z
    [w, h], // -z
  ];

  for (let face = 0; face < FACE_COUNT; face++) {
    const [uSpan, vSpan] = spans[face];
    const base = face * VERTICES_PER_FACE;
    for (let v = 0; v < VERTICES_PER_FACE; v++) {
      const i = base + v;
      const u0 = uv.getX(i);
      const v0 = uv.getY(i);
      uv.setXY(i, u0 * uSpan + uOffset, v0 * vSpan);
    }
  }

  uv.needsUpdate = true;
}

/**
 * Deterministic string -> [0,1) hash (FNV-1a), used to derive each wall's
 * texture-phase offset from its stable `id` so re-renders don't jitter it
 * and different walls sharing one material don't all start at the same
 * phase (D3).
 */
export function hashStringToUnit(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0xffffffff;
}

/**
 * Builds (and memoizes) one meter-UV `BoxGeometry` per spec, disposing the
 * previous set whenever `specs` changes identity or the caller unmounts —
 * mirrors `useFloorGeometry`'s (`floorGeometry.ts`) memo+cleanup pattern
 * (AGENTS.md: no render-time geometry creation, dispose on unmount).
 */
export function useMeterUvBoxGeometries(
  specs: MeterUvBoxSpec[],
): Map<string, THREE.BoxGeometry> {
  const geometries = useMemo(() => {
    const map = new Map<string, THREE.BoxGeometry>();
    for (const spec of specs) {
      const geometry = new THREE.BoxGeometry(spec.w, spec.h, spec.d);
      applyMeterUv(geometry, spec.w, spec.h, spec.d, spec.uOffset ?? 0);
      map.set(spec.id, geometry);
    }
    return map;
  }, [specs]);

  useEffect(() => {
    return () => {
      geometries.forEach((geometry) => geometry.dispose());
    };
  }, [geometries]);

  return geometries;
}
