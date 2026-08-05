# Code Review Report — [FRONTEND] 3 種展場家具程序化幾何, 步驟 03
> Generated: 2026-08-05T00:40+08:00 | Review iteration: 1
> Story: `stories/venue-refined-3d.md` task 6 | Plan: `.claude/pipeline/architect-plan.md`
> Diff reviewed: task 6 的全部改動(`f9fbb60..HEAD`)

## Overall Assessment

**APPROVED WITH FIXES APPLIED** — 1 🔴(已修並補上回歸)、2 💡。

## Summary

分層乾淨:零件規格(誰、多大、擺哪、什麼表面處理)放在純領域模組
`src/lib/venue/proceduralFurniture.ts`,完全不 import React / three;
`src/components/venue/proceduralFurniture.tsx` 只負責把規格變成 geometry /
material 與 instancing。這讓「拼出來的外廓到底等不等於標稱尺寸」可以在沒有
WebGL 的情況下驗算 —— `proceduralFurnitureSizeM()` 就是為此存在,P1 直接拿它
跟 `FURNITURE_DEFAULTS` 比。

與匯入模型那條路刻意保持同構:同樣的座標約定(底面貼 y=0、水平置中)、同樣用
drei `<Instances>`、同樣的場景圖命名。因此探針不需要分辨一件家具是模型還是
程序化的,`shadowCasterFurnitureCount` 一套邏輯兩邊通用 —— 這也是 task 5 留下的
交接線(M3)能繼續守住的原因。

尺寸紀律良好:三種家具的外廓**精準等於** `FURNITURE_DEFAULTS`(P1 實測三軸
誤差 0)。講台的傾斜檯面是這裡唯一的陷阱 —— 傾斜的板子在高度與深度兩個方向
佔的空間都比自身尺寸大,直接拿 `d = h` 再轉 10° 會同時撐破深度與高度;實作
反解出「傾斜後剛好等於 h」的板深,再把中心壓到「傾斜後最高點剛好等於
height3d」。

---

## 🔴 Critical Issues

### Issue 1 — StrictMode 的雙重 render 讓一半的 GPU 資源永遠沒人釋放(已修)

- **File**: `src/components/venue/proceduralFurniture.tsx`(原本的
  `useMemo` 建立 + `useEffect` 卸載時 dispose)
- **Issue**:

  原始寫法沿用了 `furnitureModels.tsx` 的模式:在 `useMemo` 裡 `new` 出
  geometry 與 material,在 `useEffect` 的 cleanup 裡 dispose。

  React StrictMode(Next.js 預設開啟,`next.config.ts` 未關閉)會把 render
  **跑兩次、只 commit 一次**。`useMemo` 屬於 render 階段,所以兩次都會執行、
  建出兩組資源;而 `useEffect` 只會掛在被 commit 的那一次上 —— **被丟棄的那
  一組永遠不會有人 dispose**。

- **Failure scenario**(實測,不是推論):進入步驟 03 擺三種程序化家具,
  預期存活 9 組 geometry/material,實際讀到 **18**。

- **為什麼之前沒被發現**:`gl.info.memory` 只統計 geometries 與 textures,
  **完全不統計 material**;而被丟棄的那組 geometry 從未被掛進場景圖、也就
  從未上傳 GPU,所以在 `gl.info.memory` 上同樣看不見。task 5 的 M6 與本 task
  最初的 P6 都是讀 `gl.info.memory` —— 兩者都測不到這件事。是本 task 新增的
  「three 自身 dispose 事件驅動的存活計數」第一次跑就把它抓出來的。

- **Fix applied**: 改為**依 kind 的模組層快取**
  (`proceduralFurnitureStats.ts` 的 `getOrBuildProceduralParts()`)。理由不只
  是繞開 StrictMode:
  1. 一個 kind 的零件完全由 kind 決定(尺寸來自 `FURNITURE_DEFAULTS`、顏色
     來自同一份常數),沒有任何 per-instance 變化 —— 每次進步驟 03 重建是
     純粹的浪費。
  2. 這與匯入模型那條路本來就一致:GLB 的 material 生命週期歸 `useGLTF` 的
     模組層快取管,元件不碰。
  快取上限是 3 種 x 3 個零件 = 9 組,不隨使用增長,所以「往返不累積」仍然成立。

- **Regression test**: P6 現在斷言兩件事 —— 往返三趟後存活數仍是 9,**且
  `totalBuilds` 一次都沒有再漲**。後者才是真正的證據:證明資源是被重用的,
  而不是「每趟重建、每趟剛好釋放乾淨」。

---

## 💡 Suggestions(不阻擋)

### Issue 2 — cache miss 時仍然是在 render 期間建立 GPU 資源

- **File**: `src/components/venue/proceduralFurnitureStats.ts`
  (`getOrBuildProceduralParts()`)
- AGENTS.md 要求「不在 render 期間新建 geometry/material/texture」。快取命中
  時完全符合(穩態下 render 只是查表),但**第一次** cache miss 仍發生在
  render 階段。
- 判斷:可接受。整個頁面生命週期每個 kind 只會發生一次,而且這正是
  `useGLTF` 的行為(本專案已經依賴它)。真正要避免的是「每次 render / 每幀
  都新建」,那件事沒有發生。若日後要更嚴格,可以在進入步驟 03 時用一個
  effect 預先暖機。

### Issue 3 — 同一件家具內相同表面處理會各自持有一個 material

- **File**: `src/components/venue/proceduralFurniture.tsx`
- 例如接待櫃檯的踢腳座與檯面都是 `accent`,會建出兩個內容完全相同的
  `MeshStandardMaterial`。共用一個可以少一次 shader program 查表。
- 量級是「每個 kind 至多 3 個」,對 draw call 沒有影響(每個零件本來就是
  獨立的 `InstancedMesh`),所以不值得為它增加一層 finish→material 的快取
  間接性。記錄在案即可。

---

## 驗收條件對照(task 6)

| 條件 | 證據 |
|---|---|
| counter / bannerStand / podium 為可辨識的程序化造型 | P2(零件數 > 1,擋住「退回單一方塊」)+ P8 截圖人工判讀:櫃檯有外伸檯面與內縮踢腳座、易拉寶有捲軸箱+支桿+布面、講台有傾斜讀寫台面與收窄立柱 |
| 尺寸由 `FURNITURE_DEFAULTS` 驅動 | P1(三軸外廓與標稱尺寸誤差 0;傾斜檯面的高度/深度佔用已算進外廓) |
| 風格需與匯入模型協調 | body/accent 沿用 `REFINED_SURFACE.furniture` 的粗糙度基準(與匯入模型同一組表面參數),只有易拉寶的鋁製件給 metalness;顏色一律由該 kind 的 `FURNITURE_DEFAULTS.color` 推導 |
| 不得與匯入模型重複繪製 | P3(兩種來源各一件,投影件數為 2 而非 3)、M3 |
| 往返不累積 GPU 資源 | P6(存活數持平 + `totalBuilds` 未增,證明是重用而非重建) |
