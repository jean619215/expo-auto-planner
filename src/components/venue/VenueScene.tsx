"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
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
  Trash2,
} from "lucide-react";
import {
  MAX_WALL_HEIGHT_M,
  MIN_WALL_HEIGHT_M,
  VENUE_SIZE_M,
  WALL_THICKNESS_M,
  clampWallHeight,
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
import { useFloorGeometry } from "./floorGeometry";
import VenueSceneProbe, {
  VENUE_WALL_NAME,
  VENUE_COLUMN_NAME,
  type VenueSceneMeasurements,
} from "./VenueSceneProbe";

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
  /**
   * 相機取景中心(公尺,平面 XY)。預設 fit/2 —— 場地固定從原點展開時的
   * 舊行為。展位 preset 之後場地不再從原點起算,相機必須對著攤位中心,
   * 否則畫面中心會落在地板外(3D 內點地板放家具會全部失效)。
   */
  viewCenterM?: { x: number; y: number };
  /** 全域牆高(公尺)。牆與柱共用,唯一來源是 PlanEditor 的頂層 state。 */
  wallHeightM: number;
  /** 使用者在本步驟調整牆高時回寫給 state owner;未給則不顯示調整 UI。 */
  onWallHeightChange?: (meters: number) => void;
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
  const geometry = useFloorGeometry(polygon);

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
  viewCenterM,
  wallHeightM,
  onWallHeightChange,
  onSceneChange,
}: VenueSceneProps) {
  const fit = viewFitSizeM ?? venueSizeM;
  const center = viewCenterM ?? { x: fit / 2, y: fit / 2 };
  const [selectedId, setSelectedId] = useState<SelectedId>(null);
  const [transformMode, setTransformMode] = useState<"translate" | "rotate">(
    "translate",
  );
  const [placingKind, setPlacingKind] = useState<FurnitureKind | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const selectedMeshRef = useRef<THREE.Object3D | null>(null);
  const dragStartRef = useRef<{ x: number; z: number } | null>(null);
  const orbitRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const [measurements, setMeasurements] = useState<VenueSceneMeasurements>({
    wallHeightM: 0,
    columnHeightM: 0,
  });
  const handleProbeReport = useCallback(
    (next: VenueSceneMeasurements) => setMeasurements(next),
    [],
  );

  function resetView() {
    orbitRef.current?.reset();
  }

  function selectObject(next: NonNullable<SelectedId>) {
    setSelectedId(next);
    setTransformMode("translate");
  }

  // 步驟 02 的刪除(feedback round 2, T2)。範圍比照步驟 01 的
  // deleteSelectedObject():選到什麼刪什麼 —— 選取機制三種物件都支援,
  // 只讓家具可刪會變成「選得到卻刪不掉」。
  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    setSelectedId(null);
    selectedMeshRef.current = null;
    onSceneChange?.({
      walls:
        selectedId.type === "wall"
          ? walls.filter((w) => w.id !== selectedId.id)
          : walls,
      columns:
        selectedId.type === "column"
          ? columns.filter((c) => c.id !== selectedId.id)
          : columns,
      furniture:
        selectedId.type === "furniture"
          ? furniture.filter((f) => f.id !== selectedId.id)
          : furniture,
    });
  }, [selectedId, walls, columns, furniture, onSceneChange]);

  // Delete/Backspace 綁在 document 而不是某個容器:3D 的點選發生在 canvas
  // 上,焦點不一定落在任何可接收鍵盤事件的元素,綁容器會有「選好了卻按不
  // 動」的空窗。代價是要自己排除輸入中的欄位 —— 否則在牆高輸入框裡按
  // Backspace 會把場上的家具刪掉。
  useEffect(() => {
    if (!selectedId) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      deleteSelected();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectedId, deleteSelected]);

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
      data-selected-type={selectedId?.type ?? ""}
      data-selected-id={selectedId?.id ?? ""}
      data-wall-height-m={wallHeightM}
      data-wall-mesh-height-m={measurements.wallHeightM}
      data-column-mesh-height-m={measurements.columnHeightM}
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
              {onWallHeightChange && (
                <div className="flex flex-col gap-1.5">
                  <span className="px-0.5 text-xs font-bold text-muted-foreground">
                    場地
                  </span>
                  <label className="flex items-center gap-1.5 px-0.5 text-xs text-muted-foreground">
                    牆高
                    <input
                      type="number"
                      data-testid="wall-height-input"
                      min={MIN_WALL_HEIGHT_M}
                      max={MAX_WALL_HEIGHT_M}
                      step={0.5}
                      defaultValue={wallHeightM}
                      key={wallHeightM}
                      onBlur={(e) =>
                        onWallHeightChange(clampWallHeight(e.target.valueAsNumber))
                      }
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        onWallHeightChange(
                          clampWallHeight(e.currentTarget.valueAsNumber),
                        );
                      }}
                      className="w-16 rounded border border-stone-300 bg-card px-1 py-0.5 text-right text-foreground"
                    />
                    m
                  </label>
                </div>
              )}
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
              <div className="flex flex-col gap-1.5">
                <span className="px-0.5 text-xs font-bold text-muted-foreground">
                  調整
                </span>
                {selectedFurniture && (
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
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="scene-delete-button"
                  disabled={!selectionExists}
                  onClick={deleteSelected}
                  className="w-full justify-start"
                >
                  <Trash2 />
                  刪除
                </Button>
              </div>
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
            position: [
              center.x + fit * 0.7,
              fit * 0.9,
              center.y + fit * 0.7,
            ],
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
            target={[center.x, 0, center.y]}
          />
          <VenueSceneProbe onReport={handleProbeReport} />
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
                name={VENUE_WALL_NAME}
                ref={(node) => {
                  if (isSelected) selectedMeshRef.current = node;
                }}
                position={[
                  (wall.start.x + wall.end.x) / 2,
                  wallHeightM / 2,
                  (wall.start.y + wall.end.y) / 2,
                ]}
                rotation={[0, rotationY, 0]}
                onClick={(e) => {
                  e.stopPropagation();
                  selectObject({ type: "wall", id: wall.id });
                }}
              >
                <boxGeometry
                  args={[wallLengthM(wall), wallHeightM, WALL_THICKNESS_M]}
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
                name={VENUE_COLUMN_NAME}
                ref={(node) => {
                  if (isSelected) selectedMeshRef.current = node;
                }}
                position={[col.center.x, wallHeightM / 2, col.center.y]}
                onClick={(e) => {
                  e.stopPropagation();
                  selectObject({ type: "column", id: col.id });
                }}
              >
                <boxGeometry args={[col.w, wallHeightM, col.h]} />
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
