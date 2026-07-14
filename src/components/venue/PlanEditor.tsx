"use client";

import { useEffect, useRef, useState } from "react";
import { Circle, Layer, Line, Rect, Stage, Text } from "react-konva";
import type Konva from "konva";
import {
  DEFAULT_FLOOR,
  GRID_MAJOR_M,
  GRID_MINOR_M,
  VENUE_SIZE_M,
  WALL_THICKNESS_M,
  computePxPerMeter,
  createColumn,
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
  snapPoint,
  translateColumn,
  translateWall,
  wallLengthM,
  type Column,
  type FloorPolygon,
  type PlanPoint,
  type WallSegment,
} from "@/lib/venue/plan";
import PlanToolbar, { type EditorMode } from "./PlanToolbar";
import VenueSceneLoader from "./VenueSceneLoader";

const MIN_STAGE_PX = 320;
const MAX_STAGE_PX = 800;

type SelectedObject = { type: "wall" | "column"; id: string } | null;

function buildGridLines(pxPerMeter: number) {
  const lines: { key: string; points: number[]; stroke: string; strokeWidth: number }[] = [];
  const sizePx = VENUE_SIZE_M * pxPerMeter;

  for (let m = 0; m <= VENUE_SIZE_M; m += GRID_MINOR_M) {
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

function angleDegrees(start: PlanPoint, end: PlanPoint): number {
  return (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
}

function targetName(
  e: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
): string {
  return typeof e.target.name === "function" ? e.target.name() : "";
}

export default function PlanEditor() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [stagePx, setStagePx] = useState(MIN_STAGE_PX);
  const [polygon, setPolygon] = useState<FloorPolygon>(DEFAULT_FLOOR);
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);

  const [mode, setMode] = useState<EditorMode>("select");
  const [walls, setWalls] = useState<WallSegment[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [selectedObject, setSelectedObject] = useState<SelectedObject>(null);
  const [draftWall, setDraftWall] = useState<{ start: PlanPoint; end: PlanPoint } | null>(
    null,
  );
  const [draggingHandle, setDraggingHandle] = useState<"start" | "end" | null>(null);
  const [draggingColumnCorner, setDraggingColumnCorner] = useState<{
    x: -1 | 1;
    y: -1 | 1;
  } | null>(null);
  const suppressObjectClickRef = useRef(false);
  const [sceneSnapshot, setSceneSnapshot] = useState<{
    polygon: FloorPolygon;
    walls: WallSegment[];
    columns: Column[];
  } | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const width = container.clientWidth;
      setStagePx(Math.max(MIN_STAGE_PX, Math.min(MAX_STAGE_PX, width)));
    };

    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const pxPerMeter = computePxPerMeter(stagePx);
  const gridLines = buildGridLines(pxPerMeter);

  function handleVertexDragMove(
    index: number,
    e: Konva.KonvaEventObject<DragEvent>,
  ) {
    const node = e.target;
    const meterPoint = pxToMeters({ x: node.x(), y: node.y() }, pxPerMeter);
    const next = moveVertex(polygon, index, meterPoint);
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
    const next = moveVertex(polygon, index, meterPoint);
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
    const next = insertVertexOnEdge(polygon, edgeIndex, meterPoint);
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
    } else {
      setColumns((prev) => prev.filter((c) => c.id !== selectedObject.id));
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

  function handleGenerate3D() {
    setSceneSnapshot({ polygon, walls, columns });
    setGeneration((g) => g + 1);
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
      const snapped = snapPoint(meterPoint);
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
    const snapped = snapPoint(meterPoint);
    setDraftWall({ start: draftWall.start, end: snapped });
  }

  function handleStageMouseUp(
    e: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ) {
    if (mode === "wall") {
      if (draftWall) {
        const wall = createWall(draftWall.start, draftWall.end);
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
      const column = createColumn(meterPoint);
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
    const updated = translateWall(wall, deltaM);
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
    const updated = translateColumn(column, deltaM);
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
    const updated = moveWallEndpoint(wall, which, meterPoint);
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
    const updated = resizeColumnCorner(column, corner, meterPoint);
    setColumns((prev) => prev.map((c) => (c.id === column.id ? updated : c)));
    const cornerMeter = {
      x: updated.center.x + (corner.x * updated.w) / 2,
      y: updated.center.y + (corner.y * updated.h) / 2,
    };
    const snappedPx = metersToPx(cornerMeter, pxPerMeter);
    node.position(snappedPx);
  }

  const polygonPx = polygon.flatMap((p) => {
    const px = metersToPx(p, pxPerMeter);
    return [px.x, px.y];
  });

  const thicknessPx = WALL_THICKNESS_M * pxPerMeter;

  const selectedWall =
    selectedObject?.type === "wall"
      ? walls.find((w) => w.id === selectedObject.id) ?? null
      : null;

  const selectedColumn =
    selectedObject?.type === "column"
      ? columns.find((c) => c.id === selectedObject.id) ?? null
      : null;

  const columnLabelText = selectedColumn
    ? `${selectedColumn.w.toFixed(1)} x ${selectedColumn.h.toFixed(1)} m`
    : "";

  const wallLabelText = selectedWall ? formatMeters(wallLengthM(selectedWall)) : "";

  const canGenerate3D = walls.length > 0 || columns.length > 0;

  const edgeLabelTexts = polygon.map((vertex, i) => {
    const next = polygon[(i + 1) % polygon.length];
    return formatMeters(Math.hypot(next.x - vertex.x, next.y - vertex.y));
  });

  return (
    <div
      ref={containerRef}
      data-testid="plan-editor"
      data-vertex-count={polygon.length}
      data-vertices={JSON.stringify(polygon)}
      data-px-per-meter={pxPerMeter}
      data-stage-size={stagePx}
      data-mode={mode}
      data-wall-count={walls.length}
      data-column-count={columns.length}
      data-selected-id={selectedObject?.id ?? ""}
      data-selected-type={selectedObject?.type ?? ""}
      data-objects={JSON.stringify({ walls, columns })}
      data-column-label={columnLabelText}
      data-wall-label={wallLabelText}
      data-edge-labels={JSON.stringify(edgeLabelTexts)}
      data-scene-generated={sceneSnapshot !== null}
      data-generation={generation}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="w-full outline-none"
    >
      <PlanToolbar
        mode={mode}
        onModeChange={handleModeChange}
        canDelete={selectedObject !== null}
        onDelete={deleteSelectedObject}
      />
      <button
        type="button"
        data-testid="generate-3d-button"
        disabled={!canGenerate3D}
        onClick={handleGenerate3D}
        className="mb-2 rounded border border-stone-300 bg-white px-3 py-1 text-sm font-medium text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        產生 3D 模型
      </button>
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
            { length: VENUE_SIZE_M / GRID_MAJOR_M + 1 },
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
            { length: VENUE_SIZE_M / GRID_MAJOR_M + 1 },
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
            stroke="#3b82f6"
            strokeWidth={2}
            onDblClick={handleEdgeDblClick}
          />
          {polygon.map((vertex, index) => {
            const px = metersToPx(vertex, pxPerMeter);
            return (
              <Circle
                key={index}
                x={px.x}
                y={px.y}
                radius={6}
                fill={selectedVertex === index ? "#3b82f6" : "#ffffff"}
                stroke="#3b82f6"
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
              selectedObject?.type === "wall" && selectedObject.id === wall.id;
            const startPx = metersToPx(wall.start, pxPerMeter);
            const lengthM = Math.hypot(
              wall.end.x - wall.start.x,
              wall.end.y - wall.start.y,
            );
            const lengthPx = lengthM * pxPerMeter;
            return (
              <Rect
                key={wall.id}
                name="object"
                x={startPx.x}
                y={startPx.y}
                width={lengthPx}
                height={thicknessPx}
                offsetY={thicknessPx / 2}
                rotation={angleDegrees(wall.start, wall.end)}
                fill="#78350f"
                stroke={isSelected ? "#3b82f6" : undefined}
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
            );
          })}
          {columns.map((column) => {
            const isSelected =
              selectedObject?.type === "column" &&
              selectedObject.id === column.id;
            const centerPx = metersToPx(column.center, pxPerMeter);
            const widthPx = column.w * pxPerMeter;
            const heightPx = column.h * pxPerMeter;
            return (
              <Rect
                key={column.id}
                name="object"
                x={centerPx.x}
                y={centerPx.y}
                width={widthPx}
                height={heightPx}
                offsetX={widthPx / 2}
                offsetY={heightPx / 2}
                fill="#78716c"
                stroke={isSelected ? "#3b82f6" : "#57534e"}
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
                x: selectedColumn.center.x + (corner.x * selectedColumn.w) / 2,
                y: selectedColumn.center.y + (corner.y * selectedColumn.h) / 2,
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
                  fill={isDragging ? "#3b82f6" : "#ffffff"}
                  stroke="#3b82f6"
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
              const columnCenterPx = metersToPx(selectedColumn.center, pxPerMeter);
              return (
                <Text
                  listening={false}
                  x={columnCenterPx.x + (selectedColumn.w * pxPerMeter) / 2 + 4}
                  y={columnCenterPx.y - (selectedColumn.h * pxPerMeter) / 2 - 16}
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
                fill={draggingHandle === "start" ? "#3b82f6" : "#ffffff"}
                stroke="#3b82f6"
                strokeWidth={2}
                hitStrokeWidth={16}
                draggable
                onDragStart={() => setDraggingHandle("start")}
                onDragMove={(e) => handleWallEndpointDrag(selectedWall, "start", e)}
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
                fill={draggingHandle === "end" ? "#3b82f6" : "#ffffff"}
                stroke="#3b82f6"
                strokeWidth={2}
                hitStrokeWidth={16}
                draggable
                onDragStart={() => setDraggingHandle("end")}
                onDragMove={(e) => handleWallEndpointDrag(selectedWall, "end", e)}
                onDragEnd={(e) => {
                  handleWallEndpointDrag(selectedWall, "end", e);
                  setDraggingHandle(null);
                }}
              />
            </>
          )}
        </Layer>
      </Stage>
      {sceneSnapshot && (
        <VenueSceneLoader
          key={generation}
          polygon={sceneSnapshot.polygon}
          walls={sceneSnapshot.walls}
          columns={sceneSnapshot.columns}
        />
      )}
    </div>
  );
}
