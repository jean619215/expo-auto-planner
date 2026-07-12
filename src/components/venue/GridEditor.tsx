"use client";

import { useEffect, useRef, useState } from "react";
import {
  axisLabels,
  CELL_SIZE_PX,
  cellKey,
  countCellTypes,
  DEFAULT_GRID_SIZE,
  TOOLS,
  type CellType,
  type GridSize,
  type Tool,
  validateGridSize,
} from "@/lib/venue/grid";

type PaintMode = CellType | "empty" | null;

const CELL_CLASSES: Record<CellType | "empty", string> = {
  floor: "border border-sky-400 bg-sky-300",
  wall: "border border-amber-800 bg-amber-700",
  column: "border border-gray-600 bg-gray-500",
  empty: "border border-gray-300 bg-white",
};

export default function GridEditor() {
  const [size, setSize] = useState<GridSize>(DEFAULT_GRID_SIZE);
  const [cells, setCells] = useState<Map<string, CellType>>(new Map());
  const [widthInput, setWidthInput] = useState(String(DEFAULT_GRID_SIZE.widthM));
  const [heightInput, setHeightInput] = useState(String(DEFAULT_GRID_SIZE.heightM));
  const [sizeError, setSizeError] = useState("");
  const [activeTool, setActiveTool] = useState<Tool>("floor");

  // 目前這一次拖曳筆畫要套用的模式，不用 state 是因為改變它不需要觸發 re-render。
  const paintModeRef = useRef<PaintMode>(null);

  // window 層級的 pointerup 安全網：確保放開位置在網格外時，拖曳筆畫仍會結束。
  useEffect(() => {
    function handleWindowPointerUp() {
      paintModeRef.current = null;
    }
    window.addEventListener("pointerup", handleWindowPointerUp);
    return () => {
      window.removeEventListener("pointerup", handleWindowPointerUp);
    };
  }, []);

  function applyPaint(key: string, mode: CellType | "empty") {
    setCells((prev) => {
      const next = new Map(prev);
      if (mode === "empty") {
        next.delete(key);
      } else {
        next.set(key, mode);
      }
      return next;
    });
  }

  function handleResizeSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateGridSize(widthInput, heightInput);
    if (!result.ok) {
      setSizeError(result.error);
      return;
    }
    setSizeError("");
    setSize(result.size);
    setCells(new Map());
  }

  function handleCellPointerDown(
    event: React.PointerEvent<HTMLDivElement>,
    key: string
  ) {
    event.preventDefault();
    // 瀏覽器會隱含地把 pointer capture 給 pointerdown 目標，導致 pointerenter
    // 不會在拖曳過程中觸發到其他格子上 — 這裡主動釋放讓事件能傳到相鄰格子。
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const current = cells.get(key);
    const mode: CellType | "empty" =
      activeTool === "eraser"
        ? "empty"
        : current === activeTool
          ? "empty"
          : activeTool;
    paintModeRef.current = mode;
    applyPaint(key, mode);
  }

  function handleCellPointerEnter(key: string) {
    if (paintModeRef.current === null) return;
    applyPaint(key, paintModeRef.current);
  }

  function handleGridPointerUp() {
    paintModeRef.current = null;
  }

  function handleGridPointerLeave() {
    paintModeRef.current = null;
  }

  const stats = countCellTypes(cells);
  const topLabels = axisLabels(size.widthM);
  const leftLabels = axisLabels(size.heightM);

  const rows = [];
  for (let y = 0; y < size.heightM; y++) {
    for (let x = 0; x < size.widthM; x++) {
      const key = cellKey(x, y);
      const state = cells.get(key) ?? "empty";
      rows.push(
        <div
          key={key}
          data-x={x}
          data-y={y}
          data-cell-state={state}
          onPointerDown={(e) => handleCellPointerDown(e, key)}
          onPointerEnter={() => handleCellPointerEnter(key)}
          className={CELL_CLASSES[state]}
        />
      );
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={handleResizeSubmit}
        className="flex flex-wrap items-end gap-4"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-zinc-800">寬（公尺）</span>
          <input
            type="text"
            inputMode="numeric"
            value={widthInput}
            onChange={(e) => setWidthInput(e.target.value)}
            data-testid="grid-width-input"
            className="w-24 rounded-lg border border-black/12 bg-transparent px-3 py-2 text-base text-zinc-950 outline-none placeholder:text-zinc-400 focus:border-zinc-500"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-zinc-800">高（公尺）</span>
          <input
            type="text"
            inputMode="numeric"
            value={heightInput}
            onChange={(e) => setHeightInput(e.target.value)}
            data-testid="grid-height-input"
            className="w-24 rounded-lg border border-black/12 bg-transparent px-3 py-2 text-base text-zinc-950 outline-none placeholder:text-zinc-400 focus:border-zinc-500"
          />
        </label>
        <button
          type="submit"
          data-testid="grid-resize-apply"
          className="h-11 rounded-full bg-foreground px-5 font-medium text-background transition-colors hover:bg-[#383838]"
        >
          套用尺寸
        </button>
      </form>

      {sizeError && (
        <p role="alert" data-testid="grid-size-error" className="text-sm text-red-600">
          {sizeError}
        </p>
      )}

      <div data-testid="venue-toolbar" role="toolbar" className="flex flex-wrap gap-2">
        {TOOLS.map((tool) => {
          const isActive = activeTool === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              data-testid={tool.testId}
              aria-pressed={isActive}
              onClick={() => setActiveTool(tool.id)}
              className={
                isActive
                  ? "h-11 rounded-full bg-foreground px-5 font-medium text-background transition-colors"
                  : "h-11 rounded-full border border-black/12 bg-transparent px-5 font-medium text-zinc-800 transition-colors hover:border-zinc-500"
              }
            >
              {tool.label}
            </button>
          );
        })}
      </div>

      <div
        data-testid="venue-grid-frame"
        style={{
          display: "grid",
          gridTemplateColumns: "auto auto",
          gridTemplateRows: "auto auto",
        }}
        className="w-fit select-none"
      >
        <div />
        <div
          data-testid="grid-ruler-top"
          style={{
            position: "relative",
            width: size.widthM * CELL_SIZE_PX,
            height: "1rem",
          }}
        >
          {topLabels.map((v) => (
            <span
              key={v}
              data-axis-value={v}
              style={{
                position: "absolute",
                left: v * CELL_SIZE_PX,
                transform: "translateX(-50%)",
              }}
              className="text-[10px] text-zinc-500"
            >
              {v}
            </span>
          ))}
        </div>
        <div
          data-testid="grid-ruler-left"
          style={{
            position: "relative",
            width: "1.5rem",
            height: size.heightM * CELL_SIZE_PX,
          }}
        >
          {leftLabels.map((v) => (
            <span
              key={v}
              data-axis-value={v}
              style={{
                position: "absolute",
                top: v * CELL_SIZE_PX,
                right: "0.25rem",
                transform: "translateY(-50%)",
              }}
              className="text-[10px] text-zinc-500"
            >
              {v}
            </span>
          ))}
        </div>
        <div
          data-testid="venue-grid"
          onPointerUp={handleGridPointerUp}
          onPointerLeave={handleGridPointerLeave}
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${size.widthM}, ${CELL_SIZE_PX}px)`,
            gridTemplateRows: `repeat(${size.heightM}, ${CELL_SIZE_PX}px)`,
            touchAction: "none",
          }}
        >
          {rows}
        </div>
      </div>

      <p data-testid="grid-scale-legend" className="text-sm text-zinc-600">
        每格 = 1 公尺
      </p>

      <p data-testid="grid-stats" className="text-sm text-zinc-600">
        地板 <span data-testid="stats-floor">{stats.floor}</span> 格（
        {stats.floor} 平方公尺）・牆壁{" "}
        <span data-testid="stats-wall">{stats.wall}</span> 格（{stats.wall}{" "}
        平方公尺）・柱子{" "}
        <span data-testid="stats-column">{stats.column}</span> 格（
        {stats.column} 平方公尺）
      </p>
    </div>
  );
}
