# Orchestrator Output — 打光與陰影
> Story: 精密 3D 場景 (步驟 03) | Generated: 2026-07-26T02:45+08:00

## Task Type
FRONTEND

## Refined Requirement

步驟 03(`RefinedScene.tsx`,commit `c7c06c5`)目前沿用步驟 02 的最小打光:`ambientLight` + 單一 `directionalLight`,未啟用陰影,`meshStandardMaterial` 全平光。本任務把步驟 03 升級為**展場實景感**打光,是後續材質(task 3)與家具模型(task 5–6)的視覺基礎 —— 沒有陰影與方向性光源,再好的材質與模型都會看起來是平的。

本任務要求:

1. **燈光風格:展場實景感**(使用者已定案)。模擬展覽會場天花板燈:
   - 偏冷白的主光(色溫接近會場 LED/鹵素混合光),具明確方向性以產生可辨識的落地陰影。
   - 多盞補光避免暗部死黑 —— 展場實務上不會只有單一光源。
   - 不要做成戶外日光(強烈平行光 + 天空環境光),展場是室內情境。

2. **陰影:中等品質**(使用者已定案):
   - 啟用 shadow map,採 PCF soft shadow(柔邊,非硬邊鋸齒)。
   - Shadow map 解析度 2048。**不要**用 4096(低階 GPU 掉幀),也不要低於 1024(陰影會糊成塊)。
   - 只有必要的光源投射陰影 —— 每盞投影光源都是一次額外 render pass,補光不需要全部開 `castShadow`。
   - 地板接收陰影;牆/柱/家具投射陰影。

3. **Tone mapping / 色彩管理**:
   - **修正(2026-07-26,architect 查證 node_modules)**:R3F v9 的 `<Canvas>` **已預設** ACESFilmic + sRGB,步驟 02 早就套用。本任務是「明確化設定並調整曝光」,不是從無到有開啟。
   - 明確設定 tone mapping 與曝光值,讓多光源疊加後不會過曝死白。
   - 這會改變整體亮度觀感 —— 需連帶調整既有材質的基礎色明度,確保白模階段的物件不會變得太暗或太亮(注意:`FURNITURE_DEFAULTS` 的顏色與 2D 編輯器、步驟 02 共用,不可改動)。
   - **材質數值納入本任務範圍**(2026-07-26 使用者定案):`roughness` / `metalness` **純量**屬本任務 —— `meshStandardMaterial` 預設 `roughness: 1`(全霧面)不反射任何環境,IBL 效果將完全不可觀察、無法驗收。材質**貼圖**(影像檔)仍屬 task 3。

4. **環境光 / IBL**:
   - 可用 drei 的環境光方案提供柔和的環境反射,讓 `meshStandardMaterial` 的金屬/粗糙度有東西可反射。
   - **限制**:若採用需下載 HDRI 的方案,必須確認授權(比照專案模型來源政策:Poly Haven CC0 可用)且檔案大小合理;**若會顯著增加下載量,優先採用程序化/內建的環境光方案**。實際做法由 architect 定案並說明取捨。

5. **作用範圍限步驟 03**:
   - 步驟 02(`VenueScene.tsx`)的打光**維持現況不動** —— 02 是即時互動編輯,運算要輕;03 才追求畫面品質。
   - 兩者共用的 `floorGeometry.ts` 只提供幾何,不涉及光照,不受本任務影響。

6. **效能約束**:
   - 陰影與多光源設定不得讓步驟 03 的初次進入明顯卡頓。
   - 場景可能有數十件家具(每種家具可重複放置),打光成本不隨物件數線性惡化 —— 光源數固定,不可依物件數動態增生光源。
   - 資源(光源、shadow map、環境貼圖)需在離開步驟 03 時正確釋放,比照 AGENTS.md 的 dispose 規則。

7. **既有約束不得破壞**(AGENTS.md,均為前一任務確立):
   - `RefinedScene` 維持唯讀:不得持有幾何 state、不得掛 `TransformControls`、不得回寫 `onSceneChange`。
   - 02/03 維持互斥掛載。
   - `AiPanel` 在 03 維持 CSS 隱藏且不改變掛載位置。
   - 家具尺寸仍由 `FURNITURE_DEFAULTS` 決定,本任務不碰尺寸與幾何。

8. **範圍界線**:本任務**只做打光與陰影**。PBR 材質貼圖(task 3)、家具模型匯入(task 4–5)、展場家具程序化幾何(task 6)都不在此範圍 —— 材質仍維持現有的單色 `meshStandardMaterial`,只是在新打光下呈現。

## Clarified Acceptance Criteria

- [ ] Given 步驟 03,then 場景由多盞光源打亮(非單一 directional + ambient),暗部有補光、不出現全黑死角。
- [ ] Given 步驟 03 且場景中有牆/柱/家具,then 物件在地板上投射出柔邊陰影(PCF soft shadow,非硬邊鋸齒)。
- [ ] Given 步驟 03,then 陰影解析度為 2048,視覺上陰影邊緣清晰但不鋸齒、不糊成方塊。
- [ ] Given 步驟 03,then 啟用 tone mapping 與正確 color space,多光源重疊處不出現過曝死白區塊。
- [ ] Given 步驟 02,then 打光與陰影維持現況(無陰影、原本的 ambient + directional),與本任務前完全一致。
- [ ] Given 場景中放置數十件家具,when 進入步驟 03,then 畫面仍可流暢以 OrbitControls 旋轉,無明顯卡頓。
- [ ] Given 步驟 03,when 返回步驟 02,then 步驟 03 建立的光源與 shadow map 資源被釋放(往返多次不累積)。
- [ ] Given 步驟 03,then 唯讀行為不變:點擊物件無選取/無 gizmo,僅 OrbitControls 可用。
- [ ] Given 步驟 03,then AI 側欄仍隱藏;返回步驟 02 後對話歷史與草稿輸入完整保留。
- [ ] Given 步驟 01/02,then 既有行為(2D 編輯、白模預覽、3D 手動編輯、AI tool call 套用)全部不變。

## Edge Cases to Handle

- **空場景**:只有地板多邊形、無任何牆/柱/家具時,打光仍正常,不因無投影物件而報錯或畫面全黑。
- **極大場地**:地板可達 `PLAN_AREA_SIZE_M`(200m)。方向光的 shadow camera 視錐若固定為小範圍,大場地邊緣會沒有陰影或陰影破碎 —— 需依實際地板範圍調整 shadow camera 邊界,或說明取捨。
- **極小場地**:反之,場地很小時 shadow camera 範圍過大會讓 shadow map 精度浪費、陰影變糊。
- **凹多邊形地板**:陰影接收面沿用共用 `useFloorGeometry`,不得因打光改動而讓 02/03 地板形狀出現差異。
- **高瘦物件**:`bannerStand` 高 2.0m、`cabinet` 高 1.8m,陰影不可被 shadow camera 的 near/far 截斷。
- **物件重疊/貼牆**:家具緊貼牆面時的陰影不應出現嚴重 shadow acne(自陰影雜訊)或 peter-panning(陰影與物件脫離)。
- **往返累積**:02→03→02→03 多次,光源與 shadow map 不重複建立累積(AGENTS.md dispose 規則)。

## Error States

- 本任務不新增任何 API 呼叫,無網路錯誤狀態需處理。
- ~~HDRI 載入失敗處理~~ —— **不適用(2026-07-26)**:architect 定案採程序化 `<Environment>` + `<Lightformer>`,零下載、無外部資源,此錯誤狀態由設計上即不可能發生。(drei 的 `<Environment preset>` 會在 runtime 從 `raw.githack.com` 下載,已因第三方 CDN 依賴而否決。)
