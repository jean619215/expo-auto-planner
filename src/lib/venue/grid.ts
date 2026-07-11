// 場地白模產生器 — 網格共用型別與純函式。
// 無 React 依賴，供 GridEditor 與未來 Task 4 的 3D 產生器共用。

export type CellType = "floor" | "wall" | "column";

/** 工具列可選擇的工具：三種畫格子類型，加上擦除。 */
export type Tool = CellType | "eraser";

export const TOOLS: ReadonlyArray<{ id: Tool; label: string; testId: string }> = [
  { id: "floor", label: "畫地板", testId: "tool-floor" },
  { id: "wall", label: "畫牆壁", testId: "tool-wall" },
  { id: "column", label: "畫柱子", testId: "tool-column" },
  { id: "eraser", label: "擦除", testId: "tool-eraser" },
];

export type GridSize = {
  widthM: number;
  heightM: number;
};

export const DEFAULT_GRID_SIZE: GridSize = { widthM: 10, heightM: 10 };
export const MIN_DIMENSION_M = 1;
export const MAX_DIMENSION_M = 50;
export const MAX_TOTAL_CELLS = 2500;
export const CELL_SIZE_PX = 24;

/** 建立 Map 的 key："x,y"（0-indexed，col,row）。 */
export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export type ValidateGridSizeResult =
  | { ok: true; size: GridSize }
  | { ok: false; error: string };

/**
 * 驗證使用者輸入的寬/高（公尺）。拒絕不合法輸入並回傳錯誤訊息，
 * 絕不靜默夾住（clamp）到某個預設值 — 規格明確要求要告知使用者。
 */
export function validateGridSize(
  widthInput: string,
  heightInput: string
): ValidateGridSizeResult {
  const widthM = Number(widthInput);
  const heightM = Number(heightInput);

  if (
    !Number.isInteger(widthM) ||
    !Number.isInteger(heightM) ||
    widthM < MIN_DIMENSION_M ||
    heightM < MIN_DIMENSION_M
  ) {
    return {
      ok: false,
      error: `寬度與高度必須是至少 ${MIN_DIMENSION_M} 的整數公尺數`,
    };
  }

  if (
    widthM > MAX_DIMENSION_M ||
    heightM > MAX_DIMENSION_M ||
    widthM * heightM > MAX_TOTAL_CELLS
  ) {
    return {
      ok: false,
      error: `最大網格為 ${MAX_DIMENSION_M}m × ${MAX_DIMENSION_M}m（${MAX_TOTAL_CELLS} 格）`,
    };
  }

  return { ok: true, size: { widthM, heightM } };
}
