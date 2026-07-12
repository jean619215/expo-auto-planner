"use client";

import { useEffect, useRef, useState } from "react";
import { Circle, Layer, Line, Rect, Stage, Text } from "react-konva";
import type Konva from "konva";
import {
  DEFAULT_FLOOR,
  GRID_MAJOR_M,
  GRID_MINOR_M,
  VENUE_SIZE_M,
  computePxPerMeter,
  findClosestEdge,
  insertVertexOnEdge,
  metersToPx,
  moveVertex,
  pxToMeters,
  removeVertex,
  type FloorPolygon,
  type PlanPoint,
} from "@/lib/venue/plan";

const MIN_STAGE_PX = 320;
const MAX_STAGE_PX = 800;

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

export default function PlanEditor() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [stagePx, setStagePx] = useState(MIN_STAGE_PX);
  const [polygon, setPolygon] = useState<FloorPolygon>(DEFAULT_FLOOR);
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);

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

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (
      (e.key === "Delete" || e.key === "Backspace") &&
      selectedVertex !== null
    ) {
      const next = removeVertex(polygon, selectedVertex);
      setPolygon(next);
      setSelectedVertex(null);
    }
  }

  const polygonPx = polygon.flatMap((p) => {
    const px = metersToPx(p, pxPerMeter);
    return [px.x, px.y];
  });

  return (
    <div
      ref={containerRef}
      data-testid="plan-editor"
      data-vertex-count={polygon.length}
      data-vertices={JSON.stringify(polygon)}
      data-px-per-meter={pxPerMeter}
      data-stage-size={stagePx}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="w-full outline-none"
    >
      <Stage width={stagePx} height={stagePx}>
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
        <Layer>
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
                onClick={() => setSelectedVertex(index)}
                onTap={() => setSelectedVertex(index)}
                onDragMove={(e) => handleVertexDragMove(index, e)}
                onDragEnd={(e) => handleVertexDragEnd(index, e)}
                onContextMenu={(e) => handleVertexContextMenu(index, e)}
              />
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}
