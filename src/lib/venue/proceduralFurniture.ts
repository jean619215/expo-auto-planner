// 三種展場專屬家具的程序化造型「規格」(story: venue-refined-3d,task 6)。
//
// 純領域模組 — 不得 import React / DOM / Konva / Three(AGENTS.md)。這裡只
// 描述「這件家具由哪些盒子/圓柱組成、各自擺在哪、用哪種表面處理」,把它變成
// 真的 geometry / material 是 `src/components/venue/proceduralFurniture.tsx`
// 的事。這樣拆的理由跟 models.ts 一樣:尺寸與比例是領域知識,應該可以在沒有
// WebGL 的情況下被讀懂與驗證。
//
// counter 接待櫃檯 / bannerStand 展示架 / podium 講台 —— Poly Haven 沒有這類
// 展場專屬物件的 CC0 資產(story 架構定調),所以走程序化。
//
// **座標約定與匯入模型完全一致**:底面貼 y=0、水平以原點為中心,呼叫端用
// `position=[center.x, 0, center.y]` 擺放即可。
//
// **所有尺寸都是 `FURNITURE_DEFAULTS` 的 w / height3d / h 的函數**,這裡不出現
// 任何獨立的絕對尺寸來源 —— 家具尺寸的唯一來源是 FURNITURE_DEFAULTS
// (AGENTS.md 硬規定)。少數幾個絕對值(桌板厚度、桿子半徑之類)是「做工厚度」
// 而不是家具尺寸,而且一律夾在總尺寸之內。

import { FURNITURE_DEFAULTS, type FurnitureKind } from "./furniture";

/** 表面處理。實際的顏色/粗糙度由 renderer 端的 FINISHES 決定。 */
export type PartFinish = "body" | "accent" | "metal" | "panel";

export type PartShape =
  | { kind: "box"; w: number; h: number; d: number }
  | { kind: "cylinder"; radius: number; h: number };

export interface FurniturePart {
  /** 在同一件家具內唯一,供 React key 與場景圖命名使用。 */
  id: string;
  shape: PartShape;
  /** 相對於「底面貼 y=0、水平置中」的中心位移(公尺)。 */
  position: [number, number, number];
  /** 繞 X 軸傾斜(度)。目前只有講台的斜面讀寫台用到。 */
  tiltXDeg?: number;
  finish: PartFinish;
}

/** 板材/檯面之類的「做工厚度」,不是家具尺寸。 */
const SLAB_M = 0.06;
const BASE_M = 0.05;
const POLE_RADIUS_M = 0.015;

/**
 * 接待櫃檯:內縮的踢腳座 + 主體 + 外伸的檯面。
 *
 * 「檯面比主體寬一點、底部再內縮一截」是櫃檯之所以看起來像櫃檯的關鍵 ——
 * 純粹一個盒子只會讀成箱子。
 */
function counterParts(w: number, h: number, height3d: number): FurniturePart[] {
  const plinthH = BASE_M;
  const bodyH = height3d - plinthH - SLAB_M;
  return [
    {
      id: "plinth",
      shape: { kind: "box", w: w * 0.86, h: plinthH, d: h * 0.86 },
      position: [0, plinthH / 2, 0],
      finish: "accent",
    },
    {
      id: "body",
      shape: { kind: "box", w: w * 0.94, h: bodyH, d: h * 0.94 },
      position: [0, plinthH + bodyH / 2, 0],
      finish: "body",
    },
    {
      // 檯面吃滿標稱尺寸 —— 這是整件家具的最大水平外廓。
      id: "top",
      shape: { kind: "box", w, h: SLAB_M, d: h },
      position: [0, height3d - SLAB_M / 2, 0],
      finish: "accent",
    },
  ];
}

/**
 * 展示架(易拉寶):底部的捲軸箱 + 後方支桿 + 布面。
 *
 * 支桿刻意比布面高一點、也擺在後緣,從側面看得出「布是被撐起來的」,
 * 而不是一片浮在空中的板子。
 */
function bannerStandParts(w: number, h: number, height3d: number): FurniturePart[] {
  const cassetteH = h * 0.4;
  const poleH = height3d - cassetteH;
  const panelBottom = cassetteH + 0.02;
  const panelTop = height3d - 0.06;
  const panelH = panelTop - panelBottom;
  return [
    {
      id: "cassette",
      shape: { kind: "box", w, h: cassetteH, d: h },
      position: [0, cassetteH / 2, 0],
      finish: "metal",
    },
    {
      id: "pole",
      shape: { kind: "cylinder", radius: POLE_RADIUS_M, h: poleH },
      // 後緣,讓布面在它前方展開。
      position: [0, cassetteH + poleH / 2, h / 2 - POLE_RADIUS_M * 2],
      finish: "metal",
    },
    {
      id: "panel",
      shape: { kind: "box", w: w * 0.96, h: panelH, d: 0.012 },
      position: [0, panelBottom + panelH / 2, 0],
      finish: "panel",
    },
  ];
}

/**
 * 講台:底座 + 收窄的立柱 + 傾斜的讀寫台面。
 *
 * 傾斜的台面是講台的識別特徵;立柱收窄則讓它跟同高度的櫃檯區分得開
 * (兩者 height3d 都是 1.1)。
 */
const PODIUM_TILT_DEG = 10;

function podiumParts(w: number, h: number, height3d: number): FurniturePart[] {
  const baseH = BASE_M;
  const topH = 0.05;

  // 傾斜的板子在垂直與深度兩個方向佔的空間都比自身尺寸大:
  //   halfY = (topH/2)·cos + (d/2)·sin
  //   halfZ = (d/2)·cos + (topH/2)·sin
  // 直接拿 d = h 再轉 10°,深度就會超出標稱的 h,高度也會突破 height3d。
  // 家具尺寸的唯一來源是 FURNITURE_DEFAULTS(AGENTS.md),外廓不能因為造型
  // 細節而偷偷變大 —— 所以反解出「傾斜後剛好等於 h」的板深,再把中心壓到
  // 「傾斜後的最高點剛好等於 height3d」。
  const tilt = (PODIUM_TILT_DEG * Math.PI) / 180;
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  const topD = (h - topH * sin) / cos;
  const topHalfY = (topH / 2) * cos + (topD / 2) * sin;
  const topCenterY = height3d - topHalfY;

  // 立柱頂端收在斜面的最低點,才不會從斜面前緣穿出來。
  const bodyTopY = topCenterY - topHalfY;
  const bodyH = bodyTopY - baseH;

  return [
    {
      id: "base",
      shape: { kind: "box", w, h: baseH, d: h },
      position: [0, baseH / 2, 0],
      finish: "accent",
    },
    {
      id: "body",
      shape: { kind: "box", w: w * 0.78, h: bodyH, d: h * 0.72 },
      position: [0, baseH + bodyH / 2, 0],
      finish: "body",
    },
    {
      // 前低後高的讀寫台面 —— 講台的識別特徵,也是它和同高度的接待櫃檯
      // (兩者 height3d 都是 1.1)之所以一眼分得出來的原因。
      id: "top",
      shape: { kind: "box", w, h: topH, d: topD },
      position: [0, topCenterY, 0],
      tiltXDeg: -PODIUM_TILT_DEG,
      finish: "accent",
    },
  ];
}

const BUILDERS: Partial<
  Record<FurnitureKind, (w: number, h: number, height3d: number) => FurniturePart[]>
> = {
  counter: counterParts,
  bannerStand: bannerStandParts,
  podium: podiumParts,
};

/** 這個 kind 是否由程序化幾何繪製(而非匯入模型或白模 box)。 */
export function hasProceduralFurniture(kind: FurnitureKind): boolean {
  return kind in BUILDERS;
}

/**
 * 取得該 kind 的零件清單;沒有程序化造型的 kind 回傳 `undefined`。
 * 尺寸全部由 `FURNITURE_DEFAULTS` 推導。
 */
export function proceduralFurnitureParts(
  kind: FurnitureKind
): FurniturePart[] | undefined {
  const build = BUILDERS[kind];
  if (!build) return undefined;
  const defaults = FURNITURE_DEFAULTS[kind];
  return build(defaults.w, defaults.h, defaults.height3d);
}

/**
 * 單一零件在 x / y / z 三軸上佔用的範圍(min, max),已套用位移與傾斜。
 *
 * 傾斜的板子在垂直方向會比自身厚度佔得更多(投影 = |h·cosθ| + |d·sinθ|),
 * 不把這一項算進去,外廓檢查就會低估講台的總高。
 */
export function partExtentM(part: FurniturePart): {
  min: [number, number, number];
  max: [number, number, number];
} {
  const half =
    part.shape.kind === "box"
      ? [part.shape.w / 2, part.shape.h / 2, part.shape.d / 2]
      : [part.shape.radius, part.shape.h / 2, part.shape.radius];

  let halfY = half[1];
  let halfZ = half[2];
  if (part.tiltXDeg) {
    const t = (Math.abs(part.tiltXDeg) * Math.PI) / 180;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    halfY = half[1] * cos + half[2] * sin;
    halfZ = half[2] * cos + half[1] * sin;
  }

  const halves: [number, number, number] = [half[0], halfY, halfZ];
  return {
    min: [
      part.position[0] - halves[0],
      part.position[1] - halves[1],
      part.position[2] - halves[2],
    ],
    max: [
      part.position[0] + halves[0],
      part.position[1] + halves[1],
      part.position[2] + halves[2],
    ],
  };
}

/**
 * 整件程序化家具的外廓尺寸(公尺)。
 *
 * 存在的理由:AGENTS.md 要求家具尺寸唯一來源是 `FURNITURE_DEFAULTS`,而
 * 程序化造型是由一堆比例拼出來的 —— 沒有這個函式,「拼出來的東西到底有沒有
 * 剛好等於標稱尺寸」就只能靠肉眼。驗收 spec 直接拿它跟 FURNITURE_DEFAULTS 比。
 */
export function proceduralFurnitureSizeM(
  kind: FurnitureKind
): [number, number, number] | undefined {
  const parts = proceduralFurnitureParts(kind);
  if (!parts || parts.length === 0) return undefined;

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const extent = partExtentM(part);
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], extent.min[axis]);
      max[axis] = Math.max(max[axis], extent.max[axis]);
    }
  }
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
}
