"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import {
  VENUE_SIZE_M,
  WALL_THICKNESS_M,
  wallLengthM,
  type Column,
  type FloorPolygon,
  type WallSegment,
} from "@/lib/venue/plan";
import { FURNITURE_DEFAULTS, type FurnitureItem } from "@/lib/venue/furniture";
import { planBoundsM } from "@/lib/venue/bounds";
import type { PlanBounds } from "@/lib/venue/bounds";
import { useFloorGeometry } from "./floorGeometry";
import { HallLighting, HallEnvironment, REFINED_GL, REFINED_SURFACE } from "./refinedLighting";
import SurfaceMaterials, { useSurfaceMaterials } from "./SurfaceMaterials";
import { hashStringToUnit, useMeterUvBoxGeometries } from "./boxGeometry";
import { WALL_TILE_M } from "./surfaceTextures";
import RefinedSceneProbe, {
  REFINED_COLUMN_NAME,
  REFINED_FLOOR_NAME,
  REFINED_WALL_NAME,
  type RefinedDiagnostics,
} from "./RefinedSceneProbe";

const WALL_HEIGHT_M = 3;

interface RefinedSceneProps {
  polygon: FloorPolygon;
  walls: WallSegment[];
  columns: Column[];
  furniture: FurnitureItem[];
  venueSizeM?: number;
  // 選填:相機取景/gridHelper 尺寸的 fit 基準,與 venueSizeM(ground plane
  // 用)分離 — 預設回退到 venueSizeM,比照 VenueScene 的既有行為。
  viewFitSizeM?: number;
}

function FloorMesh({
  polygon,
  material,
}: {
  polygon: FloorPolygon;
  material: THREE.MeshStandardMaterial | null;
}) {
  const geometry = useFloorGeometry(polygon);

  return (
    <mesh
      name={REFINED_FLOOR_NAME}
      geometry={geometry}
      rotation={[Math.PI / 2, 0, 0]}
      receiveShadow
    >
      {material ? (
        <primitive object={material} attach="material" />
      ) : (
        // Fallback while SurfaceMaterials bakes (architect-plan.md step 3
        // — a single-commit window in practice, since the bake runs in a
        // useLayoutEffect before paint; kept so the scene can never render
        // with a hole in it).
        <meshStandardMaterial
          color={REFINED_SURFACE.floor.color}
          roughness={REFINED_SURFACE.floor.roughness}
          metalness={REFINED_SURFACE.floor.metalness}
          side={THREE.DoubleSide}
        />
      )}
    </mesh>
  );
}

function diagnosticsAttrs(diagnostics: RefinedDiagnostics | null): Record<string, string | undefined> {
  if (!diagnostics) {
    return { "data-lighting-ready": "false" };
  }
  return {
    "data-lighting-ready": "true",
    "data-light-count": String(diagnostics.lightCount),
    "data-shadow-casting-light-count": String(diagnostics.shadowCastingLightCount),
    "data-shadow-caster-mesh-count": String(diagnostics.shadowCasterMeshCount),
    // Read off the actual floor mesh by name, not a literal — D5 requires the
    // floor to receive but never cast (it is DoubleSide, so casting would make
    // it the scene's only real shadow-acne source).
    "data-floor-receives-shadow": String(diagnostics.floorReceivesShadow),
    "data-floor-casts-shadow": String(diagnostics.floorCastsShadow),
    "data-shadows-enabled": String(diagnostics.shadowsEnabled),
    "data-shadow-map-type": diagnostics.shadowMapType,
    "data-shadow-map-size":
      diagnostics.shadowMapSize === null ? undefined : String(diagnostics.shadowMapSize),
    "data-shadow-map-allocated-width":
      diagnostics.shadowMapAllocatedWidth === null
        ? undefined
        : String(diagnostics.shadowMapAllocatedWidth),
    "data-shadow-camera-span-m":
      diagnostics.shadowCameraSpanM === null ? undefined : String(diagnostics.shadowCameraSpanM),
    "data-shadow-camera-near-m":
      diagnostics.shadowCameraNearM === null ? undefined : String(diagnostics.shadowCameraNearM),
    "data-shadow-camera-far-m":
      diagnostics.shadowCameraFarM === null ? undefined : String(diagnostics.shadowCameraFarM),
    "data-tone-mapping": diagnostics.toneMapping,
    "data-tone-mapping-exposure": diagnostics.toneMappingExposure,
    "data-output-color-space": diagnostics.outputColorSpace,
    "data-environment-set": String(diagnostics.environmentSet),
    "data-renderer-textures": String(diagnostics.rendererTextures),
    "data-renderer-geometries": String(diagnostics.rendererGeometries),
    // task 3 — structured material diagnostics (see RefinedSceneProbe.tsx's
    // MaterialProbeReport), following this file's existing JSON-attribute
    // convention (PlanEditorPage.ts: data-vertices/data-objects/etc.) since
    // the flat-attribute style would otherwise need ~40 more attributes.
    "data-material-diagnostics": JSON.stringify(diagnostics.materials),
  };
}

interface RefinedSceneContentProps {
  polygon: FloorPolygon;
  walls: WallSegment[];
  columns: Column[];
  furniture: FurnitureItem[];
  venueSizeM: number;
  fit: number;
  bounds: PlanBounds;
  revision: number;
  onReport: (diagnostics: RefinedDiagnostics) => void;
}

// Rendered as <SurfaceMaterials>'s children so it can call
// useSurfaceMaterials() (architect-plan.md step 6) — the provider and its
// consumer must be split into separate components since a component
// cannot consume a context it renders itself.
function RefinedSceneContent({
  polygon,
  walls,
  columns,
  furniture,
  venueSizeM,
  fit,
  bounds,
  revision,
  onReport,
}: RefinedSceneContentProps) {
  const surfaceMaterials = useSurfaceMaterials();

  // Stable identity across re-renders where walls/columns haven't changed
  // (useMeterUvBoxGeometries memoizes on the `specs` array's identity) —
  // mirrors how useFloorGeometry keys off `polygon` directly.
  const wallSpecs = useMemo(
    () =>
      walls.map((wall) => ({
        id: wall.id,
        w: wallLengthM(wall),
        h: WALL_HEIGHT_M,
        d: WALL_THICKNESS_M,
        // D3: deterministic per-wall texture-phase offset so adjacent
        // walls sharing one material don't all start at the same phase.
        uOffset: hashStringToUnit(wall.id) * WALL_TILE_M,
      })),
    [walls],
  );
  const columnSpecs = useMemo(
    () => columns.map((col) => ({ id: col.id, w: col.w, h: WALL_HEIGHT_M, d: col.h })),
    [columns],
  );
  const wallGeometries = useMeterUvBoxGeometries(wallSpecs);
  const columnGeometries = useMeterUvBoxGeometries(columnSpecs);

  return (
    <>
      <HallLighting bounds={bounds} revision={revision} />
      <HallEnvironment />
      <RefinedSceneProbe resetKey={revision} onReport={onReport} />
      <OrbitControls
        makeDefault
        enableRotate
        enableZoom
        enablePan
        maxPolarAngle={Math.PI / 2 - 0.05}
        minDistance={5}
        maxDistance={150}
        target={[fit / 2, 0, fit / 2]}
      />
      <gridHelper
        args={[venueSizeM, venueSizeM]}
        position={[venueSizeM / 2, 0.01, venueSizeM / 2]}
      />
      <FloorMesh polygon={polygon} material={surfaceMaterials.floor} />
      {walls.map((wall) => {
        const rotationY = -Math.atan2(
          wall.end.y - wall.start.y,
          wall.end.x - wall.start.x,
        );
        const geometry = wallGeometries.get(wall.id);
        if (!geometry) return null;
        return (
          <mesh
            key={wall.id}
            name={REFINED_WALL_NAME}
            geometry={geometry}
            position={[
              (wall.start.x + wall.end.x) / 2,
              WALL_HEIGHT_M / 2,
              (wall.start.y + wall.end.y) / 2,
            ]}
            rotation={[0, rotationY, 0]}
            castShadow
            receiveShadow
          >
            {surfaceMaterials.wall ? (
              <primitive object={surfaceMaterials.wall} attach="material" />
            ) : (
              <meshStandardMaterial
                color={REFINED_SURFACE.wall.color}
                roughness={REFINED_SURFACE.wall.roughness}
                metalness={REFINED_SURFACE.wall.metalness}
              />
            )}
          </mesh>
        );
      })}
      {columns.map((col) => {
        const geometry = columnGeometries.get(col.id);
        if (!geometry) return null;
        return (
          <mesh
            key={col.id}
            name={REFINED_COLUMN_NAME}
            geometry={geometry}
            position={[col.center.x, WALL_HEIGHT_M / 2, col.center.y]}
            castShadow
            receiveShadow
          >
            {surfaceMaterials.column ? (
              <primitive object={surfaceMaterials.column} attach="material" />
            ) : (
              <meshStandardMaterial
                color={REFINED_SURFACE.column.color}
                roughness={REFINED_SURFACE.column.roughness}
                metalness={REFINED_SURFACE.column.metalness}
              />
            )}
          </mesh>
        );
      })}
      {furniture.map((item) => {
        const defaults = FURNITURE_DEFAULTS[item.kind];
        return (
          <mesh
            key={item.id}
            position={[item.center.x, defaults.height3d / 2, item.center.y]}
            rotation={[0, (-item.rotationDeg * Math.PI) / 180, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[item.w, defaults.height3d, item.h]} />
            <meshStandardMaterial
              color={defaults.color}
              roughness={REFINED_SURFACE.furniture.roughness}
              metalness={REFINED_SURFACE.furniture.metalness}
            />
          </mesh>
        );
      })}
    </>
  );
}

// 唯讀 3D 場景(步驟 03)。無選取、無 TransformControls、無回寫 —
// 幾何一律直接讀 props(PlanEditor 頂層 state,architect-plan.md D1)。
export default function RefinedScene({
  polygon,
  walls,
  columns,
  furniture,
  venueSizeM = VENUE_SIZE_M,
  viewFitSizeM,
}: RefinedSceneProps) {
  const fit = viewFitSizeM ?? venueSizeM;

  const bounds = useMemo(
    () => planBoundsM(polygon, walls, columns, furniture),
    [polygon, walls, columns, furniture],
  );

  // Bumped whenever polygon/walls/columns/furniture change identity, so
  // the shadow-bake and probe-reset effects (architect-plan.md D6/D8) can
  // tell "scene actually changed" apart from "unrelated re-render" even
  // when object counts stay the same (e.g. an AI move_item call). Derived
  // via useLayoutEffect + setState (not by mutating a ref during render —
  // disallowed by the project's react-hooks/refs lint rule): the setState
  // call happens in the same commit, before paint, so HallLighting /
  // RefinedSceneProbe see the bumped value on the very next render with no
  // visible flicker.
  const depsRef = useRef<
    [FloorPolygon, WallSegment[], Column[], FurnitureItem[]] | null
  >(null);
  const [revision, setRevision] = useState(0);
  useLayoutEffect(() => {
    const prev = depsRef.current;
    if (
      !prev ||
      prev[0] !== polygon ||
      prev[1] !== walls ||
      prev[2] !== columns ||
      prev[3] !== furniture
    ) {
      depsRef.current = [polygon, walls, columns, furniture];
      setRevision((r) => r + 1);
    }
  }, [polygon, walls, columns, furniture]);

  const [diagnostics, setDiagnostics] = useState<RefinedDiagnostics | null>(null);
  const [materialsReady, setMaterialsReady] = useState(false);

  return (
    <div
      data-testid="refined-scene"
      data-readonly="true"
      data-orbit-controls="true"
      data-wall-mesh-count={walls.length}
      data-column-mesh-count={columns.length}
      data-furniture-mesh-count={furniture.length}
      data-floor-vertex-count={polygon.length}
      data-materials-ready={String(materialsReady)}
      {...diagnosticsAttrs(diagnostics)}
      className="mt-4 w-full"
    >
      <div className="relative h-[480px] w-full overflow-hidden rounded border border-stone-300 bg-stone-100">
        <Canvas
          shadows="variance"
          gl={REFINED_GL}
          camera={{
            position: [fit * 0.7, fit * 0.9, fit * 0.7],
            fov: 50,
          }}
        >
          <SurfaceMaterials onReady={setMaterialsReady}>
            <RefinedSceneContent
              polygon={polygon}
              walls={walls}
              columns={columns}
              furniture={furniture}
              venueSizeM={venueSizeM}
              fit={fit}
              bounds={bounds}
              revision={revision}
              onReport={setDiagnostics}
            />
          </SurfaceMaterials>
        </Canvas>
        {!materialsReady && (
          // architect-plan.md step 7 — covers the (in practice sub-frame,
          // GPU-dependent) window between mount and the bake's
          // useLayoutEffect committing; guards low-end devices / CI
          // (SwiftShader) against an unexplained frozen frame.
          <div
            data-testid="refined-materials-loading"
            className="pointer-events-none absolute inset-0 flex items-center justify-center bg-stone-100/80 text-sm text-stone-600"
          >
            材質產生中…
          </div>
        )}
      </div>
    </div>
  );
}
