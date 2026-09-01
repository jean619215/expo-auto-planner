"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Arrow, Circle, Layer, Line, Rect, Stage, Text } from "react-konva";
import type Konva from "konva";
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import {
  BOOTH_PRESETS,
  DEFAULT_BOOTH,
  DEFAULT_FLOOR,
  DEFAULT_WALL_HEIGHT_M,
  EMPTY_PLAN_BASELINE,
  GRID_MAJOR_M,
  MIN_FLOOR_VERTICES,
  planAreaFor,
  VENUE_SIZE_M,
  WALL_THICKNESS_M,
  clampColumnCenter,
  clampRectCenterToBounds,
  clampWallHeight,
  clampWallToBounds,
  columnBoundaryOffsetsM,
  columnCenterForOffsetM,
  computePxPerMeter,
  BOOTH_ORIGIN,
  createBoothFloor,
  createColumn,
  createObjectId,
  createWall,
  findClosestEdge,
  floorBoundsM,
  formatCentimeters,
  insertVertexOnEdge,
  isRectOutsideBounds,
  isWallOutsideBounds,
  metersToPx,
  moveVertex,
  moveWallEndpoint,
  pxToMeters,
  removeVertex,
  resizeColumnCorner,
  serializePlanSnapshot,
  snapPoint,
  SNAP_M,
  translateColumn,
  translateWall,
  wallLengthM,
  type BoundarySide,
  type Column,
  type FloorBounds,
  type FloorPolygon,
  type PlanPoint,
  type PlanSnapshot,
  type WallSegment,
} from "@/lib/venue/plan";
import {
  furnitureFootprintM,
  translateFurniture,
  type FurnitureItem,
} from "@/lib/venue/furniture";
import { catalogItem, subCategoryLabel } from "@/lib/venue/catalog";
import type {
  AiAction,
  AiActionResult,
  AiItemType,
} from "@/lib/ai-panel/actions";
import { fromStoredConversation } from "@/lib/ai-panel/messages";
import type { ChatTurn } from "./AiPanel";
import AiPanel from "./AiPanel";
import PlanSlotsDialog, { type LoadedPlan, type Slot } from "./PlanSlotsDialog";
import PlanToolbar, { segmentClassName, type EditorMode } from "./PlanToolbar";
import VenueSceneLoader from "./VenueSceneLoader";
import RefinedSceneLoader from "./RefinedSceneLoader";
import {
  DEFAULT_SURFACE_SELECTION,
  FLOOR_PRESETS,
  SURFACE_KEEP,
  SURFACE_WALL_DEFAULT,
  WALL_PRESETS,
  floorPreset,
  isFloorPresetId,
  isWallPresetId,
  normalizeSurfaceSelection,
  pruneWallOverrides,
  wallPreset,
  wallPresetIdFor,
  withWallOverride,
  type SurfaceSelection,
} from "@/lib/venue/surfacePresets";
import { EMPTY_SURFACE_UPLOADS, type SurfaceUploads } from "./SurfaceMaterials";
import SurfacePicker, { SurfaceSwatch } from "./SurfacePicker";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const MIN_STAGE_PX = 320;
const MAX_STAGE_PX = 800;
// 尺寸標註的顏色 —— 與圖面本身的藍圖色調刻意區隔,標註不是圖的一部分。
const DIMENSION_COLOR = "#dc2626";

// 上傳材質圖的大小上限。純前端預覽,沒有後端可以擋,所以這裡就是唯一的關卡。
const MAX_SURFACE_UPLOAD_BYTES = 8 * 1024 * 1024;

// 預設視圖 fit 尺寸(= VENUE_SIZE_M,與現行預設視覺逐像素一致的關鍵)。
const DEFAULT_VIEW_SIZE_M = VENUE_SIZE_M;
// 縮放下限固定 25%。可編輯範圍現在跟著攤位走(3×3 攤位只有 13×13m),不再
// 需要為了「看得到整個 200m 平面」而綁定範圍大小 —— 這個下限現在純粹是
// 使用者能縮多小的體感界線。
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
/**
 * 滾輪縮放的靈敏度(每一像素的 wheel delta 造成多少倍率)。
 *
 * 原本是「每次 wheel 事件固定乘 1.06」,**完全忽略 deltaY 的大小**。滑鼠一格
 * = 一次事件,那樣還好;但**觸控板一次滑動會送出數十次小 delta 的事件**,
 * 1.06^30 ≈ 5.7 倍 —— 輕輕一撥就從 100% 衝到 400%,也就是使用者回報的
 * 「縮放太敏感」。
 *
 * 0.0006 讓滑鼠一格(Chrome 的 deltaY≈100)仍是約 1.06 倍、手感不變,
 * 而觸控板的每次小 delta 只造成極小倍率,累積起來才是一次完整的縮放。
 */
const ZOOM_SENSITIVITY = 0.0006;

/** 單次 wheel 事件最多相當於多少像素。有些驅動會送出 deltaY > 1000。 */
const MAX_WHEEL_DELTA_PX = 150;

/** deltaMode 換算成像素:0=像素、1=行、2=頁。 */
const WHEEL_DELTA_PX_PER_MODE = [1, 16, 400];
const BUTTON_SCALE_FACTOR = 1.25;

type SelectedObject = {
  type: "wall" | "column" | "furniture";
  id: string;
} | null;
type WizardStep = "edit" | "preview" | "refined";

/**
 * 可編輯範圍上的 1m 格線。範圍是任意軸對齊矩形(不再是從原點起算的正方形),
 * 所以直線與橫線要各自照自己那一軸的公尺刻度跑,不能共用一個迴圈變數。
 *
 * 刻度對齊世界座標的整數公尺(而不是從 minX 起算),圖上的 5m 粗線才會落在
 * 5 的倍數上 —— 攤位錨在 20m,邊距 5m,minX 是 15,兩者剛好一致;之後邊距
 * 若改成非整數,粗線仍然對得上公尺刻度。
 */
/**
 * 網格的細分階梯(公尺)。**最細到 `SNAP_M`(0.5m)為止** —— 再細下去畫出來
 * 的格線對不到任何可以吸附的位置,那是在騙人:使用者會以為自己能對到那一格。
 */
const GRID_STEPS_M = [SNAP_M, 1, 2, 5, 10, 25, 50];

/**
 * 一格在螢幕上至少要幾像素。低於這個值格線就擠成一片灰。
 *
 * 12px 是挑出來的,不是隨手取的:預設縮放下畫布 800px 對 50m,一公尺剛好
 * 16px —— 門檻必須低於 16,**預設畫面才會維持現行的 1m/5m 網格**(門檻取
 * 18 會讓預設就跳成 2m 格,那是把「放大時更細」換成「平常變粗」)。同時要
 * 夠高,0.5m 格才不會在 1 倍附近就擠出來:12px 對應放大 1.5 倍才啟用。
 */
const MIN_GRID_PX = 12;

/**
 * 目前縮放層級該用的網格間距。
 *
 * 沒有這個的話,格線間距在**世界座標**是固定的 1m —— 放大兩倍,螢幕上的格子
 * 就變兩倍大,網格因此愈放大愈鬆、參考價值愈低;縮小時反過來擠成一片灰。
 * 製圖軟體的做法是讓**螢幕上的格子大小維持在一個區間**,放大時自動細分。
 *
 * 挑階梯裡第一個「在螢幕上夠大」的間距。粗線用階梯上再高一階,兩者的比例
 * 因此隨縮放改變(1m/5m、0.5m/1m 都可能),但視覺節奏維持一致。
 */
function gridStepsFor(pxPerScreenMeter: number): {
  minor: number;
  major: number;
} {
  const minorIndex = GRID_STEPS_M.findIndex(
    (step) => step * pxPerScreenMeter >= MIN_GRID_PX,
  );
  // 全部都太小(縮到極限)時退回最粗的一階,而不是畫出幾千條線。
  const index = minorIndex === -1 ? GRID_STEPS_M.length - 1 : minorIndex;
  return {
    minor: GRID_STEPS_M[index],
    major: GRID_STEPS_M[Math.min(index + 2, GRID_STEPS_M.length - 1)],
  };
}

/**
 * 網格的兩種色階。
 *
 * 可編輯範圍**之外**也畫網格(否則縮小時圖紙會浮在一片空白裡),但那塊放不了
 * 東西 —— 顏色因此要更淡:「看得出是同一張方格紙」但「不會誤以為能擺在那裡」。
 */
type GridPalette = { minor: string; major: string };
const GRID_PALETTE: GridPalette = { minor: "#e7e5e4", major: "#d6d3d1" };
const CANVAS_GRID_PALETTE: GridPalette = { minor: "#e6e3e0", major: "#d8d4d0" };

function buildGridLines(
  pxPerMeter: number,
  area: FloorBounds,
  steps: { minor: number; major: number },
  palette: GridPalette,
  keyPrefix: string,
) {
  const lines: {
    key: string;
    points: number[];
    stroke: string;
    strokeWidth: number;
  }[] = [];

  const { minor: minorM, major: majorM } = steps;

  const x0 = area.minX * pxPerMeter;
  const x1 = area.maxX * pxPerMeter;
  const y0 = area.minY * pxPerMeter;
  const y1 = area.maxY * pxPerMeter;

  for (
    let m = Math.ceil(area.minX / minorM) * minorM;
    m <= area.maxX;
    m += minorM
  ) {
    // 浮點數:0.5 的倍數累加會產生 20.999999…,直接取模會判錯粗線。
    const isMajor = Math.abs(m / majorM - Math.round(m / majorM)) < 1e-9;
    const pos = m * pxPerMeter;
    lines.push({
      key: `${keyPrefix}v-${m}`,
      points: [pos, y0, pos, y1],
      stroke: isMajor ? palette.major : palette.minor,
      strokeWidth: isMajor ? 1.5 : 1,
    });
  }

  for (
    let m = Math.ceil(area.minY / minorM) * minorM;
    m <= area.maxY;
    m += minorM
  ) {
    const isMajor = Math.abs(m / majorM - Math.round(m / majorM)) < 1e-9;
    const pos = m * pxPerMeter;
    lines.push({
      key: `${keyPrefix}h-${m}`,
      points: [x0, pos, x1, pos],
      stroke: isMajor ? palette.major : palette.minor,
      strokeWidth: isMajor ? 1.5 : 1,
    });
  }

  return lines;
}

/**
 * 拖曳時的網格預留量,以「幾個視窗寬」計。
 *
 * 平移**只在放手時**寫回 `view`(拖曳過程由 Konva 自己搬 Stage,不進 React,
 * 這是刻意的:每一幀都 setState 會讓整個編輯器重繪)。代價是拖曳中網格範圍
 * 不會跟著長,拖到邊緣就會露出空白。多畫一圈視窗的量把這件事蓋掉 —— 單一
 * 手勢很難拖超過一個視窗寬,放手後範圍也立刻重算。
 */
const CANVAS_PAN_BUFFER = 1;

/**
 * 目前**看得到**的世界範圍(公尺),外加拖曳預留量。
 *
 * 螢幕 → 世界的反變換:先扣掉 Stage 位移、除以縮放得到世界像素,再除以
 * `pxPerMeter`。縮小時這塊會長大,網格因此跟著延伸 —— 這正是使用者要的
 * 「縮小就延伸畫布範圍」,而不是讓圖紙浮在一片空白中間。
 */
function visibleAreaFor(
  stagePx: number,
  pxPerMeter: number,
  view: { scale: number; x: number; y: number },
): FloorBounds {
  const toMeters = (screenPx: number, offset: number) =>
    (screenPx - offset) / view.scale / pxPerMeter;
  const minX = toMeters(0, view.x);
  const maxX = toMeters(stagePx, view.x);
  const minY = toMeters(0, view.y);
  const maxY = toMeters(stagePx, view.y);
  const padX = (maxX - minX) * CANVAS_PAN_BUFFER;
  const padY = (maxY - minY) * CANVAS_PAN_BUFFER;
  return {
    minX: minX - padX,
    maxX: maxX + padX,
    minY: minY - padY,
    maxY: maxY + padY,
    widthM: maxX - minX + padX * 2,
    heightM: maxY - minY + padY * 2,
  };
}

/** 座標尺上的 5m 標籤刻度(世界座標整數公尺)。 */
function majorTicks(min: number, max: number): number[] {
  const ticks: number[] = [];
  for (
    let m = Math.ceil(min / GRID_MAJOR_M) * GRID_MAJOR_M;
    m <= max;
    m += GRID_MAJOR_M
  ) {
    ticks.push(m);
  }
  return ticks;
}

const WIZARD_STEPS: { step: WizardStep; no: string; label: string }[] = [
  { step: "edit", no: "01", label: "繪製平面圖" },
  { step: "preview", no: "02", label: "預覽 3D 場景" },
  { step: "refined", no: "03", label: "精密 3D" },
];

// 圖紙頁籤式步驟指示:等寬字大號編號 + 粗藍底線標記當前步,
// 整條底線同時作為版面分隔線。
function StepProgress({ current }: { current: WizardStep }) {
  return (
    <ol
      data-testid="step-progress"
      className="mb-4 flex max-w-xl gap-7 border-b-2 border-line"
    >
      {WIZARD_STEPS.map((s) => {
        const isCurrent = s.step === current;
        return (
          <li
            key={s.step}
            className={
              "relative flex items-baseline gap-2 pb-2.5 " +
              (isCurrent ? "text-blueprint" : "text-muted-foreground")
            }
          >
            <span className="font-mono text-xl tracking-tight">{s.no}</span>
            <span className={"text-sm " + (isCurrent ? "font-bold" : "")}>
              {s.label}
            </span>
            {isCurrent && (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 -bottom-0.5 h-[3px] bg-blueprint"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function angleDegrees(start: PlanPoint, end: PlanPoint): number {
  return (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
}

function targetName(
  e: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
): string {
  return typeof e.target.name === "function" ? e.target.name() : "";
}

export default function PlanEditor() {
  // Stage 寬度量測目標:左欄 wrapper(僅 step === "edit" 時存在),而非最
  // 外層容器 — AiPanel 側欄改為 flex sibling 後,若仍量外層寬度,
  // 側欄展開時 Stage 不會跟著縮,造成水平溢出。
  const editorColumnRef = useRef<HTMLDivElement | null>(null);
  const [stagePx, setStagePx] = useState(MIN_STAGE_PX);
  // Stage 顯示層 transform(zoom/pan)— 純顯示,不落存檔、不進 plan.ts
  // 任何運算。與 pxPerMeter(公尺→世界像素)是相乘的兩層,互不覆蓋。
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  /**
   * 標註文字的反向縮放。
   *
   * Stage 縮放時,圖形要跟著放大(那是使用者要的「比例的放大」),但**標註
   * 文字應該維持螢幕尺寸** —— 尺寸數字、「地板」這種標籤放大之後會蓋住圖形,
   * 縮小之後又看不清楚,兩端都變難用。這是製圖軟體的慣例。
   *
   * 做法是給文字節點一個 1/scale 的反向縮放:字形淨縮放為 1(維持
   * fontSize 指定的螢幕像素),而 x/y 仍在世界座標、跟著圖形跑。
   * offsetX/offsetY 在節點自己的座標系裡,同樣被反向縮放抵消,所以既有的
   * 置中偏移不需要改。
   */
  const labelScale = 1 / view.scale;

  // 線寬也維持螢幕尺寸(`strokeScaleEnabled={false}` 加在每個有 stroke 的
  // 形狀上),控制點的圓圈同樣反向縮放。放大時線跟著變粗、控制點跟著變大,
  // 圖面會愈放大愈糊,而且控制點會蓋住它自己要指的那個角落 —— 使用者放大
  // 正是為了看清楚細節。這是製圖軟體的慣例:**幾何按比例,註記與操作點
  // 維持定值**。
  //
  // 控制點反向縮放還有一個實際好處:點擊判定範圍也跟著維持螢幕尺寸,所以
  // 縮到很小時控制點不會變得難以點中。
  // mousedown 命中判定(是否命中 Stage 本身 = 真正空白處)供 onDragStart
  // 判斷是否放行 Stage 的 pan drag。
  const panBlockedRef = useRef(false);
  const [polygon, setPolygon] = useState<FloorPolygon>(DEFAULT_FLOOR);
  /**
   * 攤位本身的外接矩形 —— 可編輯範圍的錨。
   *
   * **刻意不從 `polygon` 即時推導。** 推導過的版本會在拖曳頂點時失控:範圍
   * 跟著地板長大,長大的範圍又允許把地板拖得更遠,一次 8 步的拖曳就從 3m
   * 攤位跑到 40m 外。範圍必須錨在「使用者選定的攤位尺寸」這個穩定的東西上,
   * 只在真正重新定義攤位時才更新(換 preset / 自訂尺寸 / 讀檔 / AI 產生),
   * 頂點的自由編輯則在那圈邊距內活動。
   */
  const [boothBounds, setBoothBounds] = useState(() =>
    floorBoundsM(DEFAULT_FLOOR),
  );
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);

  const [mode, setMode] = useState<EditorMode>("select");
  const [walls, setWalls] = useState<WallSegment[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [furniture, setFurniture] = useState<FurnitureItem[]>([]);
  // 全域牆高(公尺)。牆與柱共用,步驟 02 可調、步驟 03 唯讀跟隨 —— 兩個
  // 場景讀的是這一份,不各自持有,否則 02↔03 會出現不一致的高度。
  const [wallHeightM, setWallHeightM] = useState(DEFAULT_WALL_HEIGHT_M);
  // 換展位尺寸的待確認狀態:非 null 表示對話框開著,值就是使用者選的尺寸。
  const [pendingBoothSize, setPendingBoothSize] = useState<{
    w: number;
    h: number;
  } | null>(null);
  // 步驟 03 的地板/牆面材質選擇。與牆高同理:state owner 在這裡,場景唯讀。
  const [surfaces, setSurfaces] = useState<SurfaceSelection>(
    DEFAULT_SURFACE_SELECTION,
  );
  // 使用者上傳的材質圖。刻意只活在瀏覽器裡:blob URL,不進存檔、不上傳
  // 後端、重整就沒了 —— 這一輪的需求是「上傳材質來預覽」,持久化另立
  // story(需要新的上傳 API、檔案驗證、RLS 與配額)。
  const [surfaceUploads, setSurfaceUploads] = useState<SurfaceUploads>(
    EMPTY_SURFACE_UPLOADS,
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  // 步驟 03 的材質側欄開合。與步驟 02 的側欄一致:預設展開,收合後只留切換鈕。
  const [refinedSidebarOpen, setRefinedSidebarOpen] = useState(true);
  const [customBooth, setCustomBooth] = useState({
    w: String(DEFAULT_BOOTH.w),
    h: String(DEFAULT_BOOTH.h),
  });
  const [selectedObject, setSelectedObject] = useState<SelectedObject>(null);
  const [draftWall, setDraftWall] = useState<{
    start: PlanPoint;
    end: PlanPoint;
  } | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<"start" | "end" | null>(
    null,
  );
  const [draggingColumnCorner, setDraggingColumnCorner] = useState<{
    x: -1 | 1;
    y: -1 | 1;
  } | null>(null);
  const suppressObjectClickRef = useRef(false);
  // AiPanel 的 handleSend 跨一次 await(等待 /api/ai/chat 回應)才呼叫
  // applyActions;等待期間使用者仍可繼續手動編輯 2D 畫布。若 applyActions
  // 直接讀取 render 當下 closure 住的 polygon/walls/columns/furniture,
  // 套用時會用「送出當下」的舊快照整批覆蓋,吃掉等待中的手動編輯。改用
  // 每次 render 後同步更新的 ref,讓 applyActions 呼叫當下永遠讀到最新
  // committed state。
  const polygonRef = useRef(polygon);
  const wallsRef = useRef(walls);
  const columnsRef = useRef(columns);
  const furnitureRef = useRef(furniture);
  // 材質同理:AI 也能改它(set_surfaces),而使用者可能在等回應時自己先動了
  // 步驟 03 的選單。少了這個 ref,套用時會拿送出當下的舊選擇覆蓋回去。
  const surfacesRef = useRef(surfaces);
  useEffect(() => {
    polygonRef.current = polygon;
    wallsRef.current = walls;
    columnsRef.current = columns;
    furnitureRef.current = furniture;
    surfacesRef.current = surfaces;
  });
  // 是否已按過「下一步」— 純 gate(是否可渲染 preview/3D 場景),不再是
  // 幾何複本。3D 場景的幾何一律直接讀頂層 polygon/walls/columns/furniture
  // (見 architect-plan.md D1)。
  const [sceneGenerated, setSceneGenerated] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [step, setStep] = useState<WizardStep>("edit");

  // 存檔 UI(Task 3)—— state 歸屬見 architect-plan.md D2。
  const [slotsDialogOpen, setSlotsDialogOpen] = useState(false);
  const [currentSlot, setCurrentSlot] = useState<Slot | null>(null);
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);
  const [savedBaseline, setSavedBaseline] = useState<string | null>(null);
  const [conversationSeed, setConversationSeed] = useState<{
    seq: number;
    turns: ChatTurn[];
  } | null>(null);

  useEffect(() => {
    const column = editorColumnRef.current;
    if (!column || step !== "edit") return;

    const updateSize = () => {
      const width = column.clientWidth;
      setStagePx(Math.max(MIN_STAGE_PX, Math.min(MAX_STAGE_PX, width)));
    };

    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(column);
    return () => observer.disconnect();
  }, [step]);

  // 數值同現行預設(DEFAULT_VIEW_SIZE_M = VENUE_SIZE_M)— 預設視覺不變的
  // 關鍵:zoom/pan 是後面 Stage transform 這一層,與此無關。
  const pxPerMeter = computePxPerMeter(stagePx, DEFAULT_VIEW_SIZE_M);
  /**
   * 可編輯範圍 —— 由 `boothBounds` 外擴一圈邊距,前端所有 clamp 的依據。
   *
   * 錨的是 `boothBounds`(使用者選定的攤位尺寸),**不是** `polygon`(地板現況)。
   * 兩者平時相等,但拖曳頂點只動 `polygon`,`boothBounds` 只在四個地方重錨:
   * 初始化、讀檔、AI 重畫整塊地板、`applyBoothSize`。
   *
   * 這份看似重複的 state 不能省。改成從 `polygon` 即時推導會構成回饋迴圈:
   * 拖大地板 → 範圍跟著變大 → 更大的範圍允許把頂點拖得更遠。實測一次 8 步
   * 拖曳就把 3m 攤位拉到 40m 外。詳見 `planAreaFor` 的註解。
   */
  const planArea = useMemo(
    () =>
      planAreaFor(boothBounds.widthM, boothBounds.heightM, {
        x: boothBounds.minX,
        y: boothBounds.minY,
      }),
    [boothBounds],
  );
  // 判斷依據是**螢幕上**的一公尺有多少像素 —— 世界像素再乘上 Stage 縮放。
  // 只看 pxPerMeter 的話縮放完全不會影響網格,等於沒做。
  const gridSteps = useMemo(
    () => gridStepsFor(pxPerMeter * view.scale),
    [pxPerMeter, view.scale],
  );
  /** 目前看得到的世界範圍 —— 網格與底色鋪滿的依據,縮小時跟著長大。 */
  const canvasArea = useMemo(
    () => visibleAreaFor(stagePx, pxPerMeter, view),
    [stagePx, pxPerMeter, view],
  );
  /** 可編輯範圍**之外**的淡色網格。 */
  const canvasGridLines = useMemo(
    () =>
      buildGridLines(
        pxPerMeter,
        canvasArea,
        gridSteps,
        CANVAS_GRID_PALETTE,
        "c-",
      ),
    [pxPerMeter, canvasArea, gridSteps],
  );
  /** 可編輯範圍內的網格。畫在圖紙底色之上,所以蓋過同位置的淡色線。 */
  const gridLines = useMemo(
    () => buildGridLines(pxPerMeter, planArea, gridSteps, GRID_PALETTE, ""),
    [pxPerMeter, planArea, gridSteps],
  );
  /**
   * 探針:網格在螢幕上的實際格距(px)。
   *
   * 量的是**畫出去的那一份** `gridLines` —— 取相鄰兩條垂直線的世界座標距離,
   * 再乘上 Stage 縮放。不回報 `gridStepsFor()` 的輸入或輸出:那只會確認我們
   * 把常數傳對了,不會確認畫面真的細分了(AGENTS.md:探針不得是 prop 的回音)。
   */
  const gridMinorPx = useMemo(() => {
    const xs = gridLines
      .filter((line) => line.key.startsWith("v-"))
      .map((line) => line.points[0])
      .sort((a, b) => a - b);
    if (xs.length < 2) return 0;
    return (xs[1] - xs[0]) * view.scale;
  }, [gridLines, view.scale]);

  // Konva 官方滾輪錨點縮放食譜:以 anchor(螢幕座標系下的一點)為中心縮放,
  // 該點縮放前後的螢幕位置不變。newScale 靜默 clamp 到 [MIN_SCALE,
  // MAX_SCALE];NaN/超界一律靜默收斂,不拋錯不重置整個 Stage。
  function zoomTo(rawScale: number, anchor: { x: number; y: number }) {
    const oldScale = view.scale;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, rawScale));
    if (!Number.isFinite(newScale) || newScale === oldScale) return;
    const worldPoint = {
      x: (anchor.x - view.x) / oldScale,
      y: (anchor.y - view.y) / oldScale,
    };
    setView({
      scale: newScale,
      x: anchor.x - worldPoint.x * newScale,
      y: anchor.y - worldPoint.y * newScale,
    });
  }

  function handleWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    // 刻意用螢幕座標版 getPointerPosition()(不是
    // getRelativePointerPosition())— 錨點公式在螢幕座標系運算,是全檔
    // 唯一保留處(其餘互動一律遷移到 getRelativePointerPosition())。
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    // deltaMode 先正規化成像素:Firefox 常用「行」(一格 deltaY≈3),Chrome
    // 用像素(一格≈100)。不換算的話同一個手勢在兩個瀏覽器差三十倍。
    const perUnit = WHEEL_DELTA_PX_PER_MODE[e.evt.deltaMode] ?? 1;
    const deltaPx = e.evt.deltaY * perUnit;
    const clamped = Math.max(
      -MAX_WHEEL_DELTA_PX,
      Math.min(MAX_WHEEL_DELTA_PX, deltaPx),
    );
    // 指數而非線性:縮放在感知上是乘法的,而且 exp 恆正,倍率不可能翻號或歸零。
    zoomTo(view.scale * Math.exp(-clamped * ZOOM_SENSITIVITY), pointer);
  }

  function resetView() {
    setView({ scale: 1, x: 0, y: 0 });
  }

  function handleStageDragStart(e: Konva.KonvaEventObject<DragEvent>) {
    const stage = e.target.getStage();
    if (e.target === stage && panBlockedRef.current) {
      stage?.stopDrag();
    }
  }

  function handleStageDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
    if (e.target !== e.target.getStage()) return;
    setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }));
  }

  // --- 存檔 UI(Task 3):快照 / dirty 判定 / 讀檔套用 -----------------------

  function getSnapshot(): PlanSnapshot {
    return {
      polygon,
      walls,
      columns,
      furniture,
      venueSizeM: planArea.widthM,
      wallHeightM,
      // 存檔前丟掉已刪除的牆留下的覆寫 —— 否則存檔會慢慢累積查不到對象的
      // 設定,而 dirty 判定(序列化比對)也會因為這些幽靈欄位而誤報。
      surfaces: pruneWallOverrides(
        surfaces,
        walls.map((wall) => wall.id),
      ),
    };
  }

  // 序列化比對,不做逐操作 dirty flag(取捨見 architect-plan.md D5)。僅在
  // 讀檔前呼叫;存檔不檢查。
  function isDirty(): boolean {
    return (
      serializePlanSnapshot(getSnapshot()) !==
      (savedBaseline ?? EMPTY_PLAN_BASELINE)
    );
  }

  // 讀檔套用(architect-plan.md D4)。呼叫時機為 PlanSlotsDialog 的
  // GET /api/plans/[slot] 200 之後;非 200 情境該元件不會呼叫此函式,原地
  // 狀態不丟。
  function applyLoadedPlan(data: LoadedPlan) {
    // rawPlan.venueSizeM(舊存檔任意值:40/50/200/缺欄位)一律忽略 — 可編輯
    // 範圍由讀進來的 polygon 重新錨定攤位,天然涵蓋「舊檔相容 +
    // 缺欄位 fallback 不崩潰」,無需 fallback 分支。
    const rawPlan = data.plan as {
      polygon?: FloorPolygon;
      walls?: WallSegment[];
      columns?: Column[];
      furniture?: FurnitureItem[];
      wallHeightM?: number;
      surfaces?: {
        floor?: string;
        wall?: string;
        wallOverrides?: Record<string, string>;
      };
    };
    const loadedPolygon = rawPlan.polygon ?? DEFAULT_FLOOR;
    const loadedWalls = rawPlan.walls ?? [];
    const loadedColumns = rawPlan.columns ?? [];
    const loadedFurniture = rawPlan.furniture ?? [];
    // 缺欄位的舊存檔一律回預設牆高 —— 決議是舊檔作廢、不寫遷移,但讀到
    // 舊檔也不該炸,clampWallHeight 對 undefined 會回 DEFAULT_WALL_HEIGHT_M。
    const loadedWallHeightM = clampWallHeight(rawPlan.wallHeightM as number);
    // 缺欄位或存了不存在的 preset id 時,normalizeSurfaceSelection 會回第一個
    // 選項,所以這裡不需要額外的驗證分支。逐面牆的覆寫(T9)再過一次 prune:
    // 存檔裡可能留著已經不存在的牆,那些設定沒有對象,留著只會在下一次畫牆
    // 撞上同一個 id 時冒出來歷不明的材質。
    const loadedSurfaces = pruneWallOverrides(
      normalizeSurfaceSelection(rawPlan.surfaces ?? {}),
      loadedWalls.map((wall) => wall.id),
    );

    setPolygon(loadedPolygon);
    setBoothBounds(floorBoundsM(loadedPolygon));
    setWalls(loadedWalls);
    setColumns(loadedColumns);
    setFurniture(loadedFurniture);
    setWallHeightM(loadedWallHeightM);
    setSurfaces(loadedSurfaces);
    // 上一份圖的自訂圖不能跟著留下來:blob URL 綁的是上一份圖的牆 id,留著
    // 會貼到剛讀進來、恰好同 id 的牆上。上傳本來就不進存檔(第二輪決議)。
    setSurfaceUploads(EMPTY_SURFACE_UPLOADS);
    setSelectedObject(null);
    setSelectedVertex(null);

    setCurrentSlot(data.slot);
    setCurrentPlanId(data.planId);
    setConversationSeed((prev) => ({
      seq: (prev?.seq ?? 0) + 1,
      turns: fromStoredConversation(data.conversation),
    }));
    setSavedBaseline(
      serializePlanSnapshot({
        polygon: loadedPolygon,
        walls: loadedWalls,
        columns: loadedColumns,
        furniture: loadedFurniture,
        venueSizeM: planArea.widthM,
        wallHeightM: loadedWallHeightM,
        surfaces: loadedSurfaces,
      }),
    );
  }

  function handleSlotSaved(slot: Slot, planId: string) {
    setCurrentSlot(slot);
    setCurrentPlanId(planId);
    setSavedBaseline(serializePlanSnapshot(getSnapshot()));
  }

  function handleSlotDeleted(slot: Slot) {
    // 刪除的正是目前讀檔中的格:清空 currentSlot/currentPlanId,但不動畫布
    // 或 AiPanel turns(architect-plan.md D7)。
    if (slot === currentSlot) {
      setCurrentSlot(null);
      setCurrentPlanId(null);
    }
  }

  function handleVertexDragMove(
    index: number,
    e: Konva.KonvaEventObject<DragEvent>,
  ) {
    const node = e.target;
    const meterPoint = pxToMeters({ x: node.x(), y: node.y() }, pxPerMeter);
    const next = moveVertex(polygon, index, meterPoint, planArea);
    setPolygon(next);
    const snappedPx = metersToPx(next[index], pxPerMeter);
    node.position(snappedPx);
  }

  function handleVertexDragEnd(
    index: number,
    e: Konva.KonvaEventObject<DragEvent>,
  ) {
    const node = e.target;
    const meterPoint = pxToMeters({ x: node.x(), y: node.y() }, pxPerMeter);
    const next = moveVertex(polygon, index, meterPoint, planArea);
    setPolygon(next);
    const snappedPx = metersToPx(next[index], pxPerMeter);
    node.position(snappedPx);
  }

  function handleEdgeDblClick(e: Konva.KonvaEventObject<MouseEvent>) {
    const stage = e.target.getStage();
    const pointer = stage?.getRelativePointerPosition();
    if (!pointer) return;

    const meterPoint: PlanPoint = pxToMeters(pointer, pxPerMeter);
    const { edgeIndex, distance } = findClosestEdge(polygon, meterPoint);
    // 只有點在邊附近 (0.5m 內) 才插入頂點 — 點在多邊形內部深處不動作。
    if (distance > 0.5) return;
    const next = insertVertexOnEdge(polygon, edgeIndex, meterPoint, planArea);
    setPolygon(next);
  }

  function handleVertexContextMenu(
    index: number,
    e: Konva.KonvaEventObject<PointerEvent>,
  ) {
    e.evt.preventDefault();
    const next = removeVertex(polygon, index);
    if (next === polygon) return; // 3 頂點下限,刪除被拒
    setPolygon(next);
    // 刪除成功後,比被刪索引大的選取要往前位移,否則 Delete 鍵會刪錯點。
    setSelectedVertex((current) => {
      if (current === null || current === index) return null;
      return current > index ? current - 1 : current;
    });
  }

  function deleteSelectedObject() {
    if (selectedObject === null) return;
    if (selectedObject.type === "wall") {
      setWalls((prev) => prev.filter((w) => w.id !== selectedObject.id));
    } else if (selectedObject.type === "column") {
      setColumns((prev) => prev.filter((c) => c.id !== selectedObject.id));
    } else {
      setFurniture((prev) => prev.filter((f) => f.id !== selectedObject.id));
    }
    setSelectedObject(null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Delete" && e.key !== "Backspace") return;

    // 物件選取優先於地板頂點選取,避免同一次按鍵同時觸發兩種刪除邏輯。
    if (selectedObject !== null) {
      deleteSelectedObject();
      return;
    }

    if (selectedVertex !== null) {
      const next = removeVertex(polygon, selectedVertex);
      setPolygon(next);
      setSelectedVertex(null);
    }
  }

  function handleNextStep() {
    setSceneGenerated(true);
    setGeneration((g) => g + 1);
    setStep("preview");
    // 進入 Step 2 前清除既有選取。
    //
    // 原本的理由是「防止殘留選取在 Step 2 被鍵盤誤刪」—— 那個前提在
    // feedback round 2 T2 之後不成立了:Step 2 現在本來就能刪東西,而且
    // 用的是 VenueScene 自己的選取狀態,不是這裡的 selectedObject。
    //
    // 行為保留的是新的理由:跨畫面帶著選取,會讓進到 Step 2 之後第一次
    // 按 Delete 的目標變得不明確 —— 使用者看到的是 3D 場景,腦中記得的
    // 卻是 2D 裡選的那個東西。要刪就在 Step 2 重新點一次。
    setSelectedObject(null);
    setSelectedVertex(null);
  }

  // VenueScene 的手動 3D 編輯(拖曳/旋轉/放置家具)上報。直接寫回頂層
  // state(唯一資料源,D1)—— 並比照 applyActions 尾段 eager 同步 ref:
  // 若 AI 回應在這次 setState 之後、下一次 render 的 useEffect ref 同步
  // 之前到達,applyActions 讀 ref 仍必須拿到含這次 3D 手動編輯的最新值,
  // 否則會被 AI 的舊 ref 快照整批覆蓋掉剛做的手動編輯。
  function handleSceneChange(next: {
    walls: WallSegment[];
    columns: Column[];
    furniture: FurnitureItem[];
  }) {
    setWalls(next.walls);
    setColumns(next.columns);
    setFurniture(next.furniture);
    wallsRef.current = next.walls;
    columnsRef.current = next.columns;
    furnitureRef.current = next.furniture;
  }

  function handleBackToEdit() {
    setStep("edit");
  }

  function handleToRefined() {
    setStep("refined");
  }

  function handleBackToPreview() {
    setStep("preview");
  }

  function markObjectClickSuppressed() {
    // 建立物件的那次放開滑鼠,若剛好落在既有同類型物件上,Konva 會緊接著
    // 對該舊物件觸發一次 click,把選取改回舊物件。標記忽略「下一次」
    // click;若這次建立其實是拖曳手勢(不會有後續 click),則用 timeout
    // 作為保險,避免旗標卡在 true 而誤吃掉之後真正的選取點擊。
    suppressObjectClickRef.current = true;
    setTimeout(() => {
      suppressObjectClickRef.current = false;
    }, 0);
  }

  function handleModeChange(next: EditorMode) {
    setMode(next);
    setDraftWall(null);
    // 切換到牆壁/柱子模式時清除既有選取,避免殘留選取物件在新模式下
    // 仍可被拖拉,導致繪製手勢被 Konva 誤判成拖動舊物件。
    if (next !== "select") {
      setSelectedObject(null);
    }
  }

  function handleStageMouseDown(
    e: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ) {
    const stage = e.target.getStage();
    // pan 區隔機制的命中判定:記錄本次 mousedown 是否命中 Stage 本身
    // (真正空白處)。子節點(地板/物件/頂點/把手)命中時 e.target !== stage,
    // 之後 onDragStart 會依此攔掉「按在非空白處卻拖動 Stage」的 pan。
    panBlockedRef.current = e.target !== stage;
    const pointer = stage?.getRelativePointerPosition();
    if (!pointer) return;
    const meterPoint = pxToMeters(pointer, pxPerMeter);

    if (mode === "wall") {
      const snapped = snapPoint(meterPoint, planArea);
      setDraftWall({ start: snapped, end: snapped });
      return;
    }

    if (mode === "select" && targetName(e) !== "object") {
      setSelectedObject(null);
    }
  }

  function handleStageMouseMove(
    e: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ) {
    if (mode !== "wall" || !draftWall) return;
    const stage = e.target.getStage();
    const pointer = stage?.getRelativePointerPosition();
    if (!pointer) return;
    const meterPoint = pxToMeters(pointer, pxPerMeter);
    const snapped = snapPoint(meterPoint, planArea);
    setDraftWall({ start: draftWall.start, end: snapped });
  }

  function handleStageMouseUp(
    e: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ) {
    if (mode === "wall") {
      if (draftWall) {
        const wall = createWall(draftWall.start, draftWall.end, planArea);
        if (wall) {
          setWalls((prev) => [...prev, wall]);
          setSelectedObject({ type: "wall", id: wall.id });
          setSelectedVertex(null);
          setMode("select");
          markObjectClickSuppressed();
        }
      }
      setDraftWall(null);
      return;
    }

    if (mode === "column") {
      const stage = e.target.getStage();
      const pointer = stage?.getRelativePointerPosition();
      if (!pointer) return;
      const meterPoint = pxToMeters(pointer, pxPerMeter);
      const column = createColumn(meterPoint, planArea);
      setColumns((prev) => [...prev, column]);
      setSelectedObject({ type: "column", id: column.id });
      setSelectedVertex(null);
      setMode("select");
      markObjectClickSuppressed();
    }
  }

  function handleWallBodyDrag(
    wall: WallSegment,
    e: Konva.KonvaEventObject<DragEvent>,
  ) {
    const node = e.target;
    const originPx = metersToPx(wall.start, pxPerMeter);
    const deltaPx = { x: node.x() - originPx.x, y: node.y() - originPx.y };
    const deltaM = pxToMeters(deltaPx, pxPerMeter);
    const updated = translateWall(wall, deltaM, planArea);
    setWalls((prev) => prev.map((w) => (w.id === wall.id ? updated : w)));
    const snappedPx = metersToPx(updated.start, pxPerMeter);
    node.position(snappedPx);
  }

  function handleColumnBodyDrag(
    column: Column,
    e: Konva.KonvaEventObject<DragEvent>,
  ) {
    const node = e.target;
    const originPx = metersToPx(column.center, pxPerMeter);
    const deltaPx = { x: node.x() - originPx.x, y: node.y() - originPx.y };
    const deltaM = pxToMeters(deltaPx, pxPerMeter);
    const updated = translateColumn(column, deltaM, planArea);
    setColumns((prev) => prev.map((c) => (c.id === column.id ? updated : c)));
    const snappedPx = metersToPx(updated.center, pxPerMeter);
    node.position(snappedPx);
  }

  function handleWallEndpointDrag(
    wall: WallSegment,
    which: "start" | "end",
    e: Konva.KonvaEventObject<DragEvent>,
  ) {
    const node = e.target;
    const meterPoint = pxToMeters({ x: node.x(), y: node.y() }, pxPerMeter);
    const updated = moveWallEndpoint(wall, which, meterPoint, planArea);
    setWalls((prev) => prev.map((w) => (w.id === wall.id ? updated : w)));
    const snappedPx = metersToPx(updated[which], pxPerMeter);
    node.position(snappedPx);
  }

  function handleColumnCornerDrag(
    column: Column,
    corner: { x: -1 | 1; y: -1 | 1 },
    e: Konva.KonvaEventObject<DragEvent>,
  ) {
    const node = e.target;
    const meterPoint = pxToMeters({ x: node.x(), y: node.y() }, pxPerMeter);
    const updated = resizeColumnCorner(column, corner, meterPoint, planArea);
    setColumns((prev) => prev.map((c) => (c.id === column.id ? updated : c)));
    const cornerMeter = {
      x: updated.center.x + (corner.x * updated.w) / 2,
      y: updated.center.y + (corner.y * updated.h) / 2,
    };
    const snappedPx = metersToPx(cornerMeter, pxPerMeter);
    node.position(snappedPx);
  }

  function itemTypeLabel(type: AiItemType): string {
    if (type === "wall") return "牆壁";
    if (type === "column") return "柱子";
    return "家具";
  }

  function normalizeRotationDeg(deg: number): number {
    const wrapped = deg % 360;
    return wrapped < 0 ? wrapped + 360 : wrapped;
  }

  // AI 面板 tool call 執行層(AC3)。逐一套用到本地變數,最後一次性
  // setState,避免同一批 actions 內多個操作互相踩到彼此的 stale 狀態
  // (React state 更新非同步,不能在迴圈內連續讀舊的 walls/columns/furniture)。
  //
  // 種子值一律從 ref 讀(見上方 polygonRef 等宣告),不是直接讀
  // polygon/walls/columns/furniture 這幾個 state 變數 — applyActions 是
  // AiPanel 送出 /api/ai/chat 後、跨一次 await 才在回應到達時被呼叫,
  // 若讀 render-time closure 住的 state,套用的會是「使用者點送出當下」
  // 的舊快照,吃掉等待期間任何手動編輯。ref 由 useEffect 每次 render 後
  // 同步更新,呼叫當下永遠是最新 committed state。
  function applyActions(actions: AiAction[]): AiActionResult[] {
    const results: AiActionResult[] = [];
    let nextPolygon = polygonRef.current;
    let nextWalls = wallsRef.current;
    let nextColumns = columnsRef.current;
    let nextFurniture = furnitureRef.current;
    let nextSurfaces = surfacesRef.current;

    for (const action of actions) {
      switch (action.type) {
        case "generate_plan": {
          const floorPoints = action.input.floor.map((p) =>
            snapPoint(p, planArea),
          );
          // snapPoint 會把超出可編輯範圍的座標**夾到邊界上**,而那對多邊形是
          // 毀滅性的:兩個都超界的頂點會被夾到同一個角落,形狀直接塌掉。
          //
          // 2026-08-31 實際發生:模型畫的正六角形頂點在 (24..36, 25..35),而
          // 預設攤位的可編輯範圍只有 [15,28] —— 兩個頂點疊成一點,六角形變成
          // 一個歪掉的三角形,而工具卻回報「已產生配置:6 頂點地板」。
          // 使用者被告知成功了。
          const clampedVertexCount = action.input.floor.filter(
            (p, i) =>
              Math.abs(p.x - floorPoints[i].x) > SNAP_M / 2 ||
              Math.abs(p.y - floorPoints[i].y) > SNAP_M / 2,
          ).length;
          if (floorPoints.length < MIN_FLOOR_VERTICES) {
            results.push({
              toolUseId: action.toolUseId,
              ok: false,
              message: `地板頂點不足 ${MIN_FLOOR_VERTICES} 點,已跳過產生配置`,
            });
            break;
          }
          const generatedWalls = action.input.walls
            .map((w) => createWall(w.start, w.end, planArea))
            .filter((w): w is WallSegment => w !== null);
          const generatedColumns: Column[] = action.input.columns.map((c) => ({
            id: createObjectId(),
            center: clampColumnCenter(
              snapPoint(c.center, planArea),
              c.w,
              c.h,
              planArea,
            ),
            w: c.w,
            h: c.h,
          }));
          // 目錄代碼是模型送來的自由字串(schema 不用 enum,理由見
          // src/lib/ai/tools.ts)。查不到的代碼跳過該件、記下來,其餘照放 ——
          // 一件寫錯不該讓整份配置生不出來。
          const unknownCodes: string[] = [];
          const generatedFurniture: FurnitureItem[] = [];
          for (const f of action.input.furniture) {
            const entry = catalogItem(f.code);
            if (!entry) {
              unknownCodes.push(f.code);
              continue;
            }
            generatedFurniture.push({
              id: createObjectId(),
              code: entry.code,
              center: clampColumnCenter(
                snapPoint(f.center, planArea),
                entry.w,
                entry.d,
                planArea,
              ),
              rotationDeg: normalizeRotationDeg(f.rotationDeg),
            });
          }
          nextPolygon = floorPoints;
          nextWalls = generatedWalls;
          nextColumns = generatedColumns;
          nextFurniture = generatedFurniture;
          setSelectedObject(null);
          setSelectedVertex(null);

          const parts = [`${floorPoints.length} 頂點地板`];
          if (generatedWalls.length > 0)
            parts.push(`${generatedWalls.length} 面牆`);
          if (generatedColumns.length > 0)
            parts.push(`${generatedColumns.length} 根柱子`);
          if (generatedFurniture.length > 0)
            parts.push(`${generatedFurniture.length} 件家具`);
          const skipped =
            unknownCodes.length > 0
              ? `;${unknownCodes.length} 件家具的代碼不在目錄裡,已跳過(${unknownCodes.join("、")})`
              : "";
          // 有頂點被夾就一定要說。模型看得到這句話,才有機會用範圍內的座標
          // 重畫;使用者也才知道畫面上的形狀為什麼跟他要的不一樣。
          const clamped =
            clampedVertexCount > 0
              ? `;⚠ ${clampedVertexCount} 個地板頂點超出可編輯範圍` +
                `(x ${planArea.minX}~${planArea.maxX}、y ${planArea.minY}~${planArea.maxY} 公尺),` +
                `已被移到邊界上,形狀與你的設計不同。請改用範圍內的座標重畫`
              : "";
          results.push({
            toolUseId: action.toolUseId,
            ok: true,
            message: `已產生配置:${parts.join("、")}${skipped}${clamped}`,
          });
          break;
        }
        case "add_furniture": {
          // 代碼查不到就拒絕這一個 action,並繼續處理同一批的其他 action ——
          // 與 move_item / remove_item 的「已跳過」模式一致。
          const entry = catalogItem(action.input.code);
          if (!entry) {
            results.push({
              toolUseId: action.toolUseId,
              ok: false,
              message: `代碼 ${action.input.code} 不在家具目錄裡,已跳過新增`,
            });
            break;
          }
          const item: FurnitureItem = {
            id: createObjectId(),
            code: entry.code,
            center: clampColumnCenter(
              snapPoint(action.input.center, planArea),
              entry.w,
              entry.d,
              planArea,
            ),
            rotationDeg: normalizeRotationDeg(action.input.rotationDeg),
          };
          nextFurniture = [...nextFurniture, item];
          results.push({
            toolUseId: action.toolUseId,
            ok: true,
            message: `已新增${subCategoryLabel(entry.subCategory)}`,
          });
          break;
        }
        case "move_item": {
          const { itemType, index, center } = action.input;
          if (itemType === "wall") {
            if (index < 0 || index >= nextWalls.length) {
              results.push({
                toolUseId: action.toolUseId,
                ok: false,
                message: `第 ${index} 個牆壁不存在,已跳過移動`,
              });
              break;
            }
            const wall = nextWalls[index];
            const mid = {
              x: (wall.start.x + wall.end.x) / 2,
              y: (wall.start.y + wall.end.y) / 2,
            };
            const updated = translateWall(
              wall,
              { x: center.x - mid.x, y: center.y - mid.y },
              planArea,
            );
            nextWalls = nextWalls.map((w, i) => (i === index ? updated : w));
          } else if (itemType === "column") {
            if (index < 0 || index >= nextColumns.length) {
              results.push({
                toolUseId: action.toolUseId,
                ok: false,
                message: `第 ${index} 個柱子不存在,已跳過移動`,
              });
              break;
            }
            const col = nextColumns[index];
            const updated = translateColumn(
              col,
              { x: center.x - col.center.x, y: center.y - col.center.y },
              planArea,
            );
            nextColumns = nextColumns.map((c, i) =>
              i === index ? updated : c,
            );
          } else {
            if (index < 0 || index >= nextFurniture.length) {
              results.push({
                toolUseId: action.toolUseId,
                ok: false,
                message: `第 ${index} 件家具不存在,已跳過移動`,
              });
              break;
            }
            const item = nextFurniture[index];
            const updated = translateFurniture(
              item,
              { x: center.x - item.center.x, y: center.y - item.center.y },
              planArea,
            );
            nextFurniture = nextFurniture.map((f, i) =>
              i === index ? updated : f,
            );
          }
          results.push({
            toolUseId: action.toolUseId,
            ok: true,
            message: `已移動${itemTypeLabel(itemType)}`,
          });
          break;
        }
        case "remove_item": {
          const { itemType, index } = action.input;
          if (itemType === "wall") {
            if (index < 0 || index >= nextWalls.length) {
              results.push({
                toolUseId: action.toolUseId,
                ok: false,
                message: `第 ${index} 個牆壁不存在,已跳過刪除`,
              });
              break;
            }
            nextWalls = nextWalls.filter((_, i) => i !== index);
          } else if (itemType === "column") {
            if (index < 0 || index >= nextColumns.length) {
              results.push({
                toolUseId: action.toolUseId,
                ok: false,
                message: `第 ${index} 個柱子不存在,已跳過刪除`,
              });
              break;
            }
            nextColumns = nextColumns.filter((_, i) => i !== index);
          } else {
            if (index < 0 || index >= nextFurniture.length) {
              results.push({
                toolUseId: action.toolUseId,
                ok: false,
                message: `第 ${index} 件家具不存在,已跳過刪除`,
              });
              break;
            }
            nextFurniture = nextFurniture.filter((_, i) => i !== index);
          }
          results.push({
            toolUseId: action.toolUseId,
            ok: true,
            message: `已刪除${itemTypeLabel(itemType)}`,
          });
          break;
        }
        case "resize_floor": {
          const points = action.input.points.map((p) => snapPoint(p, planArea));
          if (points.length < MIN_FLOOR_VERTICES) {
            results.push({
              toolUseId: action.toolUseId,
              ok: false,
              message: `地板頂點不足 ${MIN_FLOOR_VERTICES} 點,已跳過調整地板`,
            });
            break;
          }
          nextPolygon = points;
          results.push({
            toolUseId: action.toolUseId,
            ok: true,
            message: `已調整地板形狀(${points.length} 頂點)`,
          });
          break;
        }
        case "set_surfaces": {
          const { floor, wall, wallOverrides } = action.input;
          const applied: string[] = [];
          const skipped: string[] = [];

          // 逐項明確檢查,不走 floorPreset()/wallPreset() —— 那兩支查不到會
          // 退回第一款,模型送了不存在的款式時使用者會拿到水泥地板,而工具
          // 回報成功。同一類 bug 讓六角形塌成三角形過一次了。
          if (floor !== SURFACE_KEEP) {
            if (isFloorPresetId(floor)) {
              nextSurfaces = { ...nextSurfaces, floor };
              applied.push(`地板→${floorPreset(floor).label}`);
            } else {
              skipped.push(`地板款式「${floor}」不在可用清單中`);
            }
          }
          if (wall !== SURFACE_KEEP) {
            if (isWallPresetId(wall)) {
              nextSurfaces = { ...nextSurfaces, wall };
              applied.push(`預設牆面→${wallPreset(wall).label}`);
            } else {
              skipped.push(`牆面款式「${wall}」不在可用清單中`);
            }
          }
          for (const override of wallOverrides ?? []) {
            const target = nextWalls[override.index];
            if (!target) {
              skipped.push(`牆 #${override.index} 不存在`);
              continue;
            }
            if (override.preset === SURFACE_WALL_DEFAULT) {
              nextSurfaces = withWallOverride(nextSurfaces, target.id, null);
              applied.push(`牆 #${override.index}→跟隨預設`);
              continue;
            }
            if (!isWallPresetId(override.preset)) {
              skipped.push(
                `牆 #${override.index} 的款式「${override.preset}」不在可用清單中`,
              );
              continue;
            }
            nextSurfaces = withWallOverride(
              nextSurfaces,
              target.id,
              override.preset,
            );
            applied.push(
              `牆 #${override.index}→${wallPreset(override.preset).label}`,
            );
          }

          if (applied.length === 0 && skipped.length === 0) {
            // 三個欄位都是 keep + 空陣列。不是錯誤,但也什麼都沒發生 ——
            // 說出來,否則模型會以為自己改了東西。
            results.push({
              toolUseId: action.toolUseId,
              ok: true,
              message: "材質未變更(三項都指定維持現狀)",
            });
            break;
          }
          const parts = [];
          if (applied.length > 0) parts.push(`已設定材質:${applied.join("、")}`);
          if (skipped.length > 0) parts.push(`已跳過:${skipped.join("、")}`);
          results.push({
            toolUseId: action.toolUseId,
            ok: applied.length > 0,
            message: parts.join(";"),
          });
          break;
        }
      }
    }

    // 比對/寫回都用 ref(不是 state 變數)— 同一個 applyActions 呼叫可能
    // 早於下一次 render 的 useEffect 就再被呼叫一次(例如同一輪回應內
    // 連續兩個 tool_use),eager 更新 ref 確保這種情況下第二次呼叫仍看得到
    // 第一次呼叫剛寫入的結果,而不是等到 effect 才同步的舊值。
    if (nextPolygon !== polygonRef.current) {
      setPolygon(nextPolygon);
      // AI 換掉整塊地板 = 重新定義攤位,範圍跟著重錨。
      setBoothBounds(floorBoundsM(nextPolygon));
      polygonRef.current = nextPolygon;
    }
    if (nextWalls !== wallsRef.current) {
      setWalls(nextWalls);
      wallsRef.current = nextWalls;
    }
    if (nextColumns !== columnsRef.current) {
      setColumns(nextColumns);
      columnsRef.current = nextColumns;
    }
    if (nextFurniture !== furnitureRef.current) {
      setFurniture(nextFurniture);
      furnitureRef.current = nextFurniture;
    }
    // 牆被換掉(generate_plan)之後,舊牆留下的個別材質設定指向已不存在的
    // id。不清掉的話存檔會累積孤兒設定,更糟的是新牆萬一拿到同一個 id,
    // 會突然套上前一面牆的材質。
    const prunedSurfaces =
      nextWalls === wallsRef.current
        ? nextSurfaces
        : pruneWallOverrides(
            nextSurfaces,
            nextWalls.map((wall) => wall.id),
          );
    if (prunedSurfaces !== surfacesRef.current) {
      setSurfaces(prunedSurfaces);
      surfacesRef.current = prunedSurfaces;
    }

    return results;
  }

  const polygonPx = polygon.flatMap((p) => {
    const px = metersToPx(p, pxPerMeter);
    return [px.x, px.y];
  });

  const thicknessPx = WALL_THICKNESS_M * pxPerMeter;

  const selectedWall =
    selectedObject?.type === "wall"
      ? (walls.find((w) => w.id === selectedObject.id) ?? null)
      : null;

  const selectedColumn =
    selectedObject?.type === "column"
      ? (columns.find((c) => c.id === selectedObject.id) ?? null)
      : null;

  const columnLabelText = selectedColumn
    ? `${Math.round(selectedColumn.w * 100)} × ${Math.round(selectedColumn.h * 100)}cm`
    : "";

  const wallLabelText = selectedWall
    ? formatCentimeters(wallLengthM(selectedWall))
    : "";

  // 場地邊界(地板外接矩形)與選取柱子到四邊的距離。顯示層一律公分整數,
  // 運算仍是公尺。
  const floorBounds = floorBoundsM(polygon);
  const venueSizeCm = {
    width: Math.round(floorBounds.widthM * 100),
    height: Math.round(floorBounds.heightM * 100),
  };
  const columnOffsetsM = selectedColumn
    ? columnBoundaryOffsetsM(selectedColumn, floorBounds)
    : null;
  const columnOffsetsCm = columnOffsetsM
    ? {
        left: Math.round(columnOffsetsM.left * 100),
        right: Math.round(columnOffsetsM.right * 100),
        top: Math.round(columnOffsetsM.top * 100),
        bottom: Math.round(columnOffsetsM.bottom * 100),
      }
    : null;

  // --- R1 展位尺寸 -------------------------------------------------------
  //
  // 換尺寸會把地板換成以 BOOTH_ORIGIN 為左上角的矩形。原本擺在外圍的柱子/
  // 家具/牆會落到新場地外,所以先數出件數;有東西會被搬動就先問過使用者,
  // 沒有就直接套用(不為了「一致」而多一個沒有資訊量的對話框)。
  /**
   * 換攤位尺寸後會落在**可編輯範圍**外的物件數。
   *
   * 量的是可編輯範圍而不是攤位本身:攤位外那圈邊距是合法的暫存區(見
   * `PLAN_AREA_MARGIN_M`),擺在那裡的東西沒有「超出」。攤位縮小時範圍跟著
   * 縮,原本在邊距裡的東西才可能真的被擠出去 —— 那才是要提示的情況。
   */
  /**
   * 每件家具的平面矩形(公尺)。**繪製與探針共用同一份**——分開算就會有一份
   * 「回報的尺寸」與一份「畫出來的尺寸」,而那正是這一輪要消滅的東西。
   */
  const furnitureRects = useMemo(
    () =>
      furniture.map((item) => ({
        id: item.id,
        ...furnitureFootprintM(item),
      })),
    [furniture],
  );

  /**
   * 家具的矩形視圖(`center` + 目錄查來的 `w`/`h`)。
   *
   * `isRectOutsideBounds` / `clampRectCenterToBounds` 吃的是「有寬高的矩形」,
   * 而家具現在只存代碼 —— 這裡把查表收在一處,免得每個呼叫點各自展開一次。
   */
  function furnitureRect(item: FurnitureItem) {
    const { w, h } = furnitureFootprintM(item);
    return { center: item.center, w, h };
  }

  function outsideCountFor(widthM: number, heightM: number): number {
    const nextArea = planAreaFor(widthM, heightM);
    return (
      columns.filter((c) => isRectOutsideBounds(c, nextArea)).length +
      furniture.filter((f) => isRectOutsideBounds(furnitureRect(f), nextArea))
        .length +
      walls.filter((w) => isWallOutsideBounds(w, nextArea)).length
    );
  }

  function applyBoothSize(widthM: number, heightM: number) {
    const nextPolygon = createBoothFloor(widthM, heightM);
    // 夾進新的可編輯範圍(攤位 + 邊距),不是夾進攤位 —— 否則本來刻意放在
    // 邊距暫存區的家具會在改尺寸時被一起吸回攤位裡。
    const nextArea = planAreaFor(widthM, heightM);

    setPolygon(nextPolygon);
    setBoothBounds(floorBoundsM(nextPolygon));
    setColumns((prev) =>
      prev.map((c) => ({ ...c, center: clampRectCenterToBounds(c, nextArea) })),
    );
    setFurniture((prev) =>
      prev.map((f) => ({
        ...f,
        center: clampRectCenterToBounds(furnitureRect(f), nextArea),
      })),
    );
    setWalls((prev) => prev.map((w) => clampWallToBounds(w, nextArea)));
    setSelectedVertex(null);
    fitViewTo(widthM, heightM);
  }

  /** 把視圖縮放/平移到剛好框住新場地(留一成邊距)。 */
  function fitViewTo(widthM: number, heightM: number) {
    const longest = Math.max(widthM, heightM);
    if (!(longest > 0)) return;
    const rawScale = (stagePx * 0.9) / (longest * pxPerMeter);
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, rawScale));
    const centerPx = metersToPx(
      { x: BOOTH_ORIGIN.x + widthM / 2, y: BOOTH_ORIGIN.y + heightM / 2 },
      pxPerMeter,
    );
    setView({
      scale,
      x: stagePx / 2 - centerPx.x * scale,
      y: stagePx / 2 - centerPx.y * scale,
    });
  }

  function requestBoothSize(widthM: number, heightM: number) {
    if (!(widthM > 0) || !(heightM > 0)) return;
    if (outsideCountFor(widthM, heightM) > 0) {
      setPendingBoothSize({ w: widthM, h: heightM });
      return;
    }
    applyBoothSize(widthM, heightM);
  }

  // R6:上傳材質圖。只接受圖片、只接受 8MB 以內 —— 兩者都在前端擋下,
  // 因為這條路徑根本不碰後端,沒有第二道關卡可以依賴。
  function handleSurfaceUpload(surface: "floor" | "wall", file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setUploadError("只接受圖片檔");
      return;
    }
    if (file.size > MAX_SURFACE_UPLOAD_BYTES) {
      setUploadError("圖片超過 8MB");
      return;
    }
    setUploadError(null);
    setSurfaceUploads((prev) => {
      // 換掉舊的就把舊的 blob URL 釋放,否則整個 session 會一直累積。
      if (prev[surface]) URL.revokeObjectURL(prev[surface]!);
      return { ...prev, [surface]: URL.createObjectURL(file) };
    });
  }

  function clearSurfaceUpload(surface: "floor" | "wall") {
    setSurfaceUploads((prev) => {
      if (prev[surface]) URL.revokeObjectURL(prev[surface]!);
      return { ...prev, [surface]: null };
    });
  }

  /** 某一面牆自己的自訂圖(T9)。驗證與釋放的規則與上面那組完全相同。 */
  function handleWallSurfaceUpload(wallId: string, file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setUploadError("只接受圖片檔");
      return;
    }
    if (file.size > MAX_SURFACE_UPLOAD_BYTES) {
      setUploadError("圖片超過 8MB");
      return;
    }
    setUploadError(null);
    setSurfaceUploads((prev) => {
      if (prev.walls[wallId]) URL.revokeObjectURL(prev.walls[wallId]);
      return {
        ...prev,
        walls: { ...prev.walls, [wallId]: URL.createObjectURL(file) },
      };
    });
  }

  function clearWallSurfaceUpload(wallId: string) {
    setSurfaceUploads((prev) => {
      if (!prev.walls[wallId]) return prev;
      URL.revokeObjectURL(prev.walls[wallId]);
      const walls = { ...prev.walls };
      delete walls[wallId];
      return { ...prev, walls };
    });
  }

  // R2:用輸入的公分值精確定位柱子。負值與非數字直接拒絕(柱子不動),
  // 其餘由 columnCenterForOffsetM 夾在場地內。
  function setColumnOffsetCm(side: BoundarySide, cm: number) {
    if (!selectedColumn) return;
    if (!Number.isFinite(cm) || cm < 0) return;
    const nextCenter = columnCenterForOffsetM(
      selectedColumn,
      floorBounds,
      side,
      cm / 100,
    );
    setColumns((prev) =>
      prev.map((c) =>
        c.id === selectedColumn.id ? { ...c, center: nextCenter } : c,
      ),
    );
  }

  // 3D 場景的取景基準:對著實際地板,而不是固定的 50m 原點視角。展位
  // preset 之後地板不再從原點展開,沿用舊的 fit/2 會讓畫面中心落在地板外
  // ——「在 3D 內點地板放家具」會整個失效。
  const sceneFit = {
    sizeM: Math.max(4, floorBounds.widthM, floorBounds.heightM),
    center: {
      x: (floorBounds.minX + floorBounds.maxX) / 2,
      y: (floorBounds.minY + floorBounds.maxY) / 2,
    },
  };

  const edgeLabelTexts = polygon.map((vertex, i) => {
    const next = polygon[(i + 1) % polygon.length];
    return formatCentimeters(Math.hypot(next.x - vertex.x, next.y - vertex.y));
  });

  const floorCentroidPx = metersToPx(
    {
      x: polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length,
      y: polygon.reduce((sum, p) => sum + p.y, 0) / polygon.length,
    },
    pxPerMeter,
  );

  return (
    <div
      data-testid="plan-editor"
      data-vertex-count={polygon.length}
      data-vertices={JSON.stringify(polygon)}
      data-px-per-meter={pxPerMeter}
      data-stage-size={stagePx}
      data-mode={mode}
      data-wall-count={walls.length}
      data-column-count={columns.length}
      data-furniture-count={furniture.length}
      data-selected-id={selectedObject?.id ?? ""}
      data-selected-type={selectedObject?.type ?? ""}
      data-objects={JSON.stringify({ walls, columns })}
      data-furniture={JSON.stringify(furniture)}
      data-furniture-rects={JSON.stringify(furnitureRects)}
      data-column-label={columnLabelText}
      data-wall-label={wallLabelText}
      data-edge-labels={JSON.stringify(edgeLabelTexts)}
      data-venue-size-cm={JSON.stringify(venueSizeCm)}
      data-plan-area-w-m={planArea.widthM}
      data-plan-area-h-m={planArea.heightM}
      data-plan-area={JSON.stringify(planArea)}
      data-grid-line-count={gridLines.length}
      data-grid-minor-px={gridMinorPx}
      data-canvas-grid-line-count={canvasGridLines.length}
      data-canvas-area={JSON.stringify(canvasArea)}
      data-plan-surfaces={JSON.stringify(surfaces)}
      data-column-offsets-cm={
        columnOffsetsCm ? JSON.stringify(columnOffsetsCm) : undefined
      }
      data-scene-generated={sceneGenerated}
      data-generation={generation}
      data-step={step}
      data-current-slot={currentSlot ?? ""}
      data-current-plan-id={currentPlanId ?? ""}
      data-stage-scale={view.scale}
      data-stage-x={view.x}
      data-stage-y={view.y}
      className="w-full outline-none"
    >
      <StepProgress current={step} />
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          {step === "edit" && (
            <div
              data-testid="step-edit"
              tabIndex={0}
              onKeyDown={handleKeyDown}
              className="outline-none"
            >
              <div ref={editorColumnRef}>
                <div className="mb-2 flex items-center gap-2">
                  <PlanToolbar
                    mode={mode}
                    onModeChange={handleModeChange}
                    canDelete={selectedObject !== null}
                    onDelete={deleteSelectedObject}
                  />
                  <div
                    className="inline-flex h-[34px] overflow-hidden rounded-md border-[1.5px] border-blueprint bg-card"
                    role="group"
                  >
                    <button
                      type="button"
                      data-testid="zoom-out-button"
                      onClick={() =>
                        zoomTo(view.scale / BUTTON_SCALE_FACTOR, {
                          x: stagePx / 2,
                          y: stagePx / 2,
                        })
                      }
                      className={segmentClassName}
                    >
                      <ZoomOut />
                    </button>
                    <span
                      data-testid="zoom-level"
                      className={segmentClassName + " tabular-nums"}
                    >
                      {Math.round(view.scale * 100)}%
                    </span>
                    <button
                      type="button"
                      data-testid="zoom-in-button"
                      onClick={() =>
                        zoomTo(view.scale * BUTTON_SCALE_FACTOR, {
                          x: stagePx / 2,
                          y: stagePx / 2,
                        })
                      }
                      className={segmentClassName}
                    >
                      <ZoomIn />
                    </button>
                    <button
                      type="button"
                      data-testid="zoom-reset-button"
                      onClick={resetView}
                      className={segmentClassName}
                    >
                      <Maximize />
                    </button>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    data-testid="plan-slots-button"
                    onClick={() => setSlotsDialogOpen(true)}
                    className="h-[34px]"
                  >
                    我的存檔
                  </Button>
                  <Button
                    type="button"
                    data-testid="next-step-button"
                    onClick={handleNextStep}
                    className="ml-auto h-[34px]"
                  >
                    下一步
                  </Button>
                </div>
                <div
                  data-testid="booth-size-bar"
                  className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-stone-300 bg-card px-2 py-1.5 text-xs"
                >
                  <span className="font-bold text-muted-foreground">
                    展位尺寸
                  </span>
                  {BOOTH_PRESETS.map((preset) => (
                    <Button
                      key={`${preset.w}x${preset.h}`}
                      type="button"
                      size="sm"
                      variant="outline"
                      data-testid={`booth-preset-${preset.w}x${preset.h}`}
                      onClick={() => requestBoothSize(preset.w, preset.h)}
                      className="h-7 px-2"
                    >
                      {preset.w}×{preset.h}m
                    </Button>
                  ))}
                  <label className="flex items-center gap-1 text-muted-foreground">
                    自訂
                    <input
                      type="number"
                      data-testid="booth-custom-width-input"
                      min={1}
                      step={0.5}
                      value={customBooth.w}
                      onChange={(e) =>
                        setCustomBooth((prev) => ({
                          ...prev,
                          w: e.target.value,
                        }))
                      }
                      className="w-14 rounded border border-stone-300 bg-card px-1 py-0.5 text-right text-foreground"
                    />
                    ×
                    <input
                      type="number"
                      data-testid="booth-custom-height-input"
                      min={1}
                      step={0.5}
                      value={customBooth.h}
                      onChange={(e) =>
                        setCustomBooth((prev) => ({
                          ...prev,
                          h: e.target.value,
                        }))
                      }
                      className="w-14 rounded border border-stone-300 bg-card px-1 py-0.5 text-right text-foreground"
                    />
                    m
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    data-testid="booth-custom-apply"
                    onClick={() =>
                      requestBoothSize(
                        Number(customBooth.w),
                        Number(customBooth.h),
                      )
                    }
                    className="h-7 px-2"
                  >
                    套用
                  </Button>
                </div>
                {selectedColumn && columnOffsetsCm && (
                  <div
                    data-testid="column-offset-panel"
                    className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-stone-300 bg-card px-2 py-1.5 text-xs"
                  >
                    <span className="font-bold text-muted-foreground">
                      柱子定位
                    </span>
                    {(
                      [
                        ["left", "左"],
                        ["right", "右"],
                        ["top", "上"],
                        ["bottom", "下"],
                      ] as [BoundarySide, string][]
                    ).map(([side, label]) => (
                      <label
                        key={side}
                        className="flex items-center gap-1 text-muted-foreground"
                      >
                        {label}
                        <input
                          type="number"
                          data-testid={`column-offset-${side}-input`}
                          min={0}
                          step={1}
                          // key 綁目前值:拖曳或改另一邊之後,輸入框要跟著
                          // 更新成新的實際距離,而不是留著使用者上次打的字。
                          key={`${selectedColumn.id}-${side}-${columnOffsetsCm[side]}`}
                          defaultValue={columnOffsetsCm[side]}
                          onBlur={(e) =>
                            setColumnOffsetCm(side, e.target.valueAsNumber)
                          }
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            setColumnOffsetCm(
                              side,
                              e.currentTarget.valueAsNumber,
                            );
                          }}
                          className="w-20 rounded border border-stone-300 bg-card px-1 py-0.5 text-right text-foreground"
                        />
                        cm
                      </label>
                    ))}
                    <span
                      data-testid="column-offset-hint"
                      className="text-muted-foreground"
                    >
                      輸入值不受 50cm 吸附限制;之後拖曳以 50cm
                      為單位移動,會保留這個尾數
                    </span>
                  </div>
                )}
                {/*
                  畫布外框。步驟 02 的 3D 場景一直有一個有邊界的容器,步驟 01
                  的 Stage 卻是裸的 —— 縮放平移之後很容易失去方位感:畫布裡
                  雖然有可編輯範圍的矩形,但那個矩形本身也會跟著跑掉,於是
                  「我現在在看哪裡」沒有任何固定參考點。
                */}
                <div
                  data-testid="plan-canvas-frame"
                  className="w-fit overflow-hidden rounded border border-stone-300 bg-card"
                >
                <Stage
                  width={stagePx}
                  height={stagePx}
                  scaleX={view.scale}
                  scaleY={view.scale}
                  x={view.x}
                  y={view.y}
                  draggable={mode === "select"}
                  onWheel={handleWheel}
                  onDragStart={handleStageDragStart}
                  onDragEnd={handleStageDragEnd}
                  onMouseDown={handleStageMouseDown}
                  onMouseMove={handleStageMouseMove}
                  onMouseUp={handleStageMouseUp}
                  onTouchStart={handleStageMouseDown}
                  onTouchMove={handleStageMouseMove}
                  onTouchEnd={handleStageMouseUp}
                >
                  <Layer listening={false}>
                    {/*
                      圖紙外的畫布。縮小時 canvasArea 會長大,底色與淡網格
                      跟著鋪滿 —— 圖紙不再浮在一片空白裡。畫在圖紙之前,
                      所以圖紙的不透明底色會蓋掉範圍內的淡線。
                    */}
                    <Rect
                      x={canvasArea.minX * pxPerMeter}
                      y={canvasArea.minY * pxPerMeter}
                      width={canvasArea.widthM * pxPerMeter}
                      height={canvasArea.heightM * pxPerMeter}
                      fill="#f4f3f1"
                    />
                    {canvasGridLines.map((line) => (
                      <Line
                        strokeScaleEnabled={false}
                        key={line.key}
                        points={line.points}
                        stroke={line.stroke}
                        strokeWidth={line.strokeWidth}
                      />
                    ))}
                    <Rect
                      strokeScaleEnabled={false}
                      x={planArea.minX * pxPerMeter}
                      y={planArea.minY * pxPerMeter}
                      width={planArea.widthM * pxPerMeter}
                      height={planArea.heightM * pxPerMeter}
                      // 圖紙是白的、周圍是淺灰 —— 可編輯範圍與範圍外的分界
                      // 靠這個色差撐著。周圍鋪上網格之後,原本的 #fafaf9
                      // 與底色只差三階,圖紙的邊界等於消失了。
                      fill="#ffffff"
                      stroke="#a8a29e"
                      strokeWidth={1.5}
                    />
                    {gridLines.map((line) => (
                      <Line
                        strokeScaleEnabled={false}
                        key={line.key}
                        points={line.points}
                        stroke={line.stroke}
                        strokeWidth={line.strokeWidth}
                      />
                    ))}
                  </Layer>
                  <Layer listening={false}>
                    {majorTicks(planArea.minX, planArea.maxX).map((m) => (
                      <Text
                        scaleX={labelScale}
                        scaleY={labelScale}
                        key={`label-top-${m}`}
                        x={m * pxPerMeter + 2}
                        y={2}
                        text={String(m)}
                        fontSize={12}
                        fill="#78716c"
                      />
                    ))}
                    {majorTicks(planArea.minY, planArea.maxY).map((m) => (
                      <Text
                        scaleX={labelScale}
                        scaleY={labelScale}
                        key={`label-left-${m}`}
                        x={2}
                        y={m * pxPerMeter + 2}
                        text={String(m)}
                        fontSize={12}
                        fill="#78716c"
                      />
                    ))}
                    <Line
                      strokeScaleEnabled={false}
                      points={[
                        8,
                        stagePx - 16,
                        8 + GRID_MAJOR_M * pxPerMeter,
                        stagePx - 16,
                      ]}
                      stroke="#44403c"
                      strokeWidth={2}
                    />
                    <Text
                      scaleX={labelScale}
                      scaleY={labelScale}
                      x={8}
                      y={stagePx - 14}
                      text="5 公尺"
                      fontSize={12}
                      fill="#44403c"
                    />
                  </Layer>
                  <Layer listening={mode === "select"}>
                    <Line
                      strokeScaleEnabled={false}
                      points={polygonPx}
                      closed
                      fill="rgba(191, 219, 254, 0.5)"
                      stroke="#1F4E79"
                      strokeWidth={2}
                      onDblClick={handleEdgeDblClick}
                    />
                    <Text
                      scaleX={labelScale}
                      scaleY={labelScale}
                      listening={false}
                      x={floorCentroidPx.x}
                      y={floorCentroidPx.y}
                      text="地板"
                      fontSize={13}
                      fontStyle="bold"
                      fill="#1F4E79"
                      offsetX={13}
                      offsetY={7}
                    />
                    {polygon.map((vertex, index) => {
                      const px = metersToPx(vertex, pxPerMeter);
                      return (
                        <Circle
                          scaleX={labelScale}
                          scaleY={labelScale}
                          strokeScaleEnabled={false}
                          key={index}
                          x={px.x}
                          y={px.y}
                          radius={6}
                          fill={
                            selectedVertex === index ? "#1F4E79" : "#ffffff"
                          }
                          stroke="#1F4E79"
                          strokeWidth={2}
                          hitStrokeWidth={16}
                          draggable
                          onClick={() => {
                            setSelectedVertex(index);
                            setSelectedObject(null);
                          }}
                          onTap={() => {
                            setSelectedVertex(index);
                            setSelectedObject(null);
                          }}
                          onDragMove={(e) => handleVertexDragMove(index, e)}
                          onDragEnd={(e) => handleVertexDragEnd(index, e)}
                          onContextMenu={(e) =>
                            handleVertexContextMenu(index, e)
                          }
                        />
                      );
                    })}
                    {polygon.map((vertex, index) => {
                      const next = polygon[(index + 1) % polygon.length];
                      const midpoint = {
                        x: (vertex.x + next.x) / 2,
                        y: (vertex.y + next.y) / 2,
                      };
                      const midpointPx = metersToPx(midpoint, pxPerMeter);
                      return (
                        <Text
                          scaleX={labelScale}
                          scaleY={labelScale}
                          key={`edge-label-${index}`}
                          listening={false}
                          x={midpointPx.x + 4}
                          y={midpointPx.y + 4}
                          text={edgeLabelTexts[index]}
                          fontSize={11}
                          fill="#44403c"
                        />
                      );
                    })}
                  </Layer>
                  <Layer listening={mode === "select"}>
                    {walls.map((wall) => {
                      const isSelected =
                        selectedObject?.type === "wall" &&
                        selectedObject.id === wall.id;
                      const startPx = metersToPx(wall.start, pxPerMeter);
                      const lengthM = Math.hypot(
                        wall.end.x - wall.start.x,
                        wall.end.y - wall.start.y,
                      );
                      const lengthPx = lengthM * pxPerMeter;
                      const wallColor = isSelected ? "#1F4E79" : "#78350f";
                      const wallMidPx = metersToPx(
                        {
                          x: (wall.start.x + wall.end.x) / 2,
                          y: (wall.start.y + wall.end.y) / 2,
                        },
                        pxPerMeter,
                      );
                      return (
                        <Fragment key={wall.id}>
                          <Rect
                            strokeScaleEnabled={false}
                            name="object"
                            x={startPx.x}
                            y={startPx.y}
                            width={lengthPx}
                            height={thicknessPx}
                            offsetY={thicknessPx / 2}
                            rotation={angleDegrees(wall.start, wall.end)}
                            fill="#78350f"
                            stroke={isSelected ? "#1F4E79" : undefined}
                            strokeWidth={isSelected ? 3 : 0}
                            draggable={isSelected && mode === "select"}
                            onClick={() => {
                              if (suppressObjectClickRef.current) {
                                suppressObjectClickRef.current = false;
                                return;
                              }
                              setSelectedObject({ type: "wall", id: wall.id });
                              setSelectedVertex(null);
                            }}
                            onTap={() => {
                              if (suppressObjectClickRef.current) {
                                suppressObjectClickRef.current = false;
                                return;
                              }
                              setSelectedObject({ type: "wall", id: wall.id });
                              setSelectedVertex(null);
                            }}
                            onDragMove={(e) => handleWallBodyDrag(wall, e)}
                            onDragEnd={(e) => handleWallBodyDrag(wall, e)}
                          />
                          {lengthPx > 24 && (
                            <Text
                              scaleX={labelScale}
                              scaleY={labelScale}
                              listening={false}
                              x={wallMidPx.x}
                              y={wallMidPx.y}
                              text="牆壁"
                              fontSize={11}
                              fill={wallColor}
                              rotation={angleDegrees(wall.start, wall.end)}
                              offsetX={11}
                              offsetY={5}
                            />
                          )}
                        </Fragment>
                      );
                    })}
                    {columns.map((column) => {
                      const isSelected =
                        selectedObject?.type === "column" &&
                        selectedObject.id === column.id;
                      const centerPx = metersToPx(column.center, pxPerMeter);
                      const widthPx = column.w * pxPerMeter;
                      const heightPx = column.h * pxPerMeter;
                      const columnColor = isSelected ? "#1F4E79" : "#57534e";
                      return (
                        <Fragment key={column.id}>
                          <Rect
                            strokeScaleEnabled={false}
                            name="object"
                            x={centerPx.x}
                            y={centerPx.y}
                            width={widthPx}
                            height={heightPx}
                            offsetX={widthPx / 2}
                            offsetY={heightPx / 2}
                            fill="#78716c"
                            stroke={columnColor}
                            strokeWidth={isSelected ? 3 : 1.5}
                            draggable={isSelected && mode === "select"}
                            onClick={() => {
                              if (suppressObjectClickRef.current) {
                                suppressObjectClickRef.current = false;
                                return;
                              }
                              setSelectedObject({
                                type: "column",
                                id: column.id,
                              });
                              setSelectedVertex(null);
                            }}
                            onTap={() => {
                              if (suppressObjectClickRef.current) {
                                suppressObjectClickRef.current = false;
                                return;
                              }
                              setSelectedObject({
                                type: "column",
                                id: column.id,
                              });
                              setSelectedVertex(null);
                            }}
                            onDragMove={(e) => handleColumnBodyDrag(column, e)}
                            onDragEnd={(e) => handleColumnBodyDrag(column, e)}
                          />
                          {widthPx > 20 && heightPx > 14 && (
                            <Text
                              scaleX={labelScale}
                              scaleY={labelScale}
                              listening={false}
                              x={centerPx.x}
                              y={centerPx.y}
                              text="柱子"
                              fontSize={11}
                              fill={columnColor}
                              offsetX={11}
                              offsetY={5}
                            />
                          )}
                        </Fragment>
                      );
                    })}
                    {furniture.map((item, index) => {
                      const isSelected =
                        selectedObject?.type === "furniture" &&
                        selectedObject.id === item.id;
                      const centerPx = metersToPx(item.center, pxPerMeter);
                      // 與 data-furniture-rects 同一份 —— 見 furnitureRects。
                      const footprint = furnitureRects[index];
                      const widthPx = footprint.w * pxPerMeter;
                      const heightPx = footprint.h * pxPerMeter;
                      const entry = catalogItem(item.code);
                      const itemColor = isSelected
                        ? "#1F4E79"
                        : (entry?.color ?? "#808080");
                      return (
                        <Fragment key={item.id}>
                          <Rect
                            strokeScaleEnabled={false}
                            name="object"
                            x={centerPx.x}
                            y={centerPx.y}
                            width={widthPx}
                            height={heightPx}
                            offsetX={widthPx / 2}
                            offsetY={heightPx / 2}
                            rotation={item.rotationDeg}
                            fill={entry?.color ?? "#808080"}
                            opacity={0.6}
                            stroke={itemColor}
                            strokeWidth={isSelected ? 3 : 1.5}
                            onClick={() => {
                              setSelectedObject({
                                type: "furniture",
                                id: item.id,
                              });
                              setSelectedVertex(null);
                            }}
                            onTap={() => {
                              setSelectedObject({
                                type: "furniture",
                                id: item.id,
                              });
                              setSelectedVertex(null);
                            }}
                          />
                          {widthPx > 20 && heightPx > 14 && (
                            <Text
                              scaleX={labelScale}
                              scaleY={labelScale}
                              listening={false}
                              x={centerPx.x}
                              y={centerPx.y}
                              rotation={item.rotationDeg}
                              text={
                                entry
                                  ? subCategoryLabel(entry.subCategory)
                                  : item.code
                              }
                              fontSize={11}
                              fill={itemColor}
                              offsetX={11}
                              offsetY={5}
                            />
                          )}
                        </Fragment>
                      );
                    })}
                    {selectedColumn &&
                      mode === "select" &&
                      (
                        [
                          { x: -1, y: -1 },
                          { x: 1, y: -1 },
                          { x: -1, y: 1 },
                          { x: 1, y: 1 },
                        ] as { x: -1 | 1; y: -1 | 1 }[]
                      ).map((corner) => {
                        const cornerMeter = {
                          x:
                            selectedColumn.center.x +
                            (corner.x * selectedColumn.w) / 2,
                          y:
                            selectedColumn.center.y +
                            (corner.y * selectedColumn.h) / 2,
                        };
                        const cornerPx = metersToPx(cornerMeter, pxPerMeter);
                        const isDragging =
                          draggingColumnCorner !== null &&
                          draggingColumnCorner.x === corner.x &&
                          draggingColumnCorner.y === corner.y;
                        return (
                          <Circle
                            scaleX={labelScale}
                            scaleY={labelScale}
                            strokeScaleEnabled={false}
                            key={`corner-${corner.x}-${corner.y}`}
                            name="object"
                            x={cornerPx.x}
                            y={cornerPx.y}
                            radius={6}
                            fill={isDragging ? "#1F4E79" : "#ffffff"}
                            stroke="#1F4E79"
                            strokeWidth={2}
                            // The minimum column size (0.5m) can place corners only a
                            // few px from the center at typical scale, so the default
                            // fill/stroke hit region would overlap the column body's
                            // own hit region and hijack body-drag gestures. A small
                            // fixed hit radius (independent of the visual radius
                            // above, which stays consistent with the other object
                            // handles) keeps the handle precisely grabbable at its
                            // corner without covering the body.
                            hitFunc={(context, shape) => {
                              context.beginPath();
                              context.arc(0, 0, 3, 0, Math.PI * 2, false);
                              context.closePath();
                              context.fillStrokeShape(shape);
                            }}
                            draggable
                            onDragStart={() => setDraggingColumnCorner(corner)}
                            onDragMove={(e) =>
                              handleColumnCornerDrag(selectedColumn, corner, e)
                            }
                            // Deliberately does NOT call handleColumnCornerDrag again
                            // here (unlike the analogous vertex/wall-endpoint/column-
                            // body handlers, which re-apply on both dragmove and
                            // dragend): the resulting corner position is generally a
                            // quarter-grid offset (center +/- w/2), not a 0.5m-grid
                            // value, and onDragMove already overrides the node's
                            // position to that exact result. Re-reading e.target's
                            // (now-overridden) position here and re-running it through
                            // resizeColumnCorner's snapPoint would re-snap a
                            // non-grid-aligned value a second time, which is not
                            // idempotent and can silently drift the resize result.
                            // The last onDragMove already applied the correct final
                            // state, so dragend only needs to clear the drag flag.
                            onDragEnd={() => setDraggingColumnCorner(null)}
                          />
                        );
                      })}
                    {columnLabelText &&
                      selectedColumn &&
                      (() => {
                        const columnCenterPx = metersToPx(
                          selectedColumn.center,
                          pxPerMeter,
                        );
                        return (
                          <Text
                            scaleX={labelScale}
                            scaleY={labelScale}
                            listening={false}
                            x={
                              columnCenterPx.x +
                              (selectedColumn.w * pxPerMeter) / 2 +
                              4
                            }
                            y={
                              columnCenterPx.y -
                              (selectedColumn.h * pxPerMeter) / 2 -
                              16
                            }
                            text={columnLabelText}
                            fontSize={11}
                            fill="#44403c"
                          />
                        );
                      })()}
                    {/* R2:選取柱子時,標出柱子四邊到場地邊界的距離,
                        外加場地總寬高。紅色雙箭頭 + 公分數字,比照回饋
                        附的參考圖。全部 listening={false} —— 這是唯讀
                        標註,不能攔截點擊。 */}
                    {selectedColumn &&
                      columnOffsetsCm &&
                      (() => {
                        const min = metersToPx(
                          { x: floorBounds.minX, y: floorBounds.minY },
                          pxPerMeter,
                        );
                        const max = metersToPx(
                          { x: floorBounds.maxX, y: floorBounds.maxY },
                          pxPerMeter,
                        );
                        const center = metersToPx(
                          selectedColumn.center,
                          pxPerMeter,
                        );
                        const halfW = (selectedColumn.w * pxPerMeter) / 2;
                        const halfH = (selectedColumn.h * pxPerMeter) / 2;
                        const dims: {
                          key: string;
                          points: number[];
                          text: string;
                          labelX: number;
                          labelY: number;
                        }[] = [
                          {
                            key: "left",
                            points: [
                              min.x,
                              center.y,
                              center.x - halfW,
                              center.y,
                            ],
                            text: `${columnOffsetsCm.left}cm`,
                            labelX: (min.x + center.x - halfW) / 2,
                            labelY: center.y - 14,
                          },
                          {
                            key: "right",
                            points: [
                              center.x + halfW,
                              center.y,
                              max.x,
                              center.y,
                            ],
                            text: `${columnOffsetsCm.right}cm`,
                            labelX: (center.x + halfW + max.x) / 2,
                            labelY: center.y - 14,
                          },
                          {
                            key: "top",
                            points: [
                              center.x,
                              min.y,
                              center.x,
                              center.y - halfH,
                            ],
                            text: `${columnOffsetsCm.top}cm`,
                            labelX: center.x + 4,
                            labelY: (min.y + center.y - halfH) / 2,
                          },
                          {
                            key: "bottom",
                            points: [
                              center.x,
                              center.y + halfH,
                              center.x,
                              max.y,
                            ],
                            text: `${columnOffsetsCm.bottom}cm`,
                            labelX: center.x + 4,
                            labelY: (center.y + halfH + max.y) / 2,
                          },
                        ];
                        return (
                          <Fragment>
                            {dims.map((dim) => (
                              <Fragment key={dim.key}>
                                <Arrow
                                  strokeScaleEnabled={false}
                                  listening={false}
                                  points={dim.points}
                                  pointerAtBeginning
                                  pointerLength={5}
                                  pointerWidth={5}
                                  stroke={DIMENSION_COLOR}
                                  fill={DIMENSION_COLOR}
                                  strokeWidth={1}
                                />
                                <Text
                                  scaleX={labelScale}
                                  scaleY={labelScale}
                                  listening={false}
                                  x={dim.labelX}
                                  y={dim.labelY}
                                  text={dim.text}
                                  fontSize={11}
                                  fill={DIMENSION_COLOR}
                                />
                              </Fragment>
                            ))}
                          </Fragment>
                        );
                      })()}
                    {/* 場地總寬高:恆顯示,畫在地板外接矩形之外一段距離。 */}
                    {(() => {
                      const min = metersToPx(
                        { x: floorBounds.minX, y: floorBounds.minY },
                        pxPerMeter,
                      );
                      const max = metersToPx(
                        { x: floorBounds.maxX, y: floorBounds.maxY },
                        pxPerMeter,
                      );
                      return (
                        <Fragment>
                          <Arrow
                            strokeScaleEnabled={false}
                            listening={false}
                            points={[min.x, min.y - 18, max.x, min.y - 18]}
                            pointerAtBeginning
                            pointerLength={5}
                            pointerWidth={5}
                            stroke={DIMENSION_COLOR}
                            fill={DIMENSION_COLOR}
                            strokeWidth={1}
                          />
                          <Text
                            scaleX={labelScale}
                            scaleY={labelScale}
                            listening={false}
                            x={(min.x + max.x) / 2}
                            y={min.y - 32}
                            text={`${venueSizeCm.width}cm`}
                            fontSize={11}
                            fill={DIMENSION_COLOR}
                          />
                          <Arrow
                            strokeScaleEnabled={false}
                            listening={false}
                            points={[max.x + 18, min.y, max.x + 18, max.y]}
                            pointerAtBeginning
                            pointerLength={5}
                            pointerWidth={5}
                            stroke={DIMENSION_COLOR}
                            fill={DIMENSION_COLOR}
                            strokeWidth={1}
                          />
                          <Text
                            scaleX={labelScale}
                            scaleY={labelScale}
                            listening={false}
                            x={max.x + 22}
                            y={(min.y + max.y) / 2}
                            text={`${venueSizeCm.height}cm`}
                            fontSize={11}
                            fill={DIMENSION_COLOR}
                          />
                        </Fragment>
                      );
                    })()}
                    {wallLabelText &&
                      selectedWall &&
                      (() => {
                        const wallMidPx = metersToPx(
                          {
                            x: (selectedWall.start.x + selectedWall.end.x) / 2,
                            y: (selectedWall.start.y + selectedWall.end.y) / 2,
                          },
                          pxPerMeter,
                        );
                        return (
                          <Text
                            scaleX={labelScale}
                            scaleY={labelScale}
                            listening={false}
                            x={wallMidPx.x + 6}
                            y={wallMidPx.y - 16}
                            text={wallLabelText}
                            fontSize={11}
                            fill="#44403c"
                          />
                        );
                      })()}
                    {draftWall && (
                      <Rect
                        strokeScaleEnabled={false}
                        listening={false}
                        x={metersToPx(draftWall.start, pxPerMeter).x}
                        y={metersToPx(draftWall.start, pxPerMeter).y}
                        width={
                          Math.hypot(
                            draftWall.end.x - draftWall.start.x,
                            draftWall.end.y - draftWall.start.y,
                          ) * pxPerMeter
                        }
                        height={thicknessPx}
                        offsetY={thicknessPx / 2}
                        rotation={angleDegrees(draftWall.start, draftWall.end)}
                        fill="#78350f"
                        opacity={0.5}
                      />
                    )}
                    {selectedWall && (
                      <>
                        <Circle
                          scaleX={labelScale}
                          scaleY={labelScale}
                          strokeScaleEnabled={false}
                          name="object"
                          x={metersToPx(selectedWall.start, pxPerMeter).x}
                          y={metersToPx(selectedWall.start, pxPerMeter).y}
                          radius={6}
                          fill={
                            draggingHandle === "start" ? "#1F4E79" : "#ffffff"
                          }
                          stroke="#1F4E79"
                          strokeWidth={2}
                          hitStrokeWidth={16}
                          draggable
                          onDragStart={() => setDraggingHandle("start")}
                          onDragMove={(e) =>
                            handleWallEndpointDrag(selectedWall, "start", e)
                          }
                          onDragEnd={(e) => {
                            handleWallEndpointDrag(selectedWall, "start", e);
                            setDraggingHandle(null);
                          }}
                        />
                        <Circle
                          scaleX={labelScale}
                          scaleY={labelScale}
                          strokeScaleEnabled={false}
                          name="object"
                          x={metersToPx(selectedWall.end, pxPerMeter).x}
                          y={metersToPx(selectedWall.end, pxPerMeter).y}
                          radius={6}
                          fill={
                            draggingHandle === "end" ? "#1F4E79" : "#ffffff"
                          }
                          stroke="#1F4E79"
                          strokeWidth={2}
                          hitStrokeWidth={16}
                          draggable
                          onDragStart={() => setDraggingHandle("end")}
                          onDragMove={(e) =>
                            handleWallEndpointDrag(selectedWall, "end", e)
                          }
                          onDragEnd={(e) => {
                            handleWallEndpointDrag(selectedWall, "end", e);
                            setDraggingHandle(null);
                          }}
                        />
                      </>
                    )}
                  </Layer>
                </Stage>
                </div>
              </div>
            </div>
          )}
          {step === "preview" && sceneGenerated && (
            <div data-testid="step-preview">
              <Button
                type="button"
                variant="outline"
                data-testid="back-to-edit-button"
                onClick={handleBackToEdit}
                className="mb-2"
              >
                上一步
              </Button>
              <Button
                type="button"
                data-testid="to-refined-button"
                onClick={handleToRefined}
                className="mb-2 ml-2"
              >
                下一步
              </Button>
              <VenueSceneLoader
                key={generation}
                polygon={polygon}
                walls={walls}
                columns={columns}
                furniture={furniture}
                venueSizeM={planArea.widthM}
                planArea={planArea}
                viewFitSizeM={sceneFit.sizeM}
                viewCenterM={sceneFit.center}
                wallHeightM={wallHeightM}
                onWallHeightChange={setWallHeightM}
                onSceneChange={handleSceneChange}
              />
            </div>
          )}
          {step === "refined" && sceneGenerated && (
            <div data-testid="step-refined">
              <Button
                type="button"
                variant="outline"
                data-testid="back-to-preview-button"
                onClick={handleBackToPreview}
                className="mb-2"
              >
                上一步
              </Button>
              {/*
                材質控制項移到左側欄(第四輪)—— 與步驟 02 的家具目錄同一個
                位置與同一套開合行為。原本橫躺在場景上方,縮圖化之後那一條會
                佔掉畫面高度,而使用者在步驟 03 要看的是場景本身。
              */}
              <div className="flex items-start gap-3">
                <aside
                  data-testid="refined-sidebar"
                  data-open={refinedSidebarOpen}
                  className={
                    (refinedSidebarOpen ? "w-64" : "w-11") +
                    " shrink-0 rounded-md border border-stone-300 bg-card p-2"
                  }
                >
                  <button
                    type="button"
                    data-testid="refined-sidebar-toggle"
                    aria-label={refinedSidebarOpen ? "收合側欄" : "展開側欄"}
                    aria-expanded={refinedSidebarOpen}
                    onClick={() => setRefinedSidebarOpen((prev) => !prev)}
                    className="flex h-7 w-full items-center justify-center rounded text-blueprint hover:bg-blueprint-wash [&_svg]:size-4"
                  >
                    {refinedSidebarOpen ? (
                      <PanelLeftClose />
                    ) : (
                      <PanelLeftOpen />
                    )}
                  </button>
                  {refinedSidebarOpen && (
                    <div className="mt-2 flex max-h-[460px] flex-col gap-3 overflow-y-auto pr-0.5">
                      <div
                        data-testid="surface-picker"
                        className="flex flex-col gap-3 text-xs"
                      >
                        <SurfacePicker
                          surface="floor"
                          label="地板"
                          presets={FLOOR_PRESETS}
                          value={surfaces.floor}
                          onChange={(floor) =>
                            setSurfaces((prev) => ({ ...prev, floor }))
                          }
                        />
                        <SurfacePicker
                          surface="wall"
                          label="預設牆面"
                          presets={WALL_PRESETS}
                          value={surfaces.wall}
                          onChange={(wall) =>
                            setSurfaces((prev) => ({ ...prev, wall }))
                          }
                        />
                        {(["floor", "wall"] as const).map((surface) => (
                          <label
                            key={surface}
                            className="flex items-center gap-1 text-muted-foreground"
                          >
                            {surface === "floor" ? "自訂地板圖" : "自訂牆面圖"}
                            <input
                              type="file"
                              accept="image/*"
                              data-testid={`surface-${surface}-upload`}
                              onChange={(e) =>
                                handleSurfaceUpload(
                                  surface,
                                  e.target.files?.[0] ?? null,
                                )
                              }
                              className="w-40 text-[11px]"
                            />
                            {surfaceUploads[surface] && (
                              <button
                                type="button"
                                data-testid={`surface-${surface}-upload-clear`}
                                onClick={() => clearSurfaceUpload(surface)}
                                className="rounded border border-stone-300 px-1"
                              >
                                清除
                              </button>
                            )}
                          </label>
                        ))}
                        {uploadError && (
                          <span
                            role="alert"
                            data-testid="surface-upload-error"
                            className="text-destructive"
                          >
                            {uploadError}
                          </span>
                        )}
                        <span className="text-muted-foreground">
                          柱子跟隨預設牆面材質;上傳的圖只當顏色用,不產生凹凸
                        </span>
                      </div>
                      {/*
                逐面牆各自設定(T9)。**沒有牆時整段不渲染** —— 空的選單比沒有
                選單更難懂:使用者會以為功能壞了,而不是「還沒畫牆」。
              */}
                      {walls.length > 0 && (
                        <div
                          data-testid="wall-surface-list"
                          data-wall-count={walls.length}
                          className="flex flex-col gap-1 border-t border-stone-200 pt-2 text-xs"
                        >
                          <span className="font-bold text-muted-foreground">
                            個別牆面({walls.length} 面)
                          </span>
                          {walls.map((wall, index) => {
                            const override = surfaces.wallOverrides[wall.id];
                            const upload = surfaceUploads.walls[wall.id];
                            return (
                              <div
                                key={wall.id}
                                data-testid={`wall-surface-row-${index + 1}`}
                                data-wall-id={wall.id}
                                // 實際生效的款式 —— 有覆寫就是覆寫,沒有就是預設。
                                // 這是**設定值**的回音,場景裡真正掛了什麼要問探針
                                // (RefinedSceneProbe 的 walls)。
                                data-wall-preset={wallPresetIdFor(
                                  surfaces,
                                  wall.id,
                                )}
                                data-wall-upload={upload ? "upload" : ""}
                                className="flex flex-wrap items-center gap-2"
                              >
                                <span className="w-12 text-muted-foreground">
                                  牆 {index + 1}
                                </span>
                                {/*
                          這一面牆目前實際套用的款式縮圖。逐面牆的清單會隨牆數
                          長大,每一列都攤開六個縮圖會把面板撐爆 —— 所以列上只
                          放「現在是什麼」,要換仍然用選單。
                        */}
                                <span className="size-7 shrink-0 overflow-hidden rounded-sm border border-stone-300">
                                  <SurfaceSwatch
                                    surface="wall"
                                    presetId={wallPresetIdFor(
                                      surfaces,
                                      wall.id,
                                    )}
                                  />
                                </span>
                                <select
                                  data-testid={`wall-surface-select-${index + 1}`}
                                  value={override ?? ""}
                                  onChange={(e) =>
                                    setSurfaces((prev) =>
                                      withWallOverride(
                                        prev,
                                        wall.id,
                                        e.target.value === ""
                                          ? null
                                          : e.target.value,
                                      ),
                                    )
                                  }
                                  className="rounded border border-stone-300 bg-card px-1 py-0.5 text-foreground"
                                >
                                  <option value="">同預設</option>
                                  {WALL_PRESETS.map((preset) => (
                                    <option key={preset.id} value={preset.id}>
                                      {preset.label}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  type="file"
                                  accept="image/*"
                                  data-testid={`wall-surface-upload-${index + 1}`}
                                  onChange={(e) =>
                                    handleWallSurfaceUpload(
                                      wall.id,
                                      e.target.files?.[0] ?? null,
                                    )
                                  }
                                  className="w-36 text-[11px]"
                                />
                                {upload && (
                                  <button
                                    type="button"
                                    data-testid={`wall-surface-upload-clear-${index + 1}`}
                                    onClick={() =>
                                      clearWallSurfaceUpload(wall.id)
                                    }
                                    className="rounded border border-stone-300 px-1"
                                  >
                                    清除
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </aside>
                <div className="min-w-0 flex-1">
                  <RefinedSceneLoader
                    polygon={polygon}
                    walls={walls}
                    columns={columns}
                    furniture={furniture}
                    venueSizeM={planArea.widthM}
                    viewFitSizeM={sceneFit.sizeM}
                    viewCenterM={sceneFit.center}
                    surfaces={surfaces}
                    surfaceUploads={surfaceUploads}
                    wallHeightM={wallHeightM}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
        <div
          data-testid="ai-panel-slot"
          data-hidden={step === "refined"}
          inert={step === "refined"}
          className={step === "refined" ? "hidden" : "contents"}
        >
          <AiPanel
            plan={{
              polygon,
              walls,
              columns,
              furniture,
              area: planArea,
              surfaces,
            }}
            applyActions={applyActions}
            planId={currentPlanId}
            slot={currentSlot}
            conversationSeed={conversationSeed}
          />
        </div>
      </div>
      <PlanSlotsDialog
        open={slotsDialogOpen}
        onOpenChange={setSlotsDialogOpen}
        getSnapshot={getSnapshot}
        isDirty={isDirty}
        currentSlot={currentSlot}
        onLoaded={applyLoadedPlan}
        onSaved={handleSlotSaved}
        onDeleted={handleSlotDeleted}
      />

      {/* R1:換展位尺寸前的確認。只在真的有東西會被搬動時才出現 —— 沒有
          越界物件就直接套用,不為了「一致」而多一個沒有資訊量的對話框。 */}
      <AlertDialog
        open={pendingBoothSize !== null}
        onOpenChange={(next) => {
          if (!next) setPendingBoothSize(null);
        }}
      >
        <AlertDialogContent
          data-testid="booth-size-confirm-dialog"
          data-outside-count={
            pendingBoothSize
              ? outsideCountFor(pendingBoothSize.w, pendingBoothSize.h)
              : 0
          }
        >
          <AlertDialogHeader>
            <AlertDialogTitle>更換展位尺寸?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingBoothSize &&
                `場地將改為 ${pendingBoothSize.w} × ${pendingBoothSize.h} 公尺。目前有 ${outsideCountFor(
                  pendingBoothSize.w,
                  pendingBoothSize.h,
                )} 件物件會落在新場地外,將被移到場地邊界內。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="booth-size-confirm-cancel">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="booth-size-confirm-accept"
              onClick={() => {
                if (!pendingBoothSize) return;
                applyBoothSize(pendingBoothSize.w, pendingBoothSize.h);
                setPendingBoothSize(null);
              }}
            >
              更換
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
