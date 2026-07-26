# Story: 精密 3D 場景 (步驟 03)

## 說明
身為使用者,我想要在白模預覽之外,再看到一個材質、光影、家具造型都更精緻的 3D 場景,以便更真實地評估場地規劃成果、也能拿來對外提案。

架構定調 (與使用者討論後確認):
- **路線選擇**: 採「程序化細節升級」— 純前端 code 生成幾何與材質,**不接 AI 3D 生成 API、不引入外部 GLTF 模型庫**。理由:不需要新後端服務、無算圖費用與非同步任務排隊、無模型授權問題。
- **步驟 02 與 03 分開,不合併**。理由:
  - 互動需求不同:02 要即時反應(拖曳/TransformControls 低延遲),03 追求畫面品質(陰影、PBR 材質、細節幾何)運算重,混在一起會拖慢編輯。
  - 載入策略不同:精細資源在 03 才 lazy load,02 保持輕量。
  - 架構成本較低:`WIZARD_STEPS` 已是陣列驅動,加 03 是同模式延伸;合併反而要做輕量/精密雙模式切換,狀態與測試面都變大。
- **步驟 03 為唯讀展示**:不支援拖曳/選取/旋轉物件(那些留在 02),只提供 orbit controls 觀看。資料直接複用 02 的 `walls / columns / furniture` state,不另設資料模型、不動 `plan.ts` / `furniture.ts` 的既有型別。
- 沿用現有技術棧: `three` + `@react-three/fiber` + `@react-three/drei`,不新增 3D 框架。

## 驗收條件
- 使用者在步驟 02 可以進入新的步驟 03「精密 3D」,也可以返回 02;wizard 進度列正確顯示三個步驟。
- 步驟 03 呈現的場地內容(地板形狀、牆、柱、家具位置與旋轉)與步驟 02 完全一致。
- 步驟 03 的家具不再是單一方塊:各家具類型有可辨識的造型(例:桌子有桌面與桌腳、椅子有椅背)。
- 步驟 03 的地板、牆面、家具具有 PBR 材質表現(非純色平光),並有陰影與多光源打光。
- 步驟 03 為唯讀:點擊物件不會進入選取/搬移狀態,僅能用 orbit controls 旋轉/縮放/平移視角。
- 在步驟 02 停留時不載入步驟 03 專用的貼圖資源;步驟 03 資源載入期間顯示載入指示。
- 步驟 01/02 既有行為(2D 編輯、白模預覽、AI 面板常駐與 tool call 套用)不受影響。

## 任務清單
- [x] [FRONTEND] 步驟 03 骨架:`WizardStep` 新增第三步、`WIZARD_STEPS` 加入「03 精密 3D」、前後導覽與進度列、建立唯讀 `RefinedScene` 元件(先沿用現有 box 幾何),複用 02 的 plan state
- [ ] [FRONTEND] 打光與陰影:shadow map、多光源配置、tone mapping / 環境光設定,套用至步驟 03 場景
- [ ] [FRONTEND] PBR 材質:地板/牆/柱套用材質貼圖(含 lazy load 與載入指示),步驟 02 不載入這些資源
- [ ] [FRONTEND] 參數化家具幾何:依 `FURNITURE_DEFAULTS` 各 kind 產生組合式幾何(桌面+桌腳、椅背等)取代單一 box,尺寸仍由 `w / h / height3d` 驅動
- [ ] [FRONTEND] 效能與驗收:步驟 03 資源只在進入時載入、離開可釋放,Playwright 驗收三步驟流程與唯讀行為

<!--
給 STORY 撰寫者的備註:
- 每個任務會獨立跑完整條 pipeline (orchestrate → architect → implement → review → QA → playwright)
- 任務由上到下依序處理,一次一個
- orchestrator 會在 architect 規劃前,針對每個任務問澄清問題
- 執行: /ship stories/venue-refined-3d.md 啟動 pipeline

待 orchestrator 澄清的項目:
- 材質貼圖來源(自製程序化材質 vs 免費 CC0 貼圖包如 Poly Haven),以及是否可接受增加 repo 體積
- 「精密」的目標品質基準(內部評估用 vs 對客戶提案用),影響材質與幾何投入程度
-->
