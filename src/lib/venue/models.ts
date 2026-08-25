// 步驟 03 精密 3D 場景所用的模型工具(純領域模組 — 不得 import React / DOM /
// Konva / Three)。
//
// **執行期的 manifest 已經移進 `catalog.ts`**(第三輪 T3):每個品項的
// `geometry` 欄位自己帶著 url / rotationY / deferred。原本這裡有一份依 kind
// 索引的 `FURNITURE_MODELS`,那是「同一件事有兩個來源」的最後一處 —— 目錄長出
// 第十個品項時,那份表不會跟著長,而畫面只會少一件家具,沒有任何錯誤。
//
// 打包期的對照表仍在 scripts/build-venue-models.mjs 的 MODELS(帶著 Poly Haven
// slug 與挑選殘差等只在轉檔時有意義的欄位),與目錄的檔名/旋轉必須一致。
//
// GLB 產出物與授權記錄:public/models/venue/(見同目錄 ATTRIBUTION.md,
// 全部 CC0)。

/** GLB 存放目錄(public 底下,以 URL 路徑表示)。 */
export const MODEL_BASE_PATH = "/models/venue";

/**
 * 把模型原生尺寸等比縮到目標框內所需的縮放倍率。
 *
 * 家具尺寸不可由使用者調整,唯一來源是目錄(AGENTS.md),
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
