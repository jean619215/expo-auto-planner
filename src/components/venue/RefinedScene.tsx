"use client";

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import {
  FURNITURE_DEFAULTS,
  type FurnitureItem,
  type FurnitureKind,
} from "@/lib/venue/furniture";
import { hasFurnitureModel } from "@/lib/venue/models";
import { hasProceduralFurniture } from "@/lib/venue/proceduralFurniture";
import { planBoundsM } from "@/lib/venue/bounds";
import type { PlanBounds } from "@/lib/venue/bounds";
import { useFloorGeometry } from "./floorGeometry";
import { HallLighting, HallEnvironment, REFINED_GL, REFINED_SURFACE } from "./refinedLighting";
import SurfaceMaterials, { useSurfaceMaterials } from "./SurfaceMaterials";
import { hashStringToUnit, useMeterUvBoxGeometries } from "./boxGeometry";
import { WALL_TILE_M } from "./surfaceTextures";
import FurnitureModels, {
  type FurnitureModelReport,
} from "./furnitureModels";
import ProceduralFurniture, {
  type ProceduralFurnitureReport,
} from "./proceduralFurniture";
import RefinedSceneProbe, {
  REFINED_COLUMN_NAME,
  REFINED_FLOOR_NAME,
  REFINED_FURNITURE_BOX_NAME,
  REFINED_WALL_NAME,
  type RefinedDiagnostics,
} from "./RefinedSceneProbe";

interface RefinedSceneProps {
  polygon: FloorPolygon;
  walls: WallSegment[];
  columns: Column[];
  furniture: FurnitureItem[];
  venueSizeM?: number;
  // 選填:相機取景/gridHelper 尺寸的 fit 基準,與 venueSizeM(ground plane
  // 用)分離 — 預設回退到 venueSizeM,比照 VenueScene 的既有行為。
  viewFitSizeM?: number;
  /** 相機取景中心(公尺)。同 VenueScene —— 展位不再從原點展開。 */
  viewCenterM?: { x: number; y: number };
  /**
   * 全域牆高(公尺)。與步驟 02 讀同一份頂層 state —— 這一步是唯讀場景,
   * 不自己持有也不回寫,02↔03 的一致性靠這點保證。
   */
  wallHeightM: number;
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
    // AC2 按類別拆開的**件數**(不是 mesh 數 — 見 RefinedSceneProbe.tsx 的
    // 欄位註解:匯入模型後 mesh 數與家具件數已經不再相等)。
    "data-shadow-caster-wall-count": String(diagnostics.shadowCasterWallCount),
    "data-shadow-caster-column-count": String(diagnostics.shadowCasterColumnCount),
    "data-shadow-caster-furniture-count": String(
      diagnostics.shadowCasterFurnitureCount,
    ),
    // 牆/柱的**實際**幾何高度(公尺)。與 data-wall-height-m(設定值的回音)
    // 分開讀 —— 只有這兩個能證明幾何真的跟著設定值走。
    "data-wall-mesh-height-m":
      diagnostics.wallMeshHeightM === null
        ? undefined
        : String(diagnostics.wallMeshHeightM),
    "data-column-mesh-height-m":
      diagnostics.columnMeshHeightM === null
        ? undefined
        : String(diagnostics.columnMeshHeightM),
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
    "data-furniture-model-stats": JSON.stringify(diagnostics.furnitureModels),
    "data-procedural-furniture-stats": JSON.stringify(
      diagnostics.proceduralFurniture,
    ),
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
  wallHeightM: number;
  viewCenter: { x: number; y: number };
  bounds: PlanBounds;
  revision: number;
  probeResetKey: string;
  eagerLoaded: boolean;
  onEagerLoaded: () => void;
  onModelReport: (report: FurnitureModelReport) => void;
  onProceduralReport: (report: ProceduralFurnitureReport) => void;
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
  wallHeightM,
  viewCenter,
  bounds,
  revision,
  probeResetKey,
  eagerLoaded,
  onEagerLoaded,
  onModelReport,
  onProceduralReport,
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
        h: wallHeightM,
        d: WALL_THICKNESS_M,
        // D3: deterministic per-wall texture-phase offset so adjacent
        // walls sharing one material don't all start at the same phase.
        uOffset: hashStringToUnit(wall.id) * WALL_TILE_M,
      })),
    [walls, wallHeightM],
  );
  const columnSpecs = useMemo(
    () => columns.map((col) => ({ id: col.id, w: col.w, h: wallHeightM, d: col.h })),
    [columns, wallHeightM],
  );
  const wallGeometries = useMeterUvBoxGeometries(wallSpecs);
  const columnGeometries = useMeterUvBoxGeometries(columnSpecs);

  return (
    <>
      <HallLighting bounds={bounds} revision={revision} />
      <HallEnvironment />
      <RefinedSceneProbe resetKey={probeResetKey} onReport={onReport} />
      <OrbitControls
        makeDefault
        enableRotate
        enableZoom
        enablePan
        maxPolarAngle={Math.PI / 2 - 0.05}
        minDistance={5}
        maxDistance={150}
        target={[viewCenter.x, 0, viewCenter.y]}
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
              wallHeightM / 2,
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
            position={[col.center.x, wallHeightM / 2, col.center.y]}
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
      {/*
        有真實模型的六種家具走 GLB;沒有的三種(counter / bannerStand /
        podium)維持白模 box,等 task 6 的程序化幾何接手。兩者互斥,同一件
        家具不會被畫兩次。
      */}
      <Suspense fallback={null}>
        <FurnitureModels
          furniture={furniture}
          phase="eager"
          onReport={onModelReport}
        />
        <LoadedSignal onLoaded={onEagerLoaded} />
      </Suspense>
      {/*
        植栽單獨一批,而且要等 eager 那批就緒才掛 —— 它 GLB 1.32MB、原生
        96k 三角面,是其餘五個加起來的量級,同批會讓整個場景一起等它。
      */}
      {eagerLoaded && (
        <Suspense fallback={null}>
          <FurnitureModels
            furniture={furniture}
            phase="deferred"
            onReport={onModelReport}
          />
        </Suspense>
      )}
      {/*
        counter / bannerStand / podium 沒有 Poly Haven 資產,改由程序化幾何
        繪製(task 6)。它與匯入模型互斥,同一件家具不會被畫兩次。純幾何、
        零網路請求,所以不需要 <Suspense>。
      */}
      <ProceduralFurniture furniture={furniture} onReport={onProceduralReport} />
      {furniture.map((item) => {
        // 保底路徑:既沒有模型、也還沒給程序化造型的 kind(目前九種家具都有
        // 造型,所以正常情況下這裡不會產出任何東西)。留著是為了讓日後新增
        // 的 kind 至少畫得出來,而不是無聲消失。
        if (hasFurnitureModel(item.kind) || hasProceduralFurniture(item.kind)) {
          return null;
        }
        const defaults = FURNITURE_DEFAULTS[item.kind];
        return (
          <mesh
            key={item.id}
            name={REFINED_FURNITURE_BOX_NAME}
            position={[item.center.x, defaults.height3d / 2, item.center.y]}
            rotation={[0, (-item.rotationDeg * Math.PI) / 180, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[defaults.w, defaults.height3d, defaults.h]} />
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

/**
 * 在 `<Suspense>` 內側掛一個空元件:它自己不 suspend,所以只有等同層的
 * `useGLTF` 全部解完、整個 boundary 真的 commit 之後,它的 effect 才會跑。
 * 這比用 `onLoad` callback 可靠 —— drei 的載入是 Suspense 驅動的,沒有
 * 統一的完成事件。
 */
function LoadedSignal({ onLoaded }: { onLoaded: () => void }) {
  useEffect(() => {
    onLoaded();
  }, [onLoaded]);
  return null;
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
  viewCenterM,
  wallHeightM,
}: RefinedSceneProps) {
  const fit = viewFitSizeM ?? venueSizeM;
  const viewCenter = viewCenterM ?? { x: fit / 2, y: fit / 2 };

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
  const [eagerLoaded, setEagerLoaded] = useState(false);
  const [modelReports, setModelReports] = useState<
    Partial<Record<FurnitureKind, FurnitureModelReport>>
  >({});
  const [proceduralReports, setProceduralReports] = useState<
    Partial<Record<FurnitureKind, ProceduralFurnitureReport>>
  >({});

  const handleEagerLoaded = useCallback(() => setEagerLoaded(true), []);
  const handleModelReport = useCallback((report: FurnitureModelReport) => {
    setModelReports((prev) => {
      const existing = prev[report.kind];
      // 每幀都 setState 會讓 R3F 進無窮 render 迴圈 — 內容相同就原封不動
      // 回傳同一個物件,讓 React 跳過這次更新。
      if (existing && JSON.stringify(existing) === JSON.stringify(report)) {
        return prev;
      }
      return { ...prev, [report.kind]: report };
    });
  }, []);

  // 對外只吐「場上真的還有這個 kind」的量測 —— 家具被刪掉後,上一份報告會
  // 留在 modelReports 裡(元件卸載不會反向清),直接吐出去測試會讀到過期資料。
  //
  // 刻意不在 revision 變動時整批清空:eagerLoaded 一旦被重設,植栽就會
  // unmount 再 mount,而 AI 每動一次家具都會 bump revision。
  const handleProceduralReport = useCallback(
    (report: ProceduralFurnitureReport) => {
      setProceduralReports((prev) => {
        const existing = prev[report.kind];
        if (existing && JSON.stringify(existing) === JSON.stringify(report)) {
          return prev;
        }
        return { ...prev, [report.kind]: report };
      });
    },
    [],
  );

  const activeModelReports = useMemo(() => {
    const kinds = new Set(furniture.map((item) => item.kind));
    return Object.values(modelReports).filter((report) =>
      kinds.has(report.kind)
    );
  }, [modelReports, furniture]);

  // 與 activeModelReports 同理:家具被刪掉後,上一份報告會留在 state 裡。
  const activeProceduralReports = useMemo(() => {
    const kinds = new Set(furniture.map((item) => item.kind));
    return Object.values(proceduralReports).filter((report) =>
      kinds.has(report.kind)
    );
  }, [proceduralReports, furniture]);

  // 探針的重新武裝條件 = 幾何 revision + 「目前已經畫出來的模型是哪些」。
  // 後者是必要的:GLB 解碼是非同步的,家具的 InstancedMesh 往往在 revision
  // 那一次武裝(PROBE_ACTIVE_FRAMES 幀)之後才進場景圖,少了它探針會停在一份
  // 還沒有家具的過期快照(RefinedSceneProbe.tsx 的 resetKey 註解)。
  // 用 kind + partCount 而非 instanceCount:後者每動一次家具都變,但那種
  // 變動本來就已經 bump 了 revision。
  const probeResetKey = useMemo(() => {
    const signature = activeModelReports
      .map((report) => `${report.kind}:${report.partCount}`)
      .sort()
      .join(",");
    return `${revision}|${signature}`;
  }, [revision, activeModelReports]);

  return (
    <div
      data-testid="refined-scene"
      data-readonly="true"
      data-orbit-controls="true"
      data-wall-mesh-count={walls.length}
      data-column-mesh-count={columns.length}
      data-furniture-mesh-count={furniture.length}
      data-floor-vertex-count={polygon.length}
      data-wall-height-m={wallHeightM}
      data-materials-ready={String(materialsReady)}
      data-furniture-models-loaded={String(eagerLoaded)}
      data-furniture-model-reports={JSON.stringify(activeModelReports)}
      data-furniture-procedural-reports={JSON.stringify(activeProceduralReports)}
      {...diagnosticsAttrs(diagnostics)}
      className="mt-4 w-full"
    >
      <div className="relative h-[480px] w-full overflow-hidden rounded border border-stone-300 bg-stone-100">
        <Canvas
          shadows="variance"
          gl={REFINED_GL}
          camera={{
            position: [
              viewCenter.x + fit * 0.7,
              fit * 0.9,
              viewCenter.y + fit * 0.7,
            ],
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
              wallHeightM={wallHeightM}
              viewCenter={viewCenter}
              bounds={bounds}
              revision={revision}
              probeResetKey={probeResetKey}
              eagerLoaded={eagerLoaded}
              onEagerLoaded={handleEagerLoaded}
              onModelReport={handleModelReport}
              onProceduralReport={handleProceduralReport}
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
