// drei `<Instances>` 的緩衝區容量計算,由匯入模型(furnitureModels.tsx)與
// 程序化家具(proceduralFurniture.tsx)共用。
//
// 為什麼需要這個東西:drei 的 `<Instances>` 在**第一次 render** 就用
// `useState` 把 `limit * 16` 的矩陣 Float32Array 配置好,之後把 `limit` prop
// 改大**不會**重新配置(Instances.js 的
// `useState(() => new Float32Array(limit * 16))`)。而它每幀寫入的是
// `instances.length` 個矩陣 —— 一旦件數超過當初的容量,多出來的
// `toArray(matrices, i * 16)` 就寫在 Float32Array 界外,typed array 會靜默
// 丟棄,同時 `count = min(limit, range, instances.length)` 也把繪製數卡在
// limit。結果是「平面圖上有 300 張椅子,3D 只畫得出 256 張」,而且沒有任何
// 錯誤。這是 task 5 review 抓到的實際缺陷。
//
// 所以容量用「2 的冪次桶」算,並且呼叫端**必須把桶編進 `key`** —— 需要更大的
// 緩衝區時整個 `<Instances>` 重新掛載,`useState` 才會真的重配。桶只會往上跳,
// 所以一般的加減家具不會造成重掛。
//
// 回歸測試:`venue-furniture-models.spec.ts` 的 M8。

const MIN_INSTANCE_LIMIT = 64;

export function instanceLimitFor(count: number): number {
  let limit = MIN_INSTANCE_LIMIT;
  while (limit < count) limit *= 2;
  return limit;
}
