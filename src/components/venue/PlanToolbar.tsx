"use client";

import { MousePointer2, Minus, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

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

export default function PlanToolbar({
  mode,
  onModeChange,
  canDelete,
  onDelete,
}: PlanToolbarProps) {
  return (
    <div
      className="mb-2 flex items-center gap-1 rounded-lg border border-line bg-card p-1"
      role="group"
    >
      {MODE_BUTTONS.map((btn) => {
        const pressed = mode === btn.mode;
        return (
          <Button
            key={btn.mode}
            type="button"
            size="sm"
            variant={pressed ? "default" : "outline"}
            data-testid={btn.testId}
            aria-pressed={pressed}
            onClick={() => onModeChange(btn.mode)}
          >
            <btn.Icon />
            {btn.label}
          </Button>
        );
      })}
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-testid="tool-delete"
        disabled={!canDelete}
        onClick={onDelete}
      >
        <Trash2 />
        刪除
      </Button>
    </div>
  );
}
