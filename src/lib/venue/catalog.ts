// 家具目錄 —— 純領域模組(不得 import React / DOM / Konva / Three)。
//
// 這一份取代「9 種寫死的 kind」成為家具的單一資料來源:尺寸、顏色、幾何來源、
// 分類與價格全部住在這裡,`FurnitureItem` 只存 `code` 並在需要時查回來。
//
// **為什麼品項身上不存分類與尺寸**(第三輪 D1):兩個欄位描述同一件事就可能
// 不一致 —— 存檔裡的 `w` 是建立當下的快照,而 `height3d` 每次現查常數表,改
// 了尺寸就會出現「2D 是舊尺寸、3D 是新尺寸」的同一件家具。查表沒有這個問題。
//
// 欄位形狀照**廠商型錄**設計(D3/D5):現階段代碼與價格由我們自己編,拿到真
// 型錄時換掉的是這個陣列的內容,不是它的結構,消費端一行都不用動。

import { MODEL_BASE_PATH } from "./models";

/** 幣別。目前只有台幣,留成聯集是為了讓未來多幣別是型別擴充而不是欄位改型。 */
export type CatalogCurrency = "TWD";

/**
 * 程序化造型的形狀名,與 `proceduralFurniture.ts` 的 `BUILDERS` 一一對應。
 *
 * **方正規格件一律走這裡**(第三輪 D4):目錄要有「桌子 H75」與「桌子 H100」
 * 兩個品項,而一份 GLB 只有一種比例 —— 等比縮放做不出兩種正確高度,非等比
 * 拉伸又違反「匯入模型一律等比縮放」的硬規定。程序化造型的尺寸就是參數。
 *
 * 留給 GLB 的只剩有曲面、方箱畫不出來的:椅子、沙發、植栽。
 */
export type ProceduralShape =
  | "counter"
  | "bannerStand"
  | "podium"
  | "table"
  | "cabinet"
  | "displayCase";

/**
 * 品項的幾何來源。
 *
 * `model` 的三個欄位與 `models.ts` 的 `FurnitureModel` 同形 —— 那份 manifest
 * 是 T3 之前的過渡,繪製路徑改吃目錄之後就由這裡取代。
 */
export type CatalogGeometry =
  | { kind: "procedural"; shape: ProceduralShape }
  | { kind: "model"; url: string; rotationY: number; deferred: boolean };

/** 大類(目錄頁的第一層導覽)。 */
export interface CatalogCategory {
  code: string;
  label: string;
}

/** 子類(第二層)。`category` 必須指得到 `CATEGORIES` 裡的某一列。 */
export interface CatalogSubCategory {
  code: string;
  category: string;
  label: string;
}

/** 品項(第三層)—— 使用者實際下單/擺放的東西。 */
export interface CatalogItem {
  /** 型錄代碼,全目錄唯一。這是 `FurnitureItem` 存的那一個值。 */
  code: string;
  /** 中文品名,含尺寸(給使用者看)。 */
  name: string;
  /** 英文規格名(對搭建廠商溝通用)。 */
  spec: string;
  category: string;
  subCategory: string;
  /** 平面寬(公尺,對應平面圖的 x 軸)。 */
  w: number;
  /** 平面深(公尺,對應平面圖的 y 軸)。 */
  d: number;
  /** 立面高(公尺)。 */
  height3d: number;
  /** 未稅單價。 */
  price: number;
  currency: CatalogCurrency;
  /** 供應商。現階段一律 `null`,欄位先留著等真型錄。 */
  supplier: string | null;
  geometry: CatalogGeometry;
  /** 2D 平面圖與白模的填色。 */
  color: string;
}

export const CATEGORIES: readonly CatalogCategory[] = [
  { code: "A", label: "展示設備" },
  { code: "B", label: "桌椅" },
  { code: "C", label: "櫃檯與收納" },
  { code: "D", label: "佈景裝飾" },
];

export const SUB_CATEGORIES: readonly CatalogSubCategory[] = [
  { code: "A1", category: "A", label: "展示櫃" },
  { code: "A2", category: "A", label: "展示架" },
  { code: "B1", category: "B", label: "桌子" },
  { code: "B2", category: "B", label: "椅子" },
  { code: "B3", category: "B", label: "沙發" },
  { code: "C1", category: "C", label: "接待櫃檯" },
  { code: "C2", category: "C", label: "講台" },
  { code: "C3", category: "C", label: "櫃子" },
  { code: "D1", category: "D", label: "植栽" },
];

function modelGeometry(
  file: string,
  rotationY: number,
  deferred: boolean,
): CatalogGeometry {
  return { kind: "model", url: `${MODEL_BASE_PATH}/${file}`, rotationY, deferred };
}

/**
 * 目錄本體。
 *
 * **價格是 demo 值**(D3):現階段沒有真實廠商報價,這些數字用來驗證「畫圖時
 * 看得到累計金額」這件事,不能拿去對外報價。
 *
 * `geometry` 登記的是**目前**的繪製方式,不是 D4 的目標狀態 —— 桌子/櫃子/
 * 展示櫃現在還走 GLB,T5 才會改成程序化。T2 不改行為。
 *
 * 尺寸與顏色的數字是從 `FURNITURE_DEFAULTS` 逐字搬過來的,不是重新訂的:T2
 * 是搬家不是改設計。視覺與幾何若在這一步變動,既有的白模輪廓/程序化外廓/
 * 模型等比縮放三組 spec 就分不出「目錄接錯了」與「尺寸本來就改了」。搬完之後
 * `FURNITURE_DEFAULTS` 反過來由這裡推導(見 `furniture.ts`),兩份不會再有機會
 * 分岔。
 */
export const CATALOG: readonly CatalogItem[] = [
  {
    code: "DSP-100-160",
    name: "展示櫃 100×50×H160",
    spec: "Display Cabinet",
    category: "A",
    subCategory: "A1",
    price: 3200,
    currency: "TWD",
    supplier: null,
    geometry: { kind: "procedural", shape: "displayCase" },
    w: 1.0,
    d: 0.5,
    height3d: 1.6,
    color: "#7a5c94",
  },
  {
    code: "BNR-80-200",
    name: "展示架 80×30×H200",
    spec: "Banner Stand",
    category: "A",
    subCategory: "A2",
    price: 1800,
    currency: "TWD",
    supplier: null,
    geometry: { kind: "procedural", shape: "bannerStand" },
    w: 0.8,
    d: 0.3,
    height3d: 2.0,
    color: "#c2452f",
  },
  {
    code: "TBL-120-75",
    name: "桌子 120×70×H75",
    spec: "Table",
    category: "B",
    subCategory: "B1",
    price: 650,
    currency: "TWD",
    supplier: null,
    geometry: { kind: "procedural", shape: "table" },
    w: 1.2,
    d: 0.7,
    height3d: 0.75,
    color: "#8a6d3b",
  },
  {
    // 與 TBL-120-75 同款、只有高度不同 —— 這一對就是 D4 的存在理由:
    // 兩個品項共用一個造型(`shape: "table"`),各自的高度是參數。
    // GLB 做不到這件事,而使用者要的本來就是「選另一個型號」而不是拉高桌子。
    code: "TBL-120-100",
    name: "高桌 120×70×H100",
    spec: "Bar Table",
    category: "B",
    subCategory: "B1",
    price: 780,
    currency: "TWD",
    supplier: null,
    geometry: { kind: "procedural", shape: "table" },
    w: 1.2,
    d: 0.7,
    height3d: 1.0,
    color: "#8a6d3b",
  },
  {
    code: "CHR-45-90",
    name: "椅子 45×45×H90",
    spec: "Side Chair",
    category: "B",
    subCategory: "B2",
    price: 220,
    currency: "TWD",
    supplier: null,
    geometry: modelGeometry("chair.glb", 0, false),
    w: 0.45,
    d: 0.45,
    height3d: 0.9,
    color: "#5b7a9d",
  },
  {
    code: "SOF-180-80",
    name: "沙發 180×80×H80",
    spec: "Three-seat Sofa",
    category: "B",
    subCategory: "B3",
    price: 4500,
    currency: "TWD",
    supplier: null,
    geometry: modelGeometry("sofa.glb", 0, false),
    w: 1.8,
    d: 0.8,
    height3d: 0.8,
    color: "#4a7a6d",
  },
  {
    code: "CNT-100-110",
    name: "接待櫃檯 100×50×H110",
    spec: "Info Counter",
    category: "C",
    subCategory: "C1",
    price: 2400,
    currency: "TWD",
    supplier: null,
    geometry: { kind: "procedural", shape: "counter" },
    w: 1.0,
    d: 0.5,
    height3d: 1.1,
    color: "#a0724d",
  },
  {
    code: "POD-60-110",
    name: "講台 60×50×H110",
    spec: "Lectern",
    category: "C",
    subCategory: "C2",
    price: 1500,
    currency: "TWD",
    supplier: null,
    geometry: { kind: "procedural", shape: "podium" },
    w: 0.6,
    d: 0.5,
    height3d: 1.1,
    color: "#3e5c76",
  },
  {
    code: "CAB-60-180",
    name: "櫃子 60×120×H180",
    spec: "Storage Cabinet",
    category: "C",
    subCategory: "C3",
    price: 2800,
    currency: "TWD",
    supplier: null,
    // 模型原生長邊在 X,平面圖目標長邊在 Y(見 models.ts 的同一筆)。
    geometry: { kind: "procedural", shape: "cabinet" },
    w: 0.6,
    d: 1.2,
    height3d: 1.8,
    color: "#6b5b95",
  },
  {
    code: "PLT-50-120",
    name: "植栽 50×50×H120",
    spec: "Potted Plant",
    category: "D",
    subCategory: "D1",
    price: 900,
    currency: "TWD",
    supplier: null,
    // 原生 96k 三角面、GLB 1.32MB,是其餘五個加起來的量級 —— 延後載入。
    geometry: modelGeometry("plant.glb", 0, true),
    w: 0.5,
    d: 0.5,
    height3d: 1.2,
    color: "#4f8a3d",
  },
];

/**
 * `code` 查品項的索引。
 *
 * 用 Map 而不是每次 `CATALOG.find`:繪製路徑每一幀、每一件家具都要查一次,
 * 目錄長到數百項(競品 233 項)之後線性搜尋會出現在 profile 上。
 */
const BY_CODE = new Map(CATALOG.map((item) => [item.code, item]));

/** 查不到回傳 `undefined` —— 呼叫端要能處理「存檔裡有已下架的代碼」。 */
export function catalogItem(code: string): CatalogItem | undefined {
  return BY_CODE.get(code);
}

/**
 * 查不到就丟例外。
 *
 * 給**程式內部寫死的代碼**用(例如 kind 對照表),那種查不到代表目錄與程式碼
 * 不同步,是開發期的 bug,靜靜吞掉會變成畫面上少一件家具而沒人知道為什麼。
 * 使用者資料(存檔、AI 回傳)一律用 `catalogItem` 走可失敗的路徑。
 */
export function requireCatalogItem(code: string): CatalogItem {
  const item = BY_CODE.get(code);
  if (!item) throw new Error(`目錄裡沒有代碼 ${code}`);
  return item;
}

const SUB_BY_CODE = new Map(SUB_CATEGORIES.map((sub) => [sub.code, sub]));

/** 子類標籤;查不到就回代碼本身,不要讓 UI 出現空字串。 */
export function subCategoryLabel(subCategory: string): string {
  return SUB_BY_CODE.get(subCategory)?.label ?? subCategory;
}

/** 目錄裡是否有這個代碼。AI 工具呼叫的參數驗證用(T4)。 */
export function isCatalogCode(code: string): boolean {
  return BY_CODE.has(code);
}

/** 該子類底下的品項。目錄頁的第三層列表用(T7)。 */
export function itemsInSubCategory(subCategory: string): CatalogItem[] {
  return CATALOG.filter((item) => item.subCategory === subCategory);
}

/** 該大類底下的子類。目錄頁的第二層導覽用(T7)。 */
export function subCategoriesIn(category: string): CatalogSubCategory[] {
  return SUB_CATEGORIES.filter((sub) => sub.category === category);
}

/** 平面圖佔地(公尺)。把「w/d 是哪兩軸」這件事收在一處,呼叫端不必記。 */
export function catalogFootprintM(item: CatalogItem): { w: number; h: number } {
  return { w: item.w, h: item.d };
}
