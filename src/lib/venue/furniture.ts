// Pure geometry/domain module for placeable furniture items, mirroring the
// style of plan.ts. Furniture is a rectangle-with-center like Column, so it
// reuses clampColumnCenter for boundary clamping.

import {
  catalogItem,
  requireCatalogItem,
  subCategoryLabel,
} from "./catalog";
import {
  DEFAULT_PLAN_AREA,
  clampColumnCenter,
  createObjectId,
  snapPoint,
  snapToGrid,
  type FloorBounds,
  type PlanPoint,
} from "./plan";

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
 * 舊的 `kind` 對到目錄代碼。
 *
 * 這是 T2 的**過渡橋**:繪製路徑(2D、白模、GLB、程序化、探針)目前全部以
 * `kind` 當索引鍵,T3 才會改成吃 `code`。在那之前,這張表讓「品項只存 code」
 * 與「繪製仍認 kind」兩件事同時成立,而不必讓 `FurnitureItem` 兩個欄位都存。
 *
 * T3 把索引鍵換掉之後,這張表與 `FurnitureKind` 一起刪除。
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

const CODE_TO_KIND = new Map(
  (Object.keys(KIND_TO_CODE) as FurnitureKind[]).map((k) => [KIND_TO_CODE[k], k]),
);

/**
 * 目錄代碼對回舊 `kind`,查不到回傳 `undefined`。
 *
 * 只有 T3 之前還以 `kind` 索引的繪製路徑該用它。目錄長出第十個品項時它就會
 * 回 `undefined` —— 那正是「這條路徑還沒改吃目錄」的訊號,不要用預設值蓋掉。
 */
export function kindForCode(code: string): FurnitureKind | undefined {
  return CODE_TO_KIND.get(code);
}

/**
 * 尺寸/顏色/標籤的舊介面,現在**由目錄推導**而不是自己存一份。
 *
 * 方向刻意是這一邊:兩份數字只要並存就會分岔(這正是 D1 要解掉的問題),所以
 * 目錄是來源,這裡只是換一種索引方式的視圖。T3 之後沒有消費端,整份刪除。
 */
export const FURNITURE_DEFAULTS: Record<
  FurnitureKind,
  { w: number; h: number; label: string; color: string; height3d: number }
> = Object.fromEntries(
  (Object.keys(KIND_TO_CODE) as FurnitureKind[]).map((kind) => {
    const item = requireCatalogItem(KIND_TO_CODE[kind]);
    return [
      kind,
      {
        w: item.w,
        h: item.d,
        // 舊的 label 是不含尺寸的短名(「桌子」),目錄的 name 含尺寸
        // (「桌子 120×70×H75」)。取子類標籤才是同一個東西。
        label: subCategoryLabel(item.subCategory),
        color: item.color,
        height3d: item.height3d,
      },
    ];
  }),
) as Record<
  FurnitureKind,
  { w: number; h: number; label: string; color: string; height3d: number }
>;

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
