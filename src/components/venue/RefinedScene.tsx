"use client";

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
import { useFloorGeometry } from "./floorGeometry";

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
    <mesh geometry={geometry} rotation={[Math.PI / 2, 0, 0]}>
      <meshStandardMaterial color="#f5f5f4" side={THREE.DoubleSide} />
    </mesh>
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

  return (
    <div
      data-testid="refined-scene"
      data-readonly="true"
      data-orbit-controls="true"
      data-wall-mesh-count={walls.length}
      data-column-mesh-count={columns.length}
      data-furniture-mesh-count={furniture.length}
      data-floor-vertex-count={polygon.length}
      className="mt-4 w-full"
    >
      <div className="h-[480px] w-full overflow-hidden rounded border border-stone-300 bg-stone-100">
        <Canvas
          camera={{
            position: [fit * 0.7, fit * 0.9, fit * 0.7],
            fov: 50,
          }}
        >
          <ambientLight intensity={0.6} />
          <directionalLight position={[25, 40, 25]} intensity={0.8} />
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
              >
                <boxGeometry
                  args={[wallLengthM(wall), WALL_HEIGHT_M, WALL_THICKNESS_M]}
                />
                <meshStandardMaterial color="#78350f" />
              </mesh>
            );
          })}
          {columns.map((col) => (
            <mesh
              key={col.id}
              position={[col.center.x, WALL_HEIGHT_M / 2, col.center.y]}
            >
              <boxGeometry args={[col.w, WALL_HEIGHT_M, col.h]} />
              <meshStandardMaterial color="#78716c" />
            </mesh>
          ))}
          {furniture.map((item) => {
            const defaults = FURNITURE_DEFAULTS[item.kind];
            return (
              <mesh
                key={item.id}
                position={[item.center.x, defaults.height3d / 2, item.center.y]}
                rotation={[0, (-item.rotationDeg * Math.PI) / 180, 0]}
              >
                <boxGeometry args={[item.w, defaults.height3d, item.h]} />
                <meshStandardMaterial color={defaults.color} />
              </mesh>
            );
          })}
        </Canvas>
      </div>
    </div>
  );
}
