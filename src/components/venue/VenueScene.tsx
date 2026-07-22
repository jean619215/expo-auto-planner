"use client";

import {
  useRef,
  useState,
  useMemo,
  type ComponentRef,
  type RefObject,
} from "react";
import * as THREE from "three";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, TransformControls } from "@react-three/drei";
import {
  Table2,
  Armchair,
  Archive,
  Store,
  Flag,
  Sofa,
  Presentation,
  Flower2,
  Package,
  RotateCcw,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
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
  counter: Store,
  bannerStand: Flag,
  sofa: Sofa,
  podium: Presentation,
  plant: Flower2,
  display: Package,
};

interface VenueSceneProps {
  polygon: FloorPolygon;
  walls: WallSegment[];
  columns: Column[];
  furniture: FurnitureItem[];
  venueSizeM?: number;
  // 選填:相機取景/gizmo 尺寸的 fit 基準,與 venueSizeM(ground plane/clamp
  // 用)分離 — 預設回退到 venueSizeM,維持既有呼叫端行為不變。
  viewFitSizeM?: number;
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
  viewFitSizeM,
  onSceneChange,
}: VenueSceneProps) {
  const fit = viewFitSizeM ?? venueSizeM;
  const [selectedId, setSelectedId] = useState<SelectedId>(null);
  const [transformMode, setTransformMode] = useState<"translate" | "rotate">(
    "translate",
  );
  const [placingKind, setPlacingKind] = useState<FurnitureKind | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const selectedMeshRef = useRef<THREE.Object3D | null>(null);
  const dragStartRef = useRef<{ x: number; z: number } | null>(null);
  const orbitRef = useRef<ComponentRef<typeof OrbitControls>>(null);

  function resetView() {
    orbitRef.current?.reset();
  }

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
      const nextFurniture = furniture.map((f) =>
        f.id === selectedId.id ? rotateFurniture(f, deg) : f,
      );
      onSceneChange?.({ walls, columns, furniture: nextFurniture });
      return;
    }

    const start = dragStartRef.current;
    dragStartRef.current = null;
    if (!start) return;
    const deltaPlan = { x: obj.position.x - start.x, y: obj.position.z - start.z };

    let nextWalls = walls;
    let nextColumns = columns;
    let nextFurniture = furniture;

    if (selectedId.type === "wall") {
      nextWalls = walls.map((w) =>
        w.id === selectedId.id ? translateWall(w, deltaPlan, venueSizeM) : w,
      );
    } else if (selectedId.type === "column") {
      nextColumns = columns.map((c) =>
        c.id === selectedId.id ? translateColumn(c, deltaPlan, venueSizeM) : c,
      );
    } else {
      nextFurniture = furniture.map((f) =>
        f.id === selectedId.id ? translateFurniture(f, deltaPlan, venueSizeM) : f,
      );
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
      const nextFurniture = [...furniture, item];
      setPlacingKind(null);
      selectObject({ type: "furniture", id: item.id });
      onSceneChange?.({ walls, columns, furniture: nextFurniture });
      return;
    }
    setSelectedId(null);
  }

  const isFurnitureRotate =
    selectedId?.type === "furniture" && transformMode === "rotate";
  const selectionExists =
    selectedId !== null &&
    (selectedId.type === "wall"
      ? walls.some((w) => w.id === selectedId.id)
      : selectedId.type === "column"
        ? columns.some((c) => c.id === selectedId.id)
        : furniture.some((f) => f.id === selectedId.id));
  const selectedFurniture =
    selectedId?.type === "furniture"
      ? furniture.find((f) => f.id === selectedId.id) ?? null
      : null;

  return (
    <div
      data-testid="venue-scene"
      data-generated="true"
      data-orbit-controls="true"
      data-wall-mesh-count={walls.length}
      data-column-mesh-count={columns.length}
      data-furniture-mesh-count={furniture.length}
      data-floor-vertex-count={polygon.length}
      className="mt-4 w-full"
    >
      <div className="flex gap-3">
        {/* 左側可開合側欄:家具面板 + 選取後的移動/旋轉工具列。收合時只留切換鈕。 */}
        <aside
          data-testid="venue-sidebar"
          data-open={sidebarOpen}
          className={
            (sidebarOpen ? "w-48" : "w-11") +
            " shrink-0 rounded-md border border-stone-300 bg-card p-2"
          }
        >
          <button
            type="button"
            data-testid="sidebar-toggle"
            aria-label={sidebarOpen ? "收合側欄" : "展開側欄"}
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((prev) => !prev)}
            className="flex h-7 w-full items-center justify-center rounded text-blueprint hover:bg-blueprint-wash [&_svg]:size-4"
          >
            {sidebarOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
          </button>
          {sidebarOpen && (
            <div className="mt-2 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="px-0.5 text-xs font-bold text-muted-foreground">
                  家具
                </span>
                {(Object.keys(FURNITURE_DEFAULTS) as FurnitureKind[]).map(
                  (kind) => {
                    const Icon = FURNITURE_ICONS[kind];
                    return (
                      <Button
                        key={kind}
                        type="button"
                        size="sm"
                        variant={placingKind === kind ? "default" : "outline"}
                        data-testid={`furniture-place-${kind}`}
                        onClick={() =>
                          setPlacingKind((prev) => (prev === kind ? null : kind))
                        }
                        className="w-full justify-start"
                      >
                        <Icon />
                        {FURNITURE_DEFAULTS[kind].label}
                      </Button>
                    );
                  },
                )}
              </div>
              {selectedFurniture && (
                <div className="flex flex-col gap-1.5">
                  <span className="px-0.5 text-xs font-bold text-muted-foreground">
                    調整
                  </span>
                  <div className="inline-flex overflow-hidden rounded-md border-[1.5px] border-blueprint bg-card">
                    <button
                      type="button"
                      data-testid="furniture-mode-translate"
                      aria-pressed={transformMode === "translate"}
                      onClick={() => setTransformMode("translate")}
                      className={segmentClassName + " flex-1 justify-center"}
                    >
                      移動
                    </button>
                    <button
                      type="button"
                      data-testid="furniture-mode-rotate"
                      aria-pressed={transformMode === "rotate"}
                      onClick={() => setTransformMode("rotate")}
                      className={segmentClassName + " flex-1 justify-center"}
                    >
                      旋轉
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </aside>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center">
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="reset-view-button"
              onClick={resetView}
              className="ml-auto"
            >
              <RotateCcw />
              重設視角
            </Button>
          </div>
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
            ref={orbitRef}
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
          <FloorMesh polygon={polygon} onClick={handleFloorClick} />
          {walls.map((wall) => {
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
          {columns.map((col) => {
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
          {furniture.map((item) => {
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
          {selectionExists && (
            <TransformControls
              key={`${selectedId.type}-${selectedId.id}-${transformMode}`}
              object={selectedMeshRef as RefObject<THREE.Object3D>}
              mode={selectedId.type === "furniture" ? transformMode : "translate"}
              showX={!isFurnitureRotate}
              showY={isFurnitureRotate}
              showZ={!isFurnitureRotate}
              rotationSnap={Math.PI / 12}
              size={Math.max(1, fit * 0.04)}
              onMouseDown={handleDragMouseDown}
              onMouseUp={commitTransform}
            />
          )}
          </Canvas>
          </div>
        </div>
      </div>
    </div>
  );
}
