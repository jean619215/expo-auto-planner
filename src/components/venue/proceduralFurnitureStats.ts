// 程序化家具幾何/材質的**依 kind 快取**與存活計數(story: venue-refined-3d,
// task 6)。
//
// 獨立成一個模組而不是放在 `proceduralFurniture.tsx` 裡:探針
// (`RefinedSceneProbe.tsx`)要讀這些數字,而 `proceduralFurniture.tsx` 又要
// 從探針 import 場景圖命名 —— 兩邊直接互相 import 會形成循環。
//
// **為什麼是模組層快取,而不是每次掛載各自 new + 卸載時 dispose**:
//
//   1. 一個 kind 的零件幾何與材質**完全由 kind 決定**(尺寸來自
//      FURNITURE_DEFAULTS,顏色來自同一份常數),沒有任何 per-instance 變化
//      —— 每次進步驟 03 重建一次是純粹的浪費,往返一次就重做一次。
//   2. React StrictMode(Next.js 預設開啟)會把 render 跑兩次,`useMemo` 也就
//      跑兩次,但只有一次會 commit。用「useMemo 建立 + useEffect 卸載時
//      dispose」的寫法,被丟掉的那一份**永遠不會有人 dispose** —— 這不是假設,
//      是本 task 的存活計數第一次跑就抓到的:預期 9 個,實際 18 個。
//   3. 這與匯入模型那條路的做法一致:GLB 的 material 生命週期本來就歸
//      `useGLTF` 的模組層快取管,元件不碰。
//
// 快取上限是「有程序化造型的 kind 數 x 每種零件數」= 3 x 3 = 9 組,不隨使用
// 增長,所以「往返不累積」仍然成立(驗收見 venue-procedural-furniture.spec.ts
// 的 P6:往返三趟後 live 仍是 9、且 totalBuilds 沒有再漲 —— 後者證明快取真的
// 被重用,而不是「沒漲是因為根本沒再建」)。

import type * as THREE from "three";

export interface ProceduralFurnitureStats {
  /** 目前快取著的 geometry 數(上限 = 全部 kind 的零件總數)。 */
  liveGeometries: number;
  /** 目前快取著的 material 數。 */
  liveMaterials: number;
  /** 累計實際建置次數 —— 快取命中不會讓它增加。 */
  totalBuilds: number;
}

export interface CachedFurniturePart {
  id: string;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
}

let liveGeometries = 0;
let liveMaterials = 0;
let totalBuilds = 0;

const cache = new Map<string, CachedFurniturePart[]>();

export function getProceduralFurnitureStats(): ProceduralFurnitureStats {
  return { liveGeometries, liveMaterials, totalBuilds };
}

/**
 * 取得某個 kind 的零件資源;第一次呼叫才會真的建置,之後一律回傳同一組。
 *
 * `build` 只在 cache miss 時被呼叫,所以呼叫端可以放心在 render 期間呼叫這個
 * 函式 —— 穩態下它不會新建任何 GPU 資源(AGENTS.md:不在 render 期間新建
 * geometry/material/texture)。
 */
export function getOrBuildProceduralParts(
  kind: string,
  build: () => CachedFurniturePart[]
): CachedFurniturePart[] {
  const hit = cache.get(kind);
  if (hit) return hit;

  const built = build();
  totalBuilds += 1;
  liveGeometries += built.length;
  liveMaterials += built.length;
  cache.set(kind, built);
  return built;
}

