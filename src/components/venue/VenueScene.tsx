"use client";

import { useRef, useState, useMemo, type RefObject } from "react";
import * as THREE from "three";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, TransformControls } from "@react-three/drei";
import { Table2, Armchair, Archive } from "lucide-react";
import {
  VENUE_SIZE_M,
  WALL_THICKNESS_M,
  translateColumn,
  translateWall,
  wallLengthM,
  type Column,
  type FloorPolygon,
  type WallSegment,
} from "@/lib/venue/plan";
import {
  FURNITURE_DEFAULTS,
  createFurniture,
  rotateFurniture,
  translateFurniture,
  type FurnitureItem,
  type FurnitureKind,
} from "@/lib/venue/furniture";
import { Button } from "@/components/ui/button";
import { segmentClassName } from "./PlanToolbar";

const WALL_HEIGHT_M = 3;
const FLOOR_THICKNESS_M = 0.1;

type SelectedId =
  | { type: "wall" | "column" | "furniture"; id: string }
  | null;

const FURNITURE_ICONS: Record<FurnitureKind, typeof Table2> = {
  table: Table2,
  chair: Armchair,
  cabinet: Archive,
};

interface VenueSceneProps {
  polygon: FloorPolygon;
  walls: WallSegment[];
  columns: Column[];
  furniture: FurnitureItem[];
  venueSizeM?: number;
  onSceneChange?: (next: {
    walls: WallSegment[];
    columns: Column[];
    furniture: FurnitureItem[];
  }) => void;
}

function FloorMesh({
  polygon,
  onClick,
}: {
  polygon: FloorPolygon;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(polygon[0].x, polygon[0].y);
    polygon.slice(1).forEach((p) => shape.lineTo(p.x, p.y));
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, {
      depth: FLOOR_THICKNESS_M,
      bevelEnabled: false,
    });
  }, [polygon]);

  return (
    <mesh geometry={geometry} rotation={[Math.PI / 2, 0, 0]} onClick={onClick}>
      <meshStandardMaterial color="#f5f5f4" side={THREE.DoubleSide} />
    </mesh>
  );
}

export default function VenueScene({
  polygon,
  walls,
  columns,
  furniture,
  venueSizeM = VENUE_SIZE_M,
  onSceneChange,
}: VenueSceneProps) {
  const [localWalls, setLocalWalls] = useState(walls);
  const [localColumns, setLocalColumns] = useState(columns);
  const [localFurniture, setLocalFurniture] = useState<FurnitureItem[]>(furniture);
  const [selectedId, setSelectedId] = useState<SelectedId>(null);
  const [transformMode, setTransformMode] = useState<"translate" | "rotate">(
    "translate",
  );
  const [placingKind, setPlacingKind] = useState<FurnitureKind | null>(null);
  const selectedMeshRef = useRef<THREE.Object3D | null>(null);
  const dragStartRef = useRef<{ x: number; z: number } | null>(null);

  function selectObject(next: NonNullable<SelectedId>) {
    setSelectedId(next);
    setTransformMode("translate");
  }

  function handleDragMouseDown() {
    const obj = selectedMeshRef.current;
    if (obj) {
      dragStartRef.current = { x: obj.position.x, z: obj.position.z };
    }
  }

  function commitTransform() {
    const obj = selectedMeshRef.current;
    if (!obj || !selectedId) return;

    if (selectedId.type === "furniture" && transformMode === "rotate") {
      const deg = -(obj.rotation.y * 180) / Math.PI;
      const nextFurniture = localFurniture.map((f) =>
        f.id === selectedId.id ? rotateFurniture(f, deg) : f,
      );
      setLocalFurniture(nextFurniture);
      onSceneChange?.({
        walls: localWalls,
        columns: localColumns,
        furniture: nextFurniture,
      });
      return;
    }

    const start = dragStartRef.current;
    dragStartRef.current = null;
    if (!start) return;
    const deltaPlan = { x: obj.position.x - start.x, y: obj.position.z - start.z };

    let nextWalls = localWalls;
    let nextColumns = localColumns;
    let nextFurniture = localFurniture;

    if (selectedId.type === "wall") {
      nextWalls = localWalls.map((w) =>
        w.id === selectedId.id ? translateWall(w, deltaPlan, venueSizeM) : w,
      );
      setLocalWalls(nextWalls);
    } else if (selectedId.type === "column") {
      nextColumns = localColumns.map((c) =>
        c.id === selectedId.id ? translateColumn(c, deltaPlan, venueSizeM) : c,
      );
      setLocalColumns(nextColumns);
    } else {
      nextFurniture = localFurniture.map((f) =>
        f.id === selectedId.id ? translateFurniture(f, deltaPlan, venueSizeM) : f,
      );
      setLocalFurniture(nextFurniture);
    }
    onSceneChange?.({ walls: nextWalls, columns: nextColumns, furniture: nextFurniture });
  }

  function handleFloorClick(e: ThreeEvent<MouseEvent>) {
    if (placingKind) {
      const item = createFurniture(
        placingKind,
        { x: e.point.x, y: e.point.z },
        venueSizeM,
      );
      const nextFurniture = [...localFurniture, item];
      setLocalFurniture(nextFurniture);
      setPlacingKind(null);
      selectObject({ type: "furniture", id: item.id });
      onSceneChange?.({
        walls: localWalls,
        columns: localColumns,
        furniture: nextFurniture,
      });
      return;
    }
    setSelectedId(null);
  }

  const isFurnitureRotate =
    selectedId?.type === "furniture" && transformMode === "rotate";
  const selectedFurniture =
    selectedId?.type === "furniture"
      ? localFurniture.find((f) => f.id === selectedId.id) ?? null
      : null;

  return (
    <div
      data-testid="venue-scene"
      data-generated="true"
      data-orbit-controls="true"
      data-wall-mesh-count={localWalls.length}
      data-column-mesh-count={localColumns.length}
      data-furniture-mesh-count={localFurniture.length}
      data-floor-vertex-count={polygon.length}
      className="mt-4 w-full"
    >
      <div className="mb-2 flex items-center gap-2">
        {(Object.keys(FURNITURE_DEFAULTS) as FurnitureKind[]).map((kind) => {
          const Icon = FURNITURE_ICONS[kind];
          return (
            <Button
              key={kind}
              type="button"
              size="sm"
              variant={placingKind === kind ? "default" : "outline"}
              data-testid={`furniture-place-${kind}`}
              onClick={() => setPlacingKind((prev) => (prev === kind ? null : kind))}
            >
              <Icon />
              {FURNITURE_DEFAULTS[kind].label}
            </Button>
          );
        })}
        {selectedFurniture && (
          <div className="ml-auto inline-flex overflow-hidden rounded-md border-[1.5px] border-blueprint bg-card">
            <button
              type="button"
              data-testid="furniture-mode-translate"
              aria-pressed={transformMode === "translate"}
              onClick={() => setTransformMode("translate")}
              className={segmentClassName}
            >
              移動
            </button>
            <button
              type="button"
              data-testid="furniture-mode-rotate"
              aria-pressed={transformMode === "rotate"}
              onClick={() => setTransformMode("rotate")}
              className={segmentClassName}
            >
              旋轉
            </button>
          </div>
        )}
      </div>
      <div className="h-[480px] w-full overflow-hidden rounded border border-stone-300 bg-stone-100">
        <Canvas
          camera={{
            position: [venueSizeM * 0.7, venueSizeM * 0.9, venueSizeM * 0.7],
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
            target={[venueSizeM / 2, 0, venueSizeM / 2]}
          />
          <gridHelper
            args={[venueSizeM, venueSizeM]}
            position={[venueSizeM / 2, 0.01, venueSizeM / 2]}
          />
          <FloorMesh polygon={polygon} onClick={handleFloorClick} />
          {localWalls.map((wall) => {
            const isSelected = selectedId?.type === "wall" && selectedId.id === wall.id;
            const rotationY = -Math.atan2(
              wall.end.y - wall.start.y,
              wall.end.x - wall.start.x,
            );
            return (
              <mesh
                key={wall.id}
                ref={(node) => {
                  if (isSelected) selectedMeshRef.current = node;
                }}
                position={[
                  (wall.start.x + wall.end.x) / 2,
                  WALL_HEIGHT_M / 2,
                  (wall.start.y + wall.end.y) / 2,
                ]}
                rotation={[0, rotationY, 0]}
                onClick={(e) => {
                  e.stopPropagation();
                  selectObject({ type: "wall", id: wall.id });
                }}
              >
                <boxGeometry
                  args={[wallLengthM(wall), WALL_HEIGHT_M, WALL_THICKNESS_M]}
                />
                <meshStandardMaterial color={isSelected ? "#1F4E79" : "#78350f"} />
              </mesh>
            );
          })}
          {localColumns.map((col) => {
            const isSelected = selectedId?.type === "column" && selectedId.id === col.id;
            return (
              <mesh
                key={col.id}
                ref={(node) => {
                  if (isSelected) selectedMeshRef.current = node;
                }}
                position={[col.center.x, WALL_HEIGHT_M / 2, col.center.y]}
                onClick={(e) => {
                  e.stopPropagation();
                  selectObject({ type: "column", id: col.id });
                }}
              >
                <boxGeometry args={[col.w, WALL_HEIGHT_M, col.h]} />
                <meshStandardMaterial color={isSelected ? "#1F4E79" : "#78716c"} />
              </mesh>
            );
          })}
          {localFurniture.map((item) => {
            const isSelected =
              selectedId?.type === "furniture" && selectedId.id === item.id;
            const defaults = FURNITURE_DEFAULTS[item.kind];
            return (
              <mesh
                key={item.id}
                ref={(node) => {
                  if (isSelected) selectedMeshRef.current = node;
                }}
                position={[
                  item.center.x,
                  defaults.height3d / 2,
                  item.center.y,
                ]}
                rotation={[0, (-item.rotationDeg * Math.PI) / 180, 0]}
                onClick={(e) => {
                  e.stopPropagation();
                  selectObject({ type: "furniture", id: item.id });
                }}
              >
                <boxGeometry args={[item.w, defaults.height3d, item.h]} />
                <meshStandardMaterial
                  color={isSelected ? "#1F4E79" : defaults.color}
                />
              </mesh>
            );
          })}
          {selectedId && (
            <TransformControls
              key={`${selectedId.type}-${selectedId.id}-${transformMode}`}
              object={selectedMeshRef as RefObject<THREE.Object3D>}
              mode={selectedId.type === "furniture" ? transformMode : "translate"}
              showX={!isFurnitureRotate}
              showY={isFurnitureRotate}
              showZ={!isFurnitureRotate}
              rotationSnap={Math.PI / 12}
              size={Math.max(1, venueSizeM * 0.04)}
              onMouseDown={handleDragMouseDown}
              onMouseUp={commitTransform}
            />
          )}
        </Canvas>
      </div>
    </div>
  );
}
