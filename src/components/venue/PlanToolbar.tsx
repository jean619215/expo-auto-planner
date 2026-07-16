"use client";

import { MousePointer2, Minus, Square, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type EditorMode = "select" | "wall" | "column";

interface PlanToolbarProps {
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  canDelete: boolean;
  onDelete: () => void;
}

const MODE_BUTTONS: {
  mode: EditorMode;
  label: string;
  testId: string;
  Icon: typeof MousePointer2;
}[] = [
  { mode: "select", label: "選取", testId: "tool-select", Icon: MousePointer2 },
  { mode: "wall", label: "牆壁", testId: "tool-wall", Icon: Minus },
  { mode: "column", label: "柱子", testId: "tool-column", Icon: Square },
];

// 一體式分段控制:共用一圈藍框、段間細分隔線、選中段整塊填藍。
// VenueScene 的移動/旋轉切換也複用這組樣式。
export const segmentClassName = cn(
  "inline-flex h-[34px] items-center gap-1.5 px-3.5 text-sm font-medium",
  "border-l border-l-blueprint-light first:border-l-0",
  "text-blueprint outline-none transition-colors",
  "hover:bg-blueprint-wash focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50",
  "disabled:pointer-events-none disabled:opacity-50",
  "aria-pressed:bg-blueprint aria-pressed:font-bold aria-pressed:text-white",
  "[&_svg]:size-3.5 [&_svg]:shrink-0",
);

export default function PlanToolbar({
  mode,
  onModeChange,
  canDelete,
  onDelete,
}: PlanToolbarProps) {
  return (
    <div
      className="inline-flex overflow-hidden rounded-md border-[1.5px] border-blueprint bg-card"
      role="group"
    >
      {MODE_BUTTONS.map((btn) => {
        const pressed = mode === btn.mode;
        return (
          <button
            key={btn.mode}
            type="button"
            data-testid={btn.testId}
            aria-pressed={pressed}
            onClick={() => onModeChange(btn.mode)}
            className={segmentClassName}
          >
            <btn.Icon />
            {btn.label}
          </button>
        );
      })}
      <button
        type="button"
        data-testid="tool-delete"
        disabled={!canDelete}
        onClick={onDelete}
        className={segmentClassName}
      >
        <Trash2 />
        刪除
      </button>
    </div>
  );
}
