"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Circle, Layer, Line, Rect, Stage, Text } from "react-konva";
import type Konva from "konva";
import { Ruler } from "lucide-react";
import {
  DEFAULT_FLOOR,
  EMPTY_PLAN_BASELINE,
  GRID_MAJOR_M,
  GRID_MINOR_M,
  MIN_FLOOR_VERTICES,
  VENUE_SIZE_M,
  WALL_THICKNESS_M,
  clampColumnCenter,
  computePxPerMeter,
  createColumn,
  createDefaultFloor,
  createObjectId,
  createWall,
  findClosestEdge,
  formatMeters,
  insertVertexOnEdge,
  metersToPx,
  moveVertex,
  moveWallEndpoint,
  pxToMeters,
  removeVertex,
  resizeColumnCorner,
  serializePlanSnapshot,
  snapPoint,
  translateColumn,
  translateWall,
  wallLengthM,
  type Column,
  type FloorPolygon,
  type PlanPoint,
  type PlanSnapshot,
  type WallSegment,
} from "@/lib/venue/plan";
import {
  FURNITURE_DEFAULTS,
  translateFurniture,
  type FurnitureItem,
} from "@/lib/venue/furniture";
import type {
  AiAction,
  AiActionResult,
  AiItemType,
} from "@/lib/ai-panel/actions";
import { fromStoredConversation } from "@/lib/ai-panel/messages";
import type { ChatTurn } from "./AiPanel";
import AiPanel from "./AiPanel";
import PlanSlotsDialog, {
  type LoadedPlan,
  type Slot,
} from "./PlanSlotsDialog";
import PlanToolbar, { type EditorMode } from "./PlanToolbar";
import VenueSceneLoader from "./VenueSceneLoader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
const MIN_VENUE_SIZE_M = 10;
const MAX_VENUE_SIZE_M = 200;

type SelectedObject = {
  type: "wall" | "column" | "furniture";
  id: string;
} | null;
type WizardStep = "edit" | "preview";

function buildGridLines(pxPerMeter: number, venueSizeM: number) {
  const lines: {
    key: string;
    points: number[];
    stroke: string;
    strokeWidth: number;
  }[] = [];
  const sizePx = venueSizeM * pxPerMeter;

  for (let m = 0; m <= venueSizeM; m += GRID_MINOR_M) {
    const isMajor = m % GRID_MAJOR_M === 0;
    const pos = m * pxPerMeter;
    lines.push({
      key: `v-${m}`,
      points: [pos, 0, pos, sizePx],
      stroke: isMajor ? "#d6d3d1" : "#e7e5e4",
      strokeWidth: isMajor ? 1.5 : 1,
    });
    lines.push({
      key: `h-${m}`,
      points: [0, pos, sizePx, pos],
      stroke: isMajor ? "#d6d3d1" : "#e7e5e4",
      strokeWidth: isMajor ? 1.5 : 1,
    });
  }

  return lines;
}

const WIZARD_STEPS: { step: WizardStep; no: string; label: string }[] = [
  { step: "edit", no: "01", label: "繪製平面圖" },
  { step: "preview", no: "02", label: "預覽 3D 場景" },
];

// 圖紙頁籤式步驟指示:等寬字大號編號 + 粗藍底線標記當前步,
// 整條底線同時作為版面分隔線。
function StepProgress({ current }: { current: WizardStep }) {
  return (
    <ol
      data-testid="step-progress"
      className="mb-4 flex max-w-md gap-7 border-b-2 border-line"
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
  const [venueSizeM, setVenueSizeM] = useState(VENUE_SIZE_M);
  const [polygon, setPolygon] = useState<FloorPolygon>(DEFAULT_FLOOR);
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);

  const [mode, setMode] = useState<EditorMode>("select");
  const [walls, setWalls] = useState<WallSegment[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [furniture, setFurniture] = useState<FurnitureItem[]>([]);
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
  useEffect(() => {
    polygonRef.current = polygon;
    wallsRef.current = walls;
    columnsRef.current = columns;
    furnitureRef.current = furniture;
  });
  const [sceneSnapshot, setSceneSnapshot] = useState<{
    polygon: FloorPolygon;
    walls: WallSegment[];
    columns: Column[];
    furniture: FurnitureItem[];
  } | null>(null);
  const [generation, setGeneration] = useState(0);
  const [step, setStep] = useState<WizardStep>("edit");

  const [sizeEditorOpen, setSizeEditorOpen] = useState(false);
  const [sizeInput, setSizeInput] = useState(String(VENUE_SIZE_M));
  const [pendingSizeM, setPendingSizeM] = useState<number | null>(null);
  const [sizeConfirmOpen, setSizeConfirmOpen] = useState(false);

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

  const pxPerMeter = computePxPerMeter(stagePx, venueSizeM);
  const gridLines = buildGridLines(pxPerMeter, venueSizeM);

  function openSizeEditor() {
    setSizeInput(String(venueSizeM));
    setSizeEditorOpen(true);
  }

  function applyVenueSize(nextSizeM: number) {
    setVenueSizeM(nextSizeM);
    setPolygon(createDefaultFloor(nextSizeM));
    setWalls([]);
    setColumns([]);
    setFurniture([]);
    setSelectedObject(null);
    setSelectedVertex(null);
  }

  function handleSizeConfirm() {
    const next = Math.round(Number(sizeInput));
    if (!Number.isFinite(next)) return;
    const clamped = Math.min(
      MAX_VENUE_SIZE_M,
      Math.max(MIN_VENUE_SIZE_M, next),
    );
    if (clamped === venueSizeM) {
      setSizeEditorOpen(false);
      return;
    }
    const isEmpty =
      walls.length === 0 && columns.length === 0 && furniture.length === 0;
    // 空場地無改動可失,直接套用,不跳警告彈窗。
    if (isEmpty) {
      applyVenueSize(clamped);
      setSizeEditorOpen(false);
      return;
    }
    setPendingSizeM(clamped);
    setSizeEditorOpen(false);
    setSizeConfirmOpen(true);
  }

  function handleSizeConfirmAccept() {
    if (pendingSizeM !== null) {
      applyVenueSize(pendingSizeM);
    }
    setPendingSizeM(null);
    setSizeConfirmOpen(false);
  }

  // --- 存檔 UI(Task 3):快照 / dirty 判定 / 讀檔套用 -----------------------

  function getSnapshot(): PlanSnapshot {
    return { polygon, walls, columns, furniture, venueSizeM };
  }

  // 序列化比對,不做逐操作 dirty flag(取捨見 architect-plan.md D5)。僅在
  // 讀檔前呼叫;存檔不檢查。
  function isDirty(): boolean {
    return serializePlanSnapshot(getSnapshot()) !== (savedBaseline ?? EMPTY_PLAN_BASELINE);
  }

  // 讀檔套用(architect-plan.md D4)。呼叫時機為 PlanSlotsDialog 的
  // GET /api/plans/[slot] 200 之後;非 200 情境該元件不會呼叫此函式,原地
  // 狀態不丟。
  function applyLoadedPlan(data: LoadedPlan) {
    const rawPlan = data.plan as {
      polygon?: FloorPolygon;
      walls?: WallSegment[];
      columns?: Column[];
      furniture?: FurnitureItem[];
      venueSizeM?: unknown;
    };
    const sizeM =
      typeof rawPlan.venueSizeM === "number"
        ? Math.min(MAX_VENUE_SIZE_M, Math.max(MIN_VENUE_SIZE_M, rawPlan.venueSizeM))
        : VENUE_SIZE_M;
    const loadedPolygon = rawPlan.polygon ?? DEFAULT_FLOOR;
    const loadedWalls = rawPlan.walls ?? [];
    const loadedColumns = rawPlan.columns ?? [];
    const loadedFurniture = rawPlan.furniture ?? [];

    setVenueSizeM(sizeM);
    setSizeInput(String(sizeM));
    setPolygon(loadedPolygon);
    setWalls(loadedWalls);
    setColumns(loadedColumns);
    setFurniture(loadedFurniture);
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
        venueSizeM: sizeM,
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
    const next = moveVertex(polygon, index, meterPoint, venueSizeM);
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
    const next = moveVertex(polygon, index, meterPoint, venueSizeM);
    setPolygon(next);
    const snappedPx = metersToPx(next[index], pxPerMeter);
    node.position(snappedPx);
  }

  function handleEdgeDblClick(e: Konva.KonvaEventObject<MouseEvent>) {
    const stage = e.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;

    const meterPoint: PlanPoint = pxToMeters(pointer, pxPerMeter);
    const { edgeIndex, distance } = findClosestEdge(polygon, meterPoint);
    // 只有點在邊附近 (0.5m 內) 才插入頂點 — 點在多邊形內部深處不動作。
    if (distance > 0.5) return;
    const next = insertVertexOnEdge(polygon, edgeIndex, meterPoint, venueSizeM);
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
    setSceneSnapshot({ polygon, walls, columns, furniture });
    setGeneration((g) => g + 1);
    setStep("preview");
    // 進入 Step 2 前清除既有選取,避免殘留的 selectedObject/selectedVertex
    // 在返回 Step 1 前於 Step 2 內被鍵盤 Delete/Backspace 誤刪(即使
    // onKeyDown 已改綁定到 step-edit,這裡仍同步清除以求雙重保險)。
    setSelectedObject(null);
    setSelectedVertex(null);
  }

  function handleSceneChange(next: {
    walls: WallSegment[];
    columns: Column[];
    furniture: FurnitureItem[];
  }) {
    setSceneSnapshot((prev) => (prev ? { ...prev, ...next } : prev));
  }

  function handleBackToEdit() {
    if (sceneSnapshot) {
      setWalls(sceneSnapshot.walls);
      setColumns(sceneSnapshot.columns);
      setFurniture(sceneSnapshot.furniture);
    }
    setStep("edit");
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
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    const meterPoint = pxToMeters(pointer, pxPerMeter);

    if (mode === "wall") {
      const snapped = snapPoint(meterPoint, venueSizeM);
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
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    const meterPoint = pxToMeters(pointer, pxPerMeter);
    const snapped = snapPoint(meterPoint, venueSizeM);
    setDraftWall({ start: draftWall.start, end: snapped });
  }

  function handleStageMouseUp(
    e: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ) {
    if (mode === "wall") {
      if (draftWall) {
        const wall = createWall(draftWall.start, draftWall.end, venueSizeM);
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
      const pointer = stage?.getPointerPosition();
      if (!pointer) return;
      const meterPoint = pxToMeters(pointer, pxPerMeter);
      const column = createColumn(meterPoint, venueSizeM);
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
    const updated = translateWall(wall, deltaM, venueSizeM);
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
    const updated = translateColumn(column, deltaM, venueSizeM);
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
    const updated = moveWallEndpoint(wall, which, meterPoint, venueSizeM);
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
    const updated = resizeColumnCorner(column, corner, meterPoint, venueSizeM);
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

    for (const action of actions) {
      switch (action.type) {
        case "generate_plan": {
          const floorPoints = action.input.floor.map((p) =>
            snapPoint(p, venueSizeM),
          );
          if (floorPoints.length < MIN_FLOOR_VERTICES) {
            results.push({
              toolUseId: action.toolUseId,
              ok: false,
              message: `地板頂點不足 ${MIN_FLOOR_VERTICES} 點,已跳過產生配置`,
            });
            break;
          }
          const generatedWalls = action.input.walls
            .map((w) => createWall(w.start, w.end, venueSizeM))
            .filter((w): w is WallSegment => w !== null);
          const generatedColumns: Column[] = action.input.columns.map((c) => ({
            id: createObjectId(),
            center: clampColumnCenter(
              snapPoint(c.center, venueSizeM),
              c.w,
              c.h,
              venueSizeM,
            ),
            w: c.w,
            h: c.h,
          }));
          const generatedFurniture: FurnitureItem[] =
            action.input.furniture.map((f) => {
              const defaults = FURNITURE_DEFAULTS[f.kind];
              return {
                id: createObjectId(),
                kind: f.kind,
                center: clampColumnCenter(
                  snapPoint(f.center, venueSizeM),
                  defaults.w,
                  defaults.h,
                  venueSizeM,
                ),
                w: defaults.w,
                h: defaults.h,
                rotationDeg: normalizeRotationDeg(f.rotationDeg),
              };
            });
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
          results.push({
            toolUseId: action.toolUseId,
            ok: true,
            message: `已產生配置:${parts.join("、")}`,
          });
          break;
        }
        case "add_furniture": {
          const defaults = FURNITURE_DEFAULTS[action.input.kind];
          const item: FurnitureItem = {
            id: createObjectId(),
            kind: action.input.kind,
            center: clampColumnCenter(
              snapPoint(action.input.center, venueSizeM),
              defaults.w,
              defaults.h,
              venueSizeM,
            ),
            w: defaults.w,
            h: defaults.h,
            rotationDeg: normalizeRotationDeg(action.input.rotationDeg),
          };
          nextFurniture = [...nextFurniture, item];
          results.push({
            toolUseId: action.toolUseId,
            ok: true,
            message: `已新增${defaults.label}`,
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
              venueSizeM,
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
              venueSizeM,
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
              venueSizeM,
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
          const points = action.input.points.map((p) =>
            snapPoint(p, venueSizeM),
          );
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
      }
    }

    // 比對/寫回都用 ref(不是 state 變數)— 同一個 applyActions 呼叫可能
    // 早於下一次 render 的 useEffect 就再被呼叫一次(例如同一輪回應內
    // 連續兩個 tool_use),eager 更新 ref 確保這種情況下第二次呼叫仍看得到
    // 第一次呼叫剛寫入的結果,而不是等到 effect 才同步的舊值。
    if (nextPolygon !== polygonRef.current) {
      setPolygon(nextPolygon);
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
    ? `${selectedColumn.w.toFixed(1)} x ${selectedColumn.h.toFixed(1)} m`
    : "";

  const wallLabelText = selectedWall
    ? formatMeters(wallLengthM(selectedWall))
    : "";

  const edgeLabelTexts = polygon.map((vertex, i) => {
    const next = polygon[(i + 1) % polygon.length];
    return formatMeters(Math.hypot(next.x - vertex.x, next.y - vertex.y));
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
      data-column-label={columnLabelText}
      data-wall-label={wallLabelText}
      data-edge-labels={JSON.stringify(edgeLabelTexts)}
      data-scene-generated={sceneSnapshot !== null}
      data-generation={generation}
      data-step={step}
      data-current-slot={currentSlot ?? ""}
      data-current-plan-id={currentPlanId ?? ""}
      className="w-full outline-none"
    >
      <StepProgress current={step} />
      {step === "edit" && (
        <div
          data-testid="step-edit"
          tabIndex={0}
          onKeyDown={handleKeyDown}
          className="flex items-start gap-4 outline-none"
        >
          <div ref={editorColumnRef} className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2">
              <PlanToolbar
                mode={mode}
                onModeChange={handleModeChange}
                canDelete={selectedObject !== null}
                onDelete={deleteSelectedObject}
              />
              {sizeEditorOpen ? (
                <div
                  data-testid="venue-size-editor"
                  className="inline-flex h-[34px] items-center gap-1.5 rounded-md border-[1.5px] border-blueprint bg-card px-2"
                >
                  <Label
                    htmlFor="venue-size-input"
                    className="shrink-0 text-sm text-blueprint"
                  >
                    邊長(公尺)
                  </Label>
                  <Input
                    id="venue-size-input"
                    data-testid="venue-size-input"
                    type="number"
                    min={MIN_VENUE_SIZE_M}
                    max={MAX_VENUE_SIZE_M}
                    value={sizeInput}
                    onChange={(e) => setSizeInput(e.target.value)}
                    className="h-6 w-20"
                  />
                  <Button
                    type="button"
                    size="sm"
                    data-testid="venue-size-confirm-button"
                    onClick={handleSizeConfirm}
                  >
                    確認
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    data-testid="venue-size-cancel-button"
                    onClick={() => setSizeEditorOpen(false)}
                  >
                    取消
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="venue-size-button"
                  onClick={openSizeEditor}
                  className="h-[34px]"
                >
                  <Ruler />
                  場地尺寸
                </Button>
              )}
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
            <Stage
              width={stagePx}
              height={stagePx}
              onMouseDown={handleStageMouseDown}
              onMouseMove={handleStageMouseMove}
              onMouseUp={handleStageMouseUp}
              onTouchStart={handleStageMouseDown}
              onTouchMove={handleStageMouseMove}
              onTouchEnd={handleStageMouseUp}
            >
              <Layer listening={false}>
                <Rect
                  x={0}
                  y={0}
                  width={stagePx}
                  height={stagePx}
                  fill="#fafaf9"
                  stroke="#a8a29e"
                  strokeWidth={1}
                />
                {gridLines.map((line) => (
                  <Line
                    key={line.key}
                    points={line.points}
                    stroke={line.stroke}
                    strokeWidth={line.strokeWidth}
                  />
                ))}
              </Layer>
              <Layer listening={false}>
                {Array.from(
                  { length: venueSizeM / GRID_MAJOR_M + 1 },
                  (_, i) => i * GRID_MAJOR_M,
                ).map((m) => (
                  <Text
                    key={`label-top-${m}`}
                    x={m * pxPerMeter + 2}
                    y={2}
                    text={String(m)}
                    fontSize={12}
                    fill="#78716c"
                  />
                ))}
                {Array.from(
                  { length: venueSizeM / GRID_MAJOR_M + 1 },
                  (_, i) => i * GRID_MAJOR_M,
                ).map((m) => (
                  <Text
                    key={`label-left-${m}`}
                    x={2}
                    y={m * pxPerMeter + 2}
                    text={String(m)}
                    fontSize={12}
                    fill="#78716c"
                  />
                ))}
                <Line
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
                  x={8}
                  y={stagePx - 14}
                  text="5 公尺"
                  fontSize={12}
                  fill="#44403c"
                />
              </Layer>
              <Layer listening={mode === "select"}>
                <Line
                  points={polygonPx}
                  closed
                  fill="rgba(191, 219, 254, 0.5)"
                  stroke="#1F4E79"
                  strokeWidth={2}
                  onDblClick={handleEdgeDblClick}
                />
                <Text
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
                      key={index}
                      x={px.x}
                      y={px.y}
                      radius={6}
                      fill={selectedVertex === index ? "#1F4E79" : "#ffffff"}
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
                      onContextMenu={(e) => handleVertexContextMenu(index, e)}
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
                          setSelectedObject({ type: "column", id: column.id });
                          setSelectedVertex(null);
                        }}
                        onTap={() => {
                          if (suppressObjectClickRef.current) {
                            suppressObjectClickRef.current = false;
                            return;
                          }
                          setSelectedObject({ type: "column", id: column.id });
                          setSelectedVertex(null);
                        }}
                        onDragMove={(e) => handleColumnBodyDrag(column, e)}
                        onDragEnd={(e) => handleColumnBodyDrag(column, e)}
                      />
                      {widthPx > 20 && heightPx > 14 && (
                        <Text
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
                {furniture.map((item) => {
                  const isSelected =
                    selectedObject?.type === "furniture" &&
                    selectedObject.id === item.id;
                  const centerPx = metersToPx(item.center, pxPerMeter);
                  const widthPx = item.w * pxPerMeter;
                  const heightPx = item.h * pxPerMeter;
                  const defaults = FURNITURE_DEFAULTS[item.kind];
                  const itemColor = isSelected ? "#1F4E79" : defaults.color;
                  return (
                    <Fragment key={item.id}>
                      <Rect
                        name="object"
                        x={centerPx.x}
                        y={centerPx.y}
                        width={widthPx}
                        height={heightPx}
                        offsetX={widthPx / 2}
                        offsetY={heightPx / 2}
                        rotation={item.rotationDeg}
                        fill={defaults.color}
                        opacity={0.6}
                        stroke={itemColor}
                        strokeWidth={isSelected ? 3 : 1.5}
                        onClick={() => {
                          setSelectedObject({ type: "furniture", id: item.id });
                          setSelectedVertex(null);
                        }}
                        onTap={() => {
                          setSelectedObject({ type: "furniture", id: item.id });
                          setSelectedVertex(null);
                        }}
                      />
                      {widthPx > 20 && heightPx > 14 && (
                        <Text
                          listening={false}
                          x={centerPx.x}
                          y={centerPx.y}
                          rotation={item.rotationDeg}
                          text={defaults.label}
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
                      name="object"
                      x={metersToPx(selectedWall.start, pxPerMeter).x}
                      y={metersToPx(selectedWall.start, pxPerMeter).y}
                      radius={6}
                      fill={draggingHandle === "start" ? "#1F4E79" : "#ffffff"}
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
                      name="object"
                      x={metersToPx(selectedWall.end, pxPerMeter).x}
                      y={metersToPx(selectedWall.end, pxPerMeter).y}
                      radius={6}
                      fill={draggingHandle === "end" ? "#1F4E79" : "#ffffff"}
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
          <AiPanel
            plan={{ polygon, walls, columns, furniture }}
            applyActions={applyActions}
            planId={currentPlanId}
            slot={currentSlot}
            conversationSeed={conversationSeed}
          />
        </div>
      )}
      {step === "preview" && sceneSnapshot && (
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
          <VenueSceneLoader
            key={generation}
            polygon={sceneSnapshot.polygon}
            walls={sceneSnapshot.walls}
            columns={sceneSnapshot.columns}
            furniture={sceneSnapshot.furniture}
            venueSizeM={venueSizeM}
            onSceneChange={handleSceneChange}
          />
        </div>
      )}
      <AlertDialog open={sizeConfirmOpen} onOpenChange={setSizeConfirmOpen}>
        <AlertDialogContent data-testid="venue-size-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>變更場地尺寸？</AlertDialogTitle>
            <AlertDialogDescription>
              變更場地尺寸將清除目前所有牆壁、柱子與家具配置，確定要繼續嗎？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="venue-size-confirm-cancel">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="venue-size-confirm-accept"
              onClick={handleSizeConfirmAccept}
            >
              確定變更
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
    </div>
  );
}
