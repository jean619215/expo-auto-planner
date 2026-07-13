"use client";

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
          <button
            key={btn.mode}
            type="button"
            data-testid={btn.testId}
            aria-pressed={pressed}
            onClick={() => onModeChange(btn.mode)}
            className={
              pressed
                ? "rounded border border-blue-600 bg-blue-600 px-3 py-1 text-sm font-medium text-white"
                : "rounded border border-stone-300 bg-white px-3 py-1 text-sm font-medium text-stone-700"
            }
          >
            {btn.label}
          </button>
        );
      })}
      <button
        type="button"
        data-testid="tool-delete"
        disabled={!canDelete}
        onClick={onDelete}
        className="rounded border border-stone-300 bg-white px-3 py-1 text-sm font-medium text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        刪除
      </button>
    </div>
  );
}
