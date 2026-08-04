// 步驟 03 精密 3D 場景所用的家具模型 manifest(純領域模組 — 不得 import
// React / DOM / Konva / Three)。
//
// 這是「執行期」的一份;打包期的對照表在 scripts/build-venue-models.mjs 的
// MODELS,兩邊的 kind → 檔名/旋轉必須一致。之所以不共用同一份:打包腳本還
// 帶著 Poly Haven slug 與挑選殘差等只在轉檔時有意義的欄位,而場景只需要知道
// 「載哪個檔、載進來要轉幾度」。
//
// GLB 產出物與授權記錄:public/models/venue/(見同目錄 ATTRIBUTION.md,
// 全部 CC0)。

import type { FurnitureKind } from "./furniture";

/** GLB 存放目錄(public 底下,以 URL 路徑表示)。 */
export const MODEL_BASE_PATH = "/models/venue";

export interface FurnitureModel {
  /** 可直接餵給 loader 的 URL。 */
  url: string;
  /**
   * 載入後要套的 Y 軸旋轉(度),讓模型原生長邊對上平面圖 w × h 的長邊。
   * 這是**模型自身的方位修正**,與使用者對家具下的 `rotationDeg` 是兩回事,
   * 兩者相加才是最終朝向。
   */
  rotationY: number;
  /**
   * 是否延後到其他模型之後再載。
   * 目前只有 plant —— 它原生 96k 三角面(單一 mesh 就 106,900 面)、GLB 1.32MB,
   * 是其餘五個加起來的量級,綁在同一批會拖慢整個步驟 03 的首次可見時間。
   */
  deferred: boolean;
}

/**
 * 有真實模型的 kind。沒列在這裡的(counter / bannerStand / podium)是展場
 * 專用家具,Poly Haven 沒有對應資產,改用程序化幾何(story task 6)。
 */
export const FURNITURE_MODELS: Partial<Record<FurnitureKind, FurnitureModel>> =
  {
    table: { url: `${MODEL_BASE_PATH}/table.glb`, rotationY: 0, deferred: false },
    chair: { url: `${MODEL_BASE_PATH}/chair.glb`, rotationY: 0, deferred: false },
    // 模型原生 1.141 × 0.488(長邊在 X),平面圖目標 0.6 × 1.2(長邊在 Y)。
    cabinet: { url: `${MODEL_BASE_PATH}/cabinet.glb`, rotationY: 90, deferred: false },
    sofa: { url: `${MODEL_BASE_PATH}/sofa.glb`, rotationY: 0, deferred: false },
    display: { url: `${MODEL_BASE_PATH}/display.glb`, rotationY: 0, deferred: false },
    plant: { url: `${MODEL_BASE_PATH}/plant.glb`, rotationY: 0, deferred: true },
  };

export function furnitureModel(kind: FurnitureKind): FurnitureModel | undefined {
  return FURNITURE_MODELS[kind];
}

export function hasFurnitureModel(kind: FurnitureKind): boolean {
  return kind in FURNITURE_MODELS;
}

/**
 * 把模型原生尺寸等比縮到目標框內所需的縮放倍率。
 *
 * 家具尺寸不可由使用者調整,唯一來源是 `FURNITURE_DEFAULTS`(AGENTS.md),
 * 且匯入模型**只能等比**縮放、不得非等比拉伸變形 —— 所以三軸各自的縮放倍率
 * 不能分開用,必須取**最小值**,讓模型完整落在目標框內(寧可留空隙,不可溢出
 * 或變形)。
 *
 * `size` / `target` 都是同一套軸向的公尺尺寸,且都應該是**已套用 rotationY
 * 之後**的值 —— 呼叫端負責先把模型 bounding box 轉正,這裡不處理旋轉。
 */
export function uniformFitScale(
  size: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number }
): number {
  const ratios = [
    size.x > 0 ? target.x / size.x : Infinity,
    size.y > 0 ? target.y / size.y : Infinity,
    size.z > 0 ? target.z / size.z : Infinity,
  ].filter((r) => Number.isFinite(r) && r > 0);

  // 三軸全是退化值(空 bounding box)時退回 1,寧可原尺寸顯示也不要 NaN 讓
  // 整個場景消失。
  return ratios.length > 0 ? Math.min(...ratios) : 1;
}
