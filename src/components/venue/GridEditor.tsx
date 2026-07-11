"use client";

import { useEffect, useRef, useState } from "react";
import {
  CELL_SIZE_PX,
  cellKey,
  DEFAULT_GRID_SIZE,
  type CellType,
  type GridSize,
  validateGridSize,
} from "@/lib/venue/grid";

type PaintMode = "floor" | "empty" | null;

export default function GridEditor() {
  const [size, setSize] = useState<GridSize>(DEFAULT_GRID_SIZE);
  const [cells, setCells] = useState<Map<string, CellType>>(new Map());
  const [widthInput, setWidthInput] = useState(String(DEFAULT_GRID_SIZE.widthM));
  const [heightInput, setHeightInput] = useState(String(DEFAULT_GRID_SIZE.heightM));
  const [sizeError, setSizeError] = useState("");

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

  function applyPaint(key: string, mode: "floor" | "empty") {
    setCells((prev) => {
      const next = new Map(prev);
      if (mode === "floor") {
        next.set(key, "floor");
      } else {
        next.delete(key);
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
    const mode: "floor" | "empty" = cells.has(key) ? "empty" : "floor";
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

  const rows = [];
  for (let y = 0; y < size.heightM; y++) {
    for (let x = 0; x < size.widthM; x++) {
      const key = cellKey(x, y);
      const isFloor = cells.has(key);
      rows.push(
        <div
          key={key}
          data-x={x}
          data-y={y}
          data-cell-state={isFloor ? "floor" : "empty"}
          onPointerDown={(e) => handleCellPointerDown(e, key)}
          onPointerEnter={() => handleCellPointerEnter(key)}
          className={
            isFloor
              ? "border border-sky-400 bg-sky-300"
              : "border border-gray-300 bg-white"
          }
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
            className="w-24 rounded-lg border border-black/12 bg-transparent px-3 py-2 text-base outline-none focus:border-zinc-500"
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
            className="w-24 rounded-lg border border-black/12 bg-transparent px-3 py-2 text-base outline-none focus:border-zinc-500"
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
        className="w-fit select-none"
      >
        {rows}
      </div>
    </div>
  );
}
