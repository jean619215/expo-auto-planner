"use client";

import { Button } from "@/components/ui/button";

export type EditorMode = "select" | "wall" | "column";

interface PlanToolbarProps {
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  canDelete: boolean;
  onDelete: () => void;
}

const MODE_BUTTONS: { mode: EditorMode; label: string; testId: string }[] = [
  { mode: "select", label: "選取", testId: "tool-select" },
  { mode: "wall", label: "牆壁", testId: "tool-wall" },
  { mode: "column", label: "柱子", testId: "tool-column" },
];

export default function PlanToolbar({
  mode,
  onModeChange,
  canDelete,
  onDelete,
}: PlanToolbarProps) {
  return (
    <div className="mb-2 flex items-center gap-2" role="group">
      {MODE_BUTTONS.map((btn) => {
        const pressed = mode === btn.mode;
        return (
          <Button
            key={btn.mode}
            type="button"
            variant={pressed ? "default" : "outline"}
            data-testid={btn.testId}
            aria-pressed={pressed}
            onClick={() => onModeChange(btn.mode)}
          >
            {btn.label}
          </Button>
        );
      })}
      <Button
        type="button"
        variant="outline"
        data-testid="tool-delete"
        disabled={!canDelete}
        onClick={onDelete}
      >
        刪除
      </Button>
    </div>
  );
}
