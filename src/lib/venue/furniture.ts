// Pure geometry/domain module for placeable furniture items, mirroring the
// style of plan.ts. Furniture is a rectangle-with-center like Column, so it
// reuses clampColumnCenter for boundary clamping.

import { catalogItem, requireCatalogItem } from "./catalog";
import {
  DEFAULT_PLAN_AREA,
  clampColumnCenter,
  createObjectId,
  snapPoint,
  snapToGrid,
  type FloorBounds,
  type PlanPoint,
} from "./plan";

/** AI 工具參數用的舊分類名。除了 `KIND_TO_CODE` 之外不該有新的使用者。 */
export type FurnitureKind =
  | "table"
  | "chair"
  | "cabinet"
  | "counter"
  | "bannerStand"
  | "sofa"
  | "podium"
  | "plant"
  | "display";

/**
 * 放好的一件家具。
 *
 * **只存 `code`**(第三輪 D1):尺寸、顏色、分類、價格、幾何來源全部查目錄。
 * 上一版把 `w`/`h` 存在這裡當建立當下的快照,而 `height3d` 每次現查常數表 ——
 * 改了尺寸的家具會變成「2D 是舊尺寸、3D 是新尺寸」的同一件東西。單一來源之後
 * 那個坑不存在。
 */
export interface FurnitureItem {
  id: string;
  /** 目錄代碼(`CatalogItem.code`)。 */
  code: string;
  center: PlanPoint; // meters
  rotationDeg: number; // 0 = unrotated, normalized to [0, 360)
}

/**
 * AI 工具參數的 `kind` 對到目錄代碼。
 *
 * T3 已把所有繪製路徑改成以 `code` 索引,這張表**只剩 AI 這一條進入路徑**在用
 * (`src/lib/ai-panel/actions.ts` 的 schema 仍是 kind 聯集)。T4 把 schema 換成
 * 自由字串代碼 + 伺服器端驗證之後,這張表與 `FurnitureKind` 一起刪除。
 *
 * 注意:這裡回傳 `string`,而 `FurnitureKind` 本身也是字串聯集 —— 把 kind 直接
 * 傳給吃 `code: string` 的函式,型別完全合法但執行期查不到。轉換不能省。
 */
export const KIND_TO_CODE: Record<FurnitureKind, string> = {
  table: "TBL-120-75",
  chair: "CHR-45-90",
  cabinet: "CAB-60-180",
  counter: "CNT-100-110",
  bannerStand: "BNR-80-200",
  sofa: "SOF-180-80",
  podium: "POD-60-110",
  plant: "PLT-50-120",
  display: "DSP-100-160",
};

/** 舊 `kind` 對應的目錄代碼。 */
export function codeForKind(kind: FurnitureKind): string {
  return KIND_TO_CODE[kind];
}

function normalizeDeg(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

// Rotated footprints can poke slightly outside the venue boundary since
// clampColumnCenter only clamps the unrotated w x h axis-aligned box — an
// accepted limitation for a whitebox planning tool, not solved here.
export function createFurniture(
  code: string,
  rawCenter: PlanPoint,
  area: FloorBounds = DEFAULT_PLAN_AREA,
): FurnitureItem {
  const item = requireCatalogItem(code);
  return {
    id: createObjectId(),
    code,
    center: clampColumnCenter(snapPoint(rawCenter, area), item.w, item.d, area),
    rotationDeg: 0,
  };
}

/**
 * 一件家具的平面佔地(公尺)。
 *
 * 代碼查不到(存檔裡的品項已下架)時退回 0×0:夾制會把它當成一個點,位置還在、
 * 不會跳走,而繪製端拿不到 `catalogItem` 自然畫不出來 —— 比猜一個尺寸畫一個
 * 錯的方塊誠實。
 */
export function furnitureFootprintM(item: FurnitureItem): {
  w: number;
  h: number;
} {
  const entry = catalogItem(item.code);
  return entry ? { w: entry.w, h: entry.d } : { w: 0, h: 0 };
}

export function translateFurniture(
  item: FurnitureItem,
  deltaRaw: PlanPoint,
  area: FloorBounds = DEFAULT_PLAN_AREA,
): FurnitureItem {
  const deltaX = snapToGrid(deltaRaw.x);
  const deltaY = snapToGrid(deltaRaw.y);
  const moved = {
    x: item.center.x + deltaX,
    y: item.center.y + deltaY,
  };
  const { w, h } = furnitureFootprintM(item);
  return {
    ...item,
    center: clampColumnCenter(moved, w, h, area),
  };
}

export function rotateFurniture(item: FurnitureItem, rotationDeg: number): FurnitureItem {
  return { ...item, rotationDeg: normalizeDeg(rotationDeg) };
}
