# Code Review Report — [FRONTEND] 匯入 6 種真實家具模型, 步驟 03
> Generated: 2026-08-04T23:20+08:00 | Review iteration: 1
> Story: `stories/venue-refined-3d.md` task 5 | Plan: `.claude/pipeline/architect-plan.md`
> Diff reviewed: `c54166b..HEAD`(涵蓋 wip commit `2ae97aa` — 它從未被審過)

## Overall Assessment

**APPROVED WITH FIXES APPLIED** — 1 🔴 Critical(已在本輪修掉並補上回歸測試)、
3 💡。

## Summary

分層是對的:`src/lib/venue/models.ts` 維持純領域(只有 manifest 與
`uniformFitScale`,沒有 React/three),所有畫布邏輯留在
`src/components/venue/`。`normalizeModel()` 把節點世界矩陣、方位修正、等比縮放
與置中全部烘進頂點的做法有充分理由(`<Instances>` 只吃單一 geometry +
material,GLB 的節點階層會整個被丟掉),而且座標約定與既有 box 版本一致,
呼叫端不需要知道模型是哪來的。資源生命週期分得很乾淨:clone 出來的 geometry
自己 dispose,material 沿用 GLB 的、交給 `useGLTF` 快取管 —— M6 三趟往返
`gl.info.memory` 完全持平,證實沒有雙重釋放也沒有洩漏。

Draco 解碼器自架(`public/draco/`)是必要的:drei 的 `useGLTF` 預設把
decoder path 指向 gstatic.com,那會直接違反步驟 03 的「零外部下載」硬規定。
`DRACO_DECODER_PATH` 顯式傳入這點做對了。

範圍紀律良好:`VenueScene.tsx` / `PlanEditor.tsx` / `FURNITURE_DEFAULTS` /
`plan.ts` / `furniture.ts` 全未動;步驟 03 仍然沒有任何 `useState` 持有幾何、
沒有 `TransformControls`、沒有回寫。

唯一的嚴重問題是一個**靜默截斷**:`<Instances>` 的緩衝區容量寫死 256,超過就
不畫,而且不報錯 —— 詳見 Issue 1。

---

## 🔴 Critical Issues

### Issue 1 — `<Instances>` 容量寫死 256,家具超過就靜默消失(已修)

- **File**: `src/components/venue/furnitureModels.tsx:33`(原 `INSTANCE_LIMIT = 256`)
- **Issue**:

  drei 的 `<Instances>` 在**第一次 render** 就用 `useState` 把矩陣緩衝區配置好:

  ```js
  // node_modules/@react-three/drei/core/Instances.js
  const [[matrices, colors]] = React.useState(() => {
    const mArray = new Float32Array(limit * 16);   // 只在掛載時算一次
    ...
  });
  ```

  之後把 `limit` prop 改大**不會**重新配置。而它每幀寫入的是
  `instances.length` 個矩陣:

  ```js
  count = Math.min(limit, range !== undefined ? range : limit, instances.length);
  parentRef.current.count = count;
  for (let i = 0; i < instances.length; i++) {
    instanceMatrix.toArray(matrices, i * 16);      // i 超過容量時寫在界外
  }
  ```

  兩個後果同時發生:`count` 被 `limit` 卡住(第 257 件之後不繪製),而
  `toArray()` 對 typed array 的界外寫入會被**靜默丟棄**,不拋錯。

- **Failure scenario**(已實測,不是推論):
  讀入一份有 300 張椅子的存檔 → 平面圖 `data-furniture-count` 是 300,
  `data-furniture-model-reports` 的 `instanceCount` 也寫 300,但探針從
  `InstancedMesh.count` 量到的實際繪製數是 **256**。44 張椅子在 3D 裡人間蒸發,
  沒有錯誤、沒有警告,連元件自己的報告都還說有 300 張。展場擺 300 張椅子是
  完全正常的用法,200x200m 的可規劃範圍更是鼓勵這種量級。

- **Fix applied**: 容量改為「只會往上跳的 2 的冪次桶」
  (`instanceLimitFor()`,下限 64),並且**把桶編進 `key`** —— 需要更大的緩衝區
  時整個 `<Instances>` 重新掛載,`useState` 才會真的重配。桶只會成長,所以一般
  的加減家具不會造成重掛。

- **Regression test**: `venue-furniture-models.spec.ts` 的 M8,用 mock 的存檔
  載入 300 張椅子,斷言探針量到的實際繪製數等於 300。這條斷言刻意讀
  `refinedShadowCasterFurnitureCount()`(來自 `InstancedMesh.count`)而不是
  元件自報的 `instanceCount` —— 缺陷發生時後者仍然是 300,只有前者會掉到 256。

---

## 💡 Suggestions(不阻擋)

### Issue 2 — `normalizeModel()` 的 material 陣列分支是防禦性死碼

- **File**: `src/components/venue/furnitureModels.tsx`(`normalizeModel()` 內)
- `Array.isArray(node.material) ? node.material[0] : node.material` 只取第一個
  material,若真有多 material 的 mesh,其餘 group 會被錯誤地套上第一個
  material。但依 glTF 規格,一個 primitive 只有一個 material,three 的
  `GLTFLoader` 對多 primitive 的 mesh 會產生多個 `THREE.Mesh`(cabinet 的 5 個
  part 正是這樣來的)—— 所以這個分支在 glTF 來源下走不到。留著無害,但值得在
  註解說明它是防禦性的,免得後人以為多 material 有被正確處理。

### Issue 3 — eager `<Suspense>` 在新增未載過的 kind 時會讓既有家具短暫消失

- **File**: `src/components/venue/RefinedScene.tsx`(eager `<Suspense>` 邊界)
- 若場上的家具在步驟 03 期間新增了一個尚未載入的 kind,eager 邊界會重新
  suspend,R3F 會把整批既有家具模型暫時從場景圖移除,直到新 GLB 載完。
- **目前走不到**:`PlanEditor.tsx:1605-1607` 在步驟 03 對 `AiPanel` 同時上了
  `hidden` class 與 `inert`,而步驟 03 本身唯讀 —— 沒有任何路徑能在 03 期間
  改動家具。**但如果日後讓 AI 面板在 03 可用(那是很自然的產品需求),這個
  閃爍會立刻變成真的。** 屆時的解法是每個 kind 各自一個 `<Suspense>`,而不是
  整批共用一個。

### Issue 4 — 每次進入步驟 03 都重新 clone + 重新上傳全部 geometry

- **File**: `src/components/venue/furnitureModels.tsx`(`useMemo` + 卸載 dispose)
- 這是 M6「往返不累積」的代價:資源確實乾淨釋放了,但也表示每趟往返都要對
  六個模型(含 96k 面的植栽)重做一次 clone、矩陣烘焙與 GPU 上傳。以正確性
  而言無誤,以效能而言是 task 7 該量測的對象 —— 若進入 03 的延遲不可接受,
  可考慮把烘焙結果快取在模組層(代價是常駐記憶體)。

---

## 驗收條件對照(task 5)

| 條件 | 證據 |
|---|---|
| 等比縮放至 `FURNITURE_DEFAULTS` 的 `w/h/height3d`,不得非等比拉伸 | M1(`scale` 為單一純量 + 無軸溢出 + 至少一軸貼齊) |
| `drawer_cabinet` 需轉 90° | M2(長邊落在 Z、且貼齊的是長邊) |
| 重複家具用 drei `<Instances>` | M7(3 件只有 1 份報告)、M8(容量成長正確) |
| 植栽單獨 lazy load | M4(`plant.glb` 的請求排在 eager 批**收完之後**) |
| 步驟 01/02 不得載入 GLB | C1–C3,且已用反證確認三條都能紅 |
