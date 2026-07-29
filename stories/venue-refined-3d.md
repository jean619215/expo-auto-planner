# Story: 精密 3D 場景 (步驟 03)

## 說明
身為使用者,我想要在白模預覽之外,再看到一個材質、光影、家具造型都更精緻的 3D 場景,以便更真實地評估場地規劃成果、也能拿來對外提案。

架構定調 (與使用者討論後確認):
- **路線選擇**(2026-07-26 修訂): 採**混合路線** — 6 種家具匯入 Poly Haven CC0 模型,3 種展場專屬家具用程序化幾何;地板/牆/柱維持程序化 + PBR 材質。**不接 AI 3D 生成 API**(不需新後端服務、無算圖費用與非同步排隊)。
  - 原定調為「全程序化、不引入外部模型」,經查證 Poly Haven 有品質足夠且比例吻合的 CC0 家具模型後修訂。
  - **模型來源限定 Poly Haven**(全站 CC0,商用免標註)。**Sketchfab 已排除** — 其 CC0 且可下載的結果幾乎全是博物館掃描件(10 萬~290 萬三角面),不堪使用。
  - 已確認可用模型:`wooden_table_02`(桌,196 面)、`painted_wooden_chair_01`(椅,724 面)、`sofa_02`(沙發,2,728 面)、`wooden_display_shelves_01`(展示櫃,3,174 面)、`drawer_cabinet`(櫃子,26,406 面,需轉 90°)、`potted_plant_02`(植栽,69,806 面,最重)。
  - 程序化處理:`counter` 接待櫃檯、`bannerStand` 展示架、`podium` 講台 — 兩大模型庫皆無此類展場專屬物件,且形狀單純(箱體/斜面/細桿+薄板);展示架本就應支援使用者自訂視覺,程序化更合理。
  - **Poly Haven 不提供 .glb**,下載為 `.gltf` + `.bin` + 多張 JPG 貼圖,需經 `gltf-transform` 打包為單檔 GLB + Draco + KTX2 後才進版控/上線。1k 貼圖六模型原始約 5.7MB,壓縮後約 3–4MB;植栽單一資產佔比最高,需單獨 lazy load。
- **步驟 02 與 03 分開,不合併**。理由:
  - 互動需求不同:02 要即時反應(拖曳/TransformControls 低延遲),03 追求畫面品質(陰影、PBR 材質、細節幾何)運算重,混在一起會拖慢編輯。
  - 載入策略不同:精細資源在 03 才 lazy load,02 保持輕量。
  - 架構成本較低:`WIZARD_STEPS` 已是陣列驅動,加 03 是同模式延伸;合併反而要做輕量/精密雙模式切換,狀態與測試面都變大。
- **步驟 03 為唯讀展示**:不支援拖曳/選取/旋轉物件(那些留在 02),只提供 orbit controls 觀看。資料直接複用 02 的 `walls / columns / furniture` state,不另設資料模型、不動 `plan.ts` / `furniture.ts` 的既有型別。
- 沿用現有技術棧: `three` + `@react-three/fiber` + `@react-three/drei`,不新增 3D 框架。
- **家具尺寸不可由使用者調整**(2026-07-26 使用者確認):家具只能移動與旋轉,不提供縮放。尺寸唯一來源為 `FURNITURE_DEFAULTS` 的 `w` / `h` / `height3d`,確保模型與場地維持真實比例。
  - 現況已符合此約束,後續任務**不得**破壞:2D 編輯器未給家具縮放把手(`resizeColumnCorner` 僅適用柱子);3D `TransformControls` 對家具只開 `translate` / `rotate`;AI `add_furniture` schema 只收 `kind` / `center` / `rotationDeg`,無 w/h 參數。
  - 任何家具模型(含後續匯入的外部模型)一律等比縮放至上述固定尺寸,不得為了填滿而非等比拉伸變形。

## 驗收條件
- 使用者在步驟 02 可以進入新的步驟 03「精密 3D」,也可以返回 02;wizard 進度列正確顯示三個步驟。
- 步驟 03 呈現的場地內容(地板形狀、牆、柱、家具位置與旋轉)與步驟 02 完全一致。
- 步驟 03 的家具不再是單一方塊:桌/椅/沙發/展示櫃/櫃子/植栽顯示真實 3D 模型;櫃檯/展示架/講台為可辨識的程序化造型。
- 家具在 3D 中維持與場地的真實比例:模型等比縮放至設定尺寸,無非等比拉伸變形;使用者無法縮放家具(僅可移動與旋轉)。
- 步驟 03 的地板、牆面、家具具有 PBR 材質表現(非純色平光),並有陰影與多光源打光。
- 步驟 03 為唯讀:點擊物件不會進入選取/搬移狀態,僅能用 orbit controls 旋轉/縮放/平移視角。
- 在步驟 02 停留時不載入步驟 03 專用的貼圖資源;步驟 03 資源載入期間顯示載入指示。
- 步驟 01/02 既有行為(2D 編輯、白模預覽、AI 面板常駐與 tool call 套用)不受影響。

## 任務清單
- [x] [FRONTEND] 步驟 03 骨架:`WizardStep` 新增第三步、`WIZARD_STEPS` 加入「03 精密 3D」、前後導覽與進度列、建立唯讀 `RefinedScene` 元件(先沿用現有 box 幾何),複用 02 的 plan state
- [x] [FRONTEND] 打光與陰影:shadow map、多光源配置、tone mapping / 環境光設定,套用至步驟 03 場景
- [ ] [FRONTEND] PBR 材質:地板/牆/柱套用材質貼圖(含 lazy load 與載入指示),步驟 02 不載入這些資源
- [ ] [FRONTEND] 家具模型 asset pipeline:下載 6 個 Poly Haven CC0 模型(1k 貼圖),經 `gltf-transform` 打包為單檔 GLB + Draco + KTX2,決定存放路徑與授權來源記錄檔
- [ ] [FRONTEND] 匯入 6 種真實家具模型:等比縮放至 `FURNITURE_DEFAULTS` 的 `w / h / height3d`(不得非等比拉伸變形),`drawer_cabinet` 需轉 90°,重複家具用 drei `<Instances>`,植栽單獨 lazy load
- [ ] [FRONTEND] 3 種展場家具程序化幾何:`counter` 接待櫃檯、`bannerStand` 展示架、`podium` 講台,尺寸由 `FURNITURE_DEFAULTS` 驅動,風格需與匯入模型協調
- [ ] [FRONTEND] 效能與驗收:步驟 03 資源只在進入時載入、離開可釋放,Playwright 驗收三步驟流程與唯讀行為

<!--
給 STORY 撰寫者的備註:
- 每個任務會獨立跑完整條 pipeline (orchestrate → architect → implement → review → QA → playwright)
- 任務由上到下依序處理,一次一個
- orchestrator 會在 architect 規劃前,針對每個任務問澄清問題
- 執行: /ship stories/venue-refined-3d.md 啟動 pipeline

已澄清項目(2026-07-26):
- 材質貼圖來源:**程序化生成**(地板/牆/柱),零下載、零授權、可無縫平鋪至 200m。家具則走 Poly Haven CC0 模型(見上方架構定調)。
- 品質基準:**對外提案用** —— 需經得起截圖放大。程序化材質須含 normal map 與非重複變化,不可敷衍;場景寫實度主要由家具模型承擔。
-->
