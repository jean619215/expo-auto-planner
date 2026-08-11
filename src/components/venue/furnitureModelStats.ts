// 匯入家具模型(GLB)正規化結果的**依 kind 快取**與存活計數
// (story: venue-refined-3d,task 7)。
//
// 這是 `proceduralFurnitureStats.ts` 的對應物 —— 兩條繪製路徑同構,計數與快取
// 的形狀也刻意做成一樣,探針因此可以用同一種方式讀。獨立成模組的理由也相同:
// 探針要讀這些數字,而 `furnitureModels.tsx` 又要從探針 import 場景圖命名,
// 直接互相 import 會形成循環。
//
// **為什麼要快取(task 7 的效能題目)**:
//
//   1. `normalizeModel()` 的產出**完全由 kind 決定** —— 幾何來自該 kind 的
//      GLB,尺寸來自 `FURNITURE_DEFAULTS`,方位修正來自 `models.ts` 的
//      `rotationY`,沒有任何 per-instance 變化。每趟進步驟 03 重算一次是純粹
//      的浪費,而植栽是 96k 三角面(單一 mesh 就 106,900 面),clone 加三次
//      `applyMatrix4` 是實打實的主執行緒工作。
//   2. React StrictMode(Next.js 預設開啟)會把 render 跑兩次、只 commit 一次。
//      原本「`useMemo` 建立 + `useEffect` 卸載時 dispose」的寫法,被丟棄的那
//      一份 clone **永遠不會有人 dispose**。這一份沒上傳過 GPU,所以
//      `gl.info.memory` 看不見它 —— task 6 在程序化那條路上實測到「預期 9、
//      實際 18」的同一個坑,只是這裡更隱蔽。
//   3. 與 GLB 本身的生命週期一致:`useGLTF` 的 material 與原始 geometry 早就
//      歸模組層快取管,元件不碰。正規化後的 clone 沒有理由用不同的規則。
//
// 快取上限是「有 GLB 的 kind 數 x 每個 GLB 的 mesh 數」,不隨使用增長,所以
// 「往返不累積」仍然成立。驗收方式與程序化那條路相同:往返數趟後 live 不變、
// 且 `totalBuilds` 不再上升 —— 後者才證明快取真的被重用,而不是「沒漲是因為
// 根本沒再建」。

import type * as THREE from "three";

export interface FurnitureModelStats {
  /** 目前快取著的正規化 geometry 數(上限 = 全部有 GLB 的 kind 的 mesh 總數)。 */
  liveGeometries: number;
  /** 累計實際正規化次數 —— 快取命中不會讓它增加。 */
  totalBuilds: number;
  /** 目前快取了幾個 kind。 */
  cachedKinds: number;
}

export interface NormalizedModel<TPart> {
  parts: TPart[];
}

let liveGeometries = 0;
let totalBuilds = 0;

// 值刻意用 unknown 包一層:這個模組不該知道 FurnitureModelPart 的形狀
// (那是 furnitureModels.tsx 的事),它只負責快取與計數。
const cache = new Map<string, { parts: { geometry: THREE.BufferGeometry }[] }>();

export function getFurnitureModelStats(): FurnitureModelStats {
  return { liveGeometries, totalBuilds, cachedKinds: cache.size };
}

/**
 * 取得某個 kind 的正規化結果;第一次呼叫才會真的算,之後一律回傳同一份。
 *
 * `build` 只在 cache miss 時被呼叫,所以呼叫端可以放心在 render 期間呼叫
 * ——穩態下不會新建任何幾何(AGENTS.md:不在 render 期間新建
 * geometry/material/texture)。
 */
export function getOrBuildNormalizedModel<
  TResult extends { parts: { geometry: THREE.BufferGeometry }[] },
>(kind: string, build: () => TResult): TResult {
  const hit = cache.get(kind);
  if (hit) return hit as TResult;

  const built = build();
  totalBuilds += 1;
  liveGeometries += built.parts.length;
  cache.set(kind, built);
  return built;
}
