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
import { useFloorGeometry } from "./floorGeometry";
import { HallLighting, HallEnvironment, REFINED_GL, REFINED_SURFACE } from "./refinedLighting";
import RefinedSceneProbe, {
  REFINED_FLOOR_NAME,
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

function FloorMesh({ polygon }: { polygon: FloorPolygon }) {
  const geometry = useFloorGeometry(polygon);

  return (
    <mesh
      name={REFINED_FLOOR_NAME}
      geometry={geometry}
      rotation={[Math.PI / 2, 0, 0]}
      receiveShadow
    >
      <meshStandardMaterial
        color={REFINED_SURFACE.floor.color}
        roughness={REFINED_SURFACE.floor.roughness}
        metalness={REFINED_SURFACE.floor.metalness}
        side={THREE.DoubleSide}
      />
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
  };
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

  return (
    <div
      data-testid="refined-scene"
      data-readonly="true"
      data-orbit-controls="true"
      data-wall-mesh-count={walls.length}
      data-column-mesh-count={columns.length}
      data-furniture-mesh-count={furniture.length}
      data-floor-vertex-count={polygon.length}
      {...diagnosticsAttrs(diagnostics)}
      className="mt-4 w-full"
    >
      <div className="h-[480px] w-full overflow-hidden rounded border border-stone-300 bg-stone-100">
        <Canvas
          shadows="variance"
          gl={REFINED_GL}
          camera={{
            position: [fit * 0.7, fit * 0.9, fit * 0.7],
            fov: 50,
          }}
        >
          <HallLighting bounds={bounds} revision={revision} />
          <HallEnvironment />
          <RefinedSceneProbe resetKey={revision} onReport={setDiagnostics} />
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
          <FloorMesh polygon={polygon} />
          {walls.map((wall) => {
            const rotationY = -Math.atan2(
              wall.end.y - wall.start.y,
              wall.end.x - wall.start.x,
            );
            return (
              <mesh
                key={wall.id}
                position={[
                  (wall.start.x + wall.end.x) / 2,
                  WALL_HEIGHT_M / 2,
                  (wall.start.y + wall.end.y) / 2,
                ]}
                rotation={[0, rotationY, 0]}
                castShadow
                receiveShadow
              >
                <boxGeometry
                  args={[wallLengthM(wall), WALL_HEIGHT_M, WALL_THICKNESS_M]}
                />
                <meshStandardMaterial
                  color="#78350f"
                  roughness={REFINED_SURFACE.wall.roughness}
                  metalness={REFINED_SURFACE.wall.metalness}
                />
              </mesh>
            );
          })}
          {columns.map((col) => (
            <mesh
              key={col.id}
              position={[col.center.x, WALL_HEIGHT_M / 2, col.center.y]}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[col.w, WALL_HEIGHT_M, col.h]} />
              <meshStandardMaterial
                color="#78716c"
                roughness={REFINED_SURFACE.column.roughness}
                metalness={REFINED_SURFACE.column.metalness}
              />
            </mesh>
          ))}
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
        </Canvas>
      </div>
    </div>
  );
}
