# Architect Plan — 步驟 03 程序化 PBR 材質(地板 / 牆 / 柱)

> Story: 精密 3D 場景 (步驟 03) | Task type: FRONTEND | Generated: 2026-07-26T09:40+08:00

## Overview

把步驟 03 的地板 / 牆 / 柱從「純色 `meshStandardMaterial` + roughness/metalness 純量」升級為**零下載、GPU 一次性烘焙**的程序化 PBR 材質:每種表面各有 albedo + normal(地板另加 roughness 與一張超大尺度 macro `aoMap`),全部在**進入步驟 03 時**用 fullscreen-quad shader 渲染進 `WebGLRenderTarget`,離開時 `dispose()`。

三個技術支點,皆已逐行核對 `node_modules`,不是記憶推測:

1. **UV 單位統一為「公尺」**。three r185 `ExtrudeGeometry` 的 `WorldUVGenerator` 直接把 shape 座標當 UV 輸出 —— 地板 UV **本來就是平面座標公尺**,凹多邊形也一樣正確、零拉伸、零跳接。牆/柱是 `BoxGeometry`(UV 逐面 0..1,會把 0.2m 窄邊拉成條紋),因此**把每面的 UV 依該面實際公尺數重寫**,讓全場只有一種 UV 約定,一份共用材質即可服務任意尺寸的牆。
2. **貼圖平均值 = 該表面 task 2 既有顏色的線性值,材質 `color` 改為純白**。紋理只做「圍繞既有亮度的調變」,因此 task 2 為避免 ACES 過曝所做的調校(地板 `#f5f5f4`→`#e7e5e4`)**在建構上被保留**,而且「不會比 task 2 更亮」這件事可以用貼圖回讀數值直接斷言。
3. **測試讀真實 GPU 輸出,不讀設定值**。探針用 `gl.readRenderTargetPixels()` 把烘焙結果讀回來,回報平均值 / 變異數 / **接縫差值**,Playwright 斷言的是「shader 真的跑出了非平坦、可無縫平鋪的資料」,而非「我們設了 `generateMipmaps = true`」。這是針對 task 2 那個 bug(斷言設定值,而 renderer 實際用別的東西)的直接對策。

步驟 02(`VenueScene.tsx`)一行都不改;家具材質完全不動(task 4–6 會整組換掉)。

---

## Task Type Confirmed

**FRONTEND** — 純前端渲染。無 API route、無 DB schema、無 auth、無新增 npm 依賴、無新增靜態資產。與 orchestrator-output.md 一致,技術分析無矛盾。

## Escalation Check

| 觸發條件 | 判定 |
| --- | --- |
| 外部 API contract 變更 | 無 |
| DB schema / 既有資料 | 無(材質不進 `PlanSnapshot`,不持久化) |
| Auth / security model | 未觸及 |
| 新增外部資產 / 網路請求 | **零**(全程序化,不下載任何貼圖) |
| 複雜度超出 story 顆粒 | 否。4 個新檔 + 2 支既有元件改動 + 1 支新 spec,與 task 2 同量級 |
| 資訊是否足夠 | 足夠。orchestrator 明文授權 roughness map 的取捨由 architect 判斷(見 D6) |

**結論:不需 escalation。** 但有 **一項需人工拍板的小決策**(牆面底色),見 **D9** —— 已給出預設值(不改),核准時若無異議即照預設執行。

---

## 事前查證(逐行核對 `node_modules`,不得依記憶假設)

| 事實 | 出處 | 對本計畫的影響 |
| --- | --- | --- |
| `ExtrudeGeometry` 預設 `UVGenerator = WorldUVGenerator`;`generateTopUV` 回傳 `Vector2(a_x, a_y)` —— **直接就是 shape 座標** | `three/src/geometries/ExtrudeGeometry.js:99, 808-824` | **地板頂面 UV 天生就是公尺**,凹多邊形亦然(逐三角形獨立產生,不經 bounding-box 正規化)→ D2 的整個方案成立,不需自寫 UV、不需 triplanar |
| `generateSideWallUV` 回傳 `(x 或 y, 1 - z)`,`z` 是 extrude 深度 | 同檔 `:827-862` | 地板 0.1m 側緣的 `v` 跨距 = `dz` 公尺 → **側面 UV 也是公尺**,與頂面同尺度,不會被拉成條紋 |
| `BoxGeometry` 每面 UV 為 0..1 | `three/src/geometries/BoxGeometry.js` | 12m 長牆面與 0.2m 窄側面都拿 0..1 → **必須逐面依實際公尺重寫 UV**(D3),否則 orchestrator 明列的「牆窄邊被拉成條紋」必然發生 |
| 渲染到 **非 XR render target** 時,program 的 `outputColorSpace` = `ColorManagement.workingColorSpace`(= Linear-sRGB),**不做 sRGB 編碼** | `WebGLPrograms.js:212`、`WebGLRenderer.js:2342` | 烘焙輸出是**線性**資料 → 三張貼圖(含 albedo)一律 `colorSpace = LinearSRGBColorSpace`。**把 albedo RT 設成 `SRGBColorSpace` 會造成二次解碼、地板暴亮 → 直接毀掉 task 2 的抗過曝調校**。這是本任務最容易踩的坑,R1 明列 |
| 渲染到 render target 時 tone mapping 被強制關閉(`_currentRenderTarget === null` 才套用) | `WebGLRenderer.js:2353-2356` | 烘焙不會被 ACES 影響,寫進去什麼就是什麼 → D5 的「平均值 = 既有顏色線性值」在數學上成立 |
| `WebGLRenderer.render()` 在 `_currentRenderTarget !== null && mipmapLevel === 0` 時呼叫 `textures.updateRenderTargetMipmap()` | `WebGLRenderer.js:1764-1774` | **RT 會自動產生 mipmap**,但前提是下一條 |
| `updateRenderTargetMipmap` 只對 `textureNeedsGenerateMipmaps(texture)` 為真者動作,而該函式就是 `return texture.generateMipmaps` | `WebGLTextures.js:110, 2252-2272` | `WebGLRenderTarget` 的 `generateMipmaps` **預設 false**、`minFilter` **預設 `LinearFilter`** → **不顯式設定就沒有 mipmap**,200m 地板必然嚴重摩爾紋。D4 明列 |
| `texture.generateMipmaps = false` 的強制覆寫只發生在 `texture.mipmaps.length > 0`(呼叫端自備 mipmap)分支 | `WebGLTextures.js:1006, 1361` | 我們不自備 mipmap,不受此影響 |
| 各向異性上限 `capabilities.getMaxAnisotropy()`,實際套用取 `Math.min(texture.anisotropy, max)` | `WebGLCapabilities.js:6-24`、`WebGLTextures.js:702` | 直接寫死 16 在低階裝置會被靜默截斷 → 一律 `Math.min(8, gl.capabilities.getMaxAnisotropy())`,並把兩個值都回報供斷言 |
| `Texture.channel` 存在(預設 0);`WebGLPrograms.getChannel(0)` 回傳 `'uv'`;`aoMapUv = HAS_AOMAP && getChannel(material.aoMap.channel)` | `Texture.js:118`、`WebGLPrograms.js:46-54, 273` | **`aoMap` 可用第 0 組 UV,不需要 `uv1` 屬性** → D7 的 macro 去重複方案不需動幾何 |
| 每個貼圖槽有各自的 uv transform uniform(`aoMapTransform`、`normalMapTransform`…) | `uv_pars_vertex.glsl.js:27`、`uv_vertex.glsl.js:24` | `map` 用 `repeat=1/6`、`aoMap` 用 `repeat=1/64 + rotation` 可以並存 → macro 尺度與細節尺度互不干擾 |
| `shadowmap_vertex.glsl` 的 `shadowWorldNormal` 來自 **`transformedNormal`(頂點法線)**,`shadowWorldPosition = worldPosition + shadowWorldNormal * shadowNormalBias` | `ShaderChunk/shadowmap_vertex.glsl.js:9, 28` | **normal map 在 fragment 階段才作用,完全影響不到 `normalBias`** → orchestrator edge case「normal map 與 VSM `normalBias: 0.06` 互動導致貼牆家具重新漏光」**在機制上不可能發生**。真正的風險是另一回事,見 D8 |
| drei 只提供 `GradientTexture` / `NormalTexture` / `MatcapTexture`;後兩者從 GitHub CDN 下載素材 | `@react-three/drei/core/` 目錄清單 + `NormalTexture.js` / `MatcapTexture.js` | **drei 沒有任何可用的程序化噪聲 / PBR 貼圖工具**,且 `NormalTexture` / `MatcapTexture` 會打第三方 CDN → 全數否決(D1) |
| `WebGLRenderTarget.dispose()` 會 dispatch `'dispose'` 事件(`EventDispatcher`) | `three/src/core/RenderTarget.js` + `EventDispatcher.js` | 釋放計數器可以掛在**真實 dispose 事件**上,而不是我們自己的「打算 dispose」旗標 → T7 |

---

## 架構決策

### D1 — 生成方式:**GPU fullscreen-quad 烘焙進 `WebGLRenderTarget`**

在 `RefinedScene` 的 Canvas 內部,用既有的 `gl`(`useThree`)把一組 `ShaderMaterial` 渲染進 8 個 `WebGLRenderTarget`,每個 target 一次 `gl.render()`。烘焙在 `useLayoutEffect` 內完成(先 `gl.getRenderTarget()` 存檔、結束後還原),因此**在瀏覽器 paint 之前就完成**,使用者不會看到一幀無貼圖的畫面。

**為何是這個:**

- **不阻塞主執行緒**。`gl.render()` 只是把指令排進 GPU 佇列就返回,CPU 時間近乎零。這一點決定性地勝過 Canvas2D —— Canvas2D 要在 JS 裡跑數百萬次 per-pixel 迴圈,不但慢,而且**會凍結那一幀**,連載入指示都畫不出來(驗收條件明文禁止「無回饋的凍結」)。
- **法線是解析求得的,不是估的**。同一支 shader 裡有 `height(uv)` 這個高度函式,normal 用中央差分直接從它算出來。Canvas2D 路線只能先畫一張高度圖、再跑 Sobel 濾波近似,精度差且要多一份 buffer。
- **結果本來就在 GPU 上**,沒有 `ArrayBuffer` → `texImage2D` 的上傳成本。
- **釋放乾淨**:一個 `renderTarget.dispose()` 收掉一切,沒有 Canvas2D 路線那個「`THREE.Texture` 釋放了、底層 `<canvas>` 還在」的第二個洩漏面(orchestrator edge case 明列)。
- 這條路徑在本專案已有先例:drei 的 `<Environment>`(task 2 採用)就是在 `useLayoutEffect` 裡對 `WebGLCubeRenderTarget` 做一次性離屏渲染。

**被否決的替代方案:**

1. **Canvas2D → `CanvasTexture`** — 否決。主執行緒阻塞 + 法線只能用 Sobel 近似 + 多一個 DOM 端洩漏面。要繞開阻塞就得上 Worker + `OffscreenCanvas` + `transferToImageBitmap` + fallback 分支,複雜度遠超本任務。
2. **每 fragment 即時計算噪聲的自訂 shader(不烘焙貼圖)** — **明確否決,理由是本任務的核心風險**。程序化噪聲沒有 mipmap,也吃不到各向異性過濾;地板在 200m 場地會被大量以**掠射角**觀看,那正是必須靠 mip + aniso 才不會爆摩爾紋的情境。即時噪聲在該情境下是所有方案裡**最差**的,直接違反 AC「不出現摩爾紋」。此外還要 `onBeforeCompile` 動 `MeshStandardMaterial`,且每幀付 ALU 成本。
3. **drei 現成元件** — 否決。`GradientTexture` 只有漸層(無噪聲、無法線);`NormalTexture` / `MatcapTexture` 從 GitHub CDN 下載素材,直接違反「零外部網路請求」驗收條件。**drei 在這題上沒有東西可用**(已讀 `node_modules/@react-three/drei/core/` 全目錄確認,非憑記憶)。
4. **build 階段預先產生 PNG 進版控** — 否決。等同改回貼圖檔路線(使用者已定案為程序化),且固定解析度、增加版控體積。

### D2 — 地板 UV:**直接採用 `ExtrudeGeometry` 原生 UV,不做任何轉換**(最高風險項目的結論)

這是計畫裡風險最高的未知數,已由原始碼確認:`WorldUVGenerator.generateTopUV` 逐三角形回傳 `(vertex.x, vertex.y)`,也就是 shape 平面座標。因為地板 shape 是用**平面公尺座標**建的(`floorGeometry.ts` 直接 `shape.moveTo(polygon[0].x, polygon[0].y)`),所以:

- **UV 值 = 公尺**,不是 0..1。
- **凹多邊形完全不受影響** —— UV 逐頂點獨立產生,不經 bounding box 正規化,三角化怎麼切都不會有拉伸或跳接。orchestrator 列的這個 edge case **在此方案下不存在**。
- 側緣(`FLOOR_THICKNESS_M = 0.1`)的 `v` 跨距等於實際深度公尺數,與頂面同尺度,**不會被拉成條紋**。

因此貼圖尺度靠 `texture.repeat.set(1 / TILE_M, 1 / TILE_M)` 控制,與地板大小、形狀、凹凸**完全無關**。10m 與 200m 走同一條路徑,沒有任何依尺寸分支的程式碼 —— 這也是為什麼 T10 可以斷言「`repeat` 在兩種尺寸下是同一個值」。

備註:UV 值域達 200(不是 0..1)。Float32 屬性與 fragment shader 的 `highp` 在 200 附近的絕對精度約 2e-5 m,遠低於一個 texel(1/171 m),不構成問題。

**被否決的替代方案:** triplanar 投影(要 `onBeforeCompile`、三倍取樣、水平面上三軸權重退化)、box projection(對內凹邊仍拉伸)、自寫 UV generator(原生 UV 已正確,純屬多餘)。**唯一該做的防護是把這個假設變成斷言**(T3):萬一未來升級 three 改了 `WorldUVGenerator`,會立刻紅燈而不是靜默變成一團拉伸。

### D3 — 牆 / 柱 UV:**把每面的 UV 重寫成公尺**(新增 `boxGeometry.ts`)

`BoxGeometry` 六面各自 0..1。若沿用,12m 長的牆正面與 0.2m 的窄側面會拿到同樣的 UV 跨距 → 窄邊被拉伸約 60 倍成條紋,正是 orchestrator 點名的問題。

做法:`applyMeterUv(geometry, w, h, d)` 依 `BoxGeometry` 固定的六個 group 順序(`+x, -x, +y, -y, +z, -z`,每面 4 個頂點)把 `uv` 逐面乘上該面的實際尺寸:

| group | 面 | `u` 乘以 | `v` 乘以 |
| --- | --- | --- | --- |
| 0, 1 | ±x(牆的 0.2m 窄側面) | `d` | `h` |
| 2, 3 | ±y(頂 / 底) | `w` | `d` |
| 4, 5 | ±z(牆的正 / 背面) | `w` | `h` |

結果:**全場 UV 單位一律是公尺**,牆、柱、地板共用同一套 `repeat = 1/TILE_M` 約定,一種表面只需**一份材質**(不是每面牆一份),draw call 狀態切換與釋放成本都最低。

配套:牆 / 柱 geometry 改由 `useMeterUvBoxGeometries()` 以 `useMemo` 產生、卸載時 `dispose()` —— 比照 `floorGeometry.ts` 已建立的既有模式(AGENTS.md:不得在 render 期間新建 geometry)。額外好處:每面牆的 `u` 加一個由 `wall.id` 決定的**確定性**偏移(`hash(id) mod WALL_TILE_M`),讓相鄰牆面不從同一個紋理相位開始,消除「所有牆長得一模一樣」的破綻。

**被否決的替代方案:** 每面牆複製一份材質並各自設 `repeat`(N 份材質要管理與釋放,且 `texture.clone()` 與共享 `Source` 的釋放語意有踩雷風險);在 shader 裡用世界座標當 UV(又要 `onBeforeCompile`)。

### D4 — 平鋪、mipmap 與摩爾紋:**顯式 mipmap + 各向異性,並用「大 tile + 低對比」控制重複感**

| 表面 | RT 尺寸 | 世界 tile | 有效密度 | 200m 地板重複次數 |
| --- | --- | --- | --- | --- |
| 地板 albedo / normal / roughness | 1024² | 6 m | ≈171 px/m | 33× |
| 地板 macro(`aoMap`) | 256² | 64 m | 4 px/m | 3× |
| 牆 albedo / normal | 512² | 3 m | ≈171 px/m | — |
| 柱 albedo / normal | 512² | 3 m | ≈171 px/m | — |

- **171 px/m 的來由**:`OrbitControls` 的 `minDistance = 5`,fov 50°、視口高 480px,湊最近時 1 公尺約佔 103 px。171 px/m 留約 1.7 倍餘裕,滿足「經得起截圖放大」而不浪費記憶體。三種表面刻意取**同一密度**,避免地板細緻、牆面糊掉的不協調。
- **必須顯式設定**(否則預設值會靜默毀掉一切):`generateMipmaps = true`、`minFilter = LinearMipmapLinearFilter`、`magFilter = LinearFilter`、`wrapS = wrapT = RepeatWrapping`。`WebGLRenderTarget` 這四項的預設值**全都是錯的**(見查證表)。
- **各向異性**:`anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())`。掠射角下的地板沒有這個就是一片摩爾紋;取 8 而非 16 是因為地板是全螢幕大面積取樣,8→16 的畫質增益遠小於頻寬成本。
- **總記憶體**:1024²×4B×3 + 256²×4B + 512²×4B×4 ≈ 17.6 MB,含 mipmap ≈ 23 MB。可接受。
- 貼圖內容刻意做成**低對比**(albedo 調變僅 ±2.5%~4.5%)。33 次重複之所以不刺眼,是因為圖案本身沒有可辨識的地標特徵 —— 這比任何去重複技巧都有效。
- **已知殘留限制**:normal map 的 mipmap 會縮短法線向量,遠處可能出現輕微 specular aliasing。三者(`MeshStandardMaterial` / 無 normal-variance 機制 / 不做 shader 手術)的組合下無法根治,實務上被 D4 的低 `normalScale` 壓到可接受;明列於此以免日後被誤判為 bug。

### D5 — 亮度:**貼圖平均值 = 既有顏色的線性值,材質 `color` 設為純白**

`MeshStandardMaterial` 的 diffuse 是 `color × texture(map)`。若沿用 `color = "#e7e5e4"` 再乘一張平均值 0.8 的貼圖,地板會**暗掉 20%**;若貼圖平均值設 1.0,8-bit RT 又存不下 `1.0 ± 4%` 的上緣。

定案:**把 `REFINED_SURFACE.<surface>.color` 轉成線性 RGB 當 uniform 餵進烘焙 shader 作為基準值,調變環繞它;材質 `color` 改為 `0xffffff`。**

好處是這個性質變成**可證明**而非可宣稱:

- 亮度與 task 2 **在建構上相同** —— task 2 為避免 ACES 過曝所做的 `#f5f5f4 → #e7e5e4` 調校自動被繼承,不需要重新調一次。
- `REFINED_SURFACE` 仍是顏色的**唯一來源**,沒有新增第二處色票。
- 可直接斷言:回讀貼圖的**平均值** ≈ `linear(#e7e5e4)`(±2%)、**最大值** ≤ 該值 ×1.05 → 「材質不可能比 task 2 更亮 / 不會過曝」有了數字證據(T5)。

配套:8-bit **線性** RT 在低亮度區間的量化步階較粗(牆的 `#78350f` 線性值約 0.19,±4% 只跨約 2 個階),因此烘焙 shader 在輸出端加一道 `±0.5/255` 的 hash dither,消除大面積漸變的階梯帶。

### D6 — roughness map:**只做地板,牆與柱維持純量**

orchestrator 授權此項由 architect 判投入產出比。定案:

- **地板做**。環氧 / 拋光地坪的辨識度**主要來自反光強弱的空間變化**(打蠟不均、動線磨痕),而不是顏色變化。在 roughness 0.55 附近做 ±0.12 的大尺度變化,是本任務裡「像不像真的」CP 值最高的一項 —— 沒有它,地板只會變成「有雜訊的塑膠」。
- **牆與柱不做**。烤漆板與塗裝混凝土在現實中反光高度均勻,加 roughness 變化幾乎看不出來,卻要多 2 張 512² 貼圖與 2 次烘焙。維持 task 2 的純量(0.85 / 0.7)。

`metalness` 三者全部維持純量,不做貼圖(展場地板 / 牆 / 柱沒有金屬成分,`metalnessMap` 純屬浪費)。

### D7 — 大尺度去重複:**用 `aoMap` 承載 64m 尺度的緩慢明暗漂移**(零 shader 手術)

6m tile 在 200m 地板上重複 33 次。即使圖案低對比,人眼仍可能在大俯角截圖裡讀出格律。解法是疊一層**週期完全不同、且不對齊**的低頻變化。

因為 `MeshStandardMaterial` 沒有第二個 albedo 槽,改用 `aoMap`:

- `aoMap.channel = 0`(已查證 `getChannel(0) → 'uv'`,**不需要 `uv1` 屬性**,幾何完全不用動)。
- `aoMap.repeat = 1/64`、`aoMap.rotation = 0.7 rad`、`aoMap.center = (0.5, 0.5)`。**旋轉是關鍵**:讓 macro 的格律與 6m 的格律不共軸,兩者不會週期性對齊成一個更大的可見圖樣。
- 內容:平滑低對比 fbm,值域 [0.75, 1.0];`aoMapIntensity = 0.6`。
- `aoMap` 只影響間接光。本場景間接光佔比不小(hemisphere 0.45 + IBL `environmentIntensity` 0.35),因此**會看得出來**,呈現為橫跨整片地板的緩慢明暗起伏,正是真實展場地坪該有的樣子。

**被否決的替代方案:** `onBeforeCompile` 做 stochastic / hex-tiling texture blending。效果最好,但要對 `MeshStandardMaterial` 動 shader 手術(跨 three 版本脆弱)、貼圖取樣變三倍、且會破壞自動 mipmap 導數而必須改用 `textureGrad` 手動計算 LOD —— 那又繞回 D4 好不容易解決的摩爾紋問題。投入產出比不成立。

### D8 — 與 task 2 的 VSM 陰影互動:**`normalBias` 不受影響;真正的風險是 shading noise**

已由 `shadowmap_vertex.glsl.js:9, 28` 確認:`shadowWorldNormal` 取自 **`transformedNormal`(頂點法線)**,而 normal map 是在 fragment 階段才擾動法線。兩者在管線上根本不相交,因此:

> **orchestrator edge case「normal map 擾動法線 → 影響 `SHADOW_NORMAL_BIAS = 0.06` → 貼牆家具重新漏光 / acne」在機制上不可能發生。`SHADOW_NORMAL_BIAS`、`SHADOW_BIAS`、`VSM_RADIUS`、`VSM_BLUR_SAMPLES`、`SHADOW_MAP_SIZE` 一律不動。**(附帶效應:家具在 task 4–6 前不加貼圖,`castShadow` 的深度 pass 也完全不受本任務影響。)

真正存在的風險是另一件事:normal map 改變 `dotNL`,**高振幅法線會在受光面產生逐 texel 的明暗雜訊,肉眼可能誤判為 shadow acne**,進而誘使後續開發者去亂調陰影參數。對策是把 `normalScale` 壓低並訂為常數:**地板 0.25**(環氧地坪本就近乎平整)、**牆 0.35**(烤漆滾塗紋)、**柱 0.5**(塗裝混凝土最粗)。QA 需以「貼牆家具接觸線」與 2.0m `bannerStand` 這兩個 task 2 已用過的測試物件複驗一次(T13),確認接觸陰影既沒漏光也沒新雜訊。

### D9 — 牆面底色:**預設不改(需人工拍板)**

牆目前是 `#78350f`(飽和深棕,與步驟 02 共用)。以「烤漆板牆面」為目標,深棕有兩個客觀問題:(a) 線性值僅約 0.19,normal map 造成的受光起伏在這個亮度被壓縮到幾乎看不見,等於白做;(b) 與「展場實景」的觀感不符。

但 task 2 在 `refinedLighting.tsx` 留下明文規範:「不要在沒有客觀理由下新增顏色覆寫」,而 orchestrator 的範圍界線只點名材質、未提顏色(其禁止改色的對象是 `FURNITURE_DEFAULTS`,牆不在其中)。

**預設決策:不改**,`REFINED_SURFACE.wall` 維持無 `color` 覆寫。D5 的設計讓這件事**日後可一行反轉** —— 只要在 `REFINED_SURFACE.wall` 加一個 03-only 的 `color`,烘焙自動跟著改,不需要動任何其他程式碼。

**若核准者同意改**,建議值 `#d6d3d1`(暖淺灰,linear ≈ 0.66,與地板 0.79 拉開層次且不過曝),請在核准時明說,implement 階段一併處理。

---

## Files to Create

| File path | Purpose |
| --- | --- |
| `src/components/venue/surfaceBakeShader.ts` | 烘焙用 GLSL 字串:共用可平鋪噪聲庫(週期性 hash / value noise / fbm)、每種表面的 `height()` 與 `albedoTint()`、以及 albedo / normal / roughness / macro 四種輸出模式。純字串,不 import THREE |
| `src/components/venue/surfaceTextures.ts` | `SURFACE_TEXTURE_SPEC`(尺寸 / tile / normalScale 等常數)、`bakeSurfaceTextures(gl)`(建 8 個 RT、逐一渲染、設 filter / wrap / aniso / colorSpace)、`disposeSurfaceTextureSet()`、以及掛在**真實 `'dispose'` 事件**上的存活計數器 `getSurfaceTextureStats()` |
| `src/components/venue/SurfaceMaterials.tsx` | React context provider:在 `useLayoutEffect` 內烘焙、以 `useMemo` 建立 floor / wall / column 三份 `MeshStandardMaterial`、卸載時 dispose、回報 ready。`useSurfaceMaterials()` hook 供子元件取用 |
| `src/components/venue/boxGeometry.ts` | `applyMeterUv(geometry, w, h, d)` 與 `useMeterUvBoxGeometries(specs)`(公尺 UV 的 box geometry,含 memo 與 dispose),比照 `floorGeometry.ts` 模式 |
| `playwright-tests/venue-refined-materials.spec.ts` | 本任務的驗收 gate |

## Files to Modify

| File path | What changes |
| --- | --- |
| `src/components/venue/RefinedScene.tsx` | 以 `<SurfaceMaterials>` 包住場景內容;地板 / 牆 / 柱改用共用材質(`<primitive object={material} attach="material">`)而非 inline `<meshStandardMaterial>`;牆 / 柱幾何改用 `useMeterUvBoxGeometries`;牆 / 柱 mesh 加 `name` 供探針定位;新增 `data-materials-*` 屬性與載入指示 overlay。**家具 mesh 一行不動** |
| `src/components/venue/RefinedSceneProbe.tsx` | 擴充 `RefinedDiagnostics`:逐表面回報**實際材質實例**上的貼圖狀態(存在性、尺寸、wrap / minFilter / anisotropy / colorSpace / channel / repeat)、`gl.readRenderTargetPixels` 回讀的統計量(mean / max / variance / **接縫差值**)、地板 UV 邊界 vs XY 邊界、牆 UV 公尺誤差、貼圖存活 / 累計烘焙計數、裝置 anisotropy 上限 |
| `playwright-tests/pages/PlanEditorPage.ts` | 新增讀取上述 `data-*` 的存取器(沿用既有 `refinedLightingReady()` 寫法) |

**明確不動的檔案(範圍界線):** `src/components/venue/VenueScene.tsx`、`PlanEditor.tsx`、`RefinedSceneLoader.tsx`、`floorGeometry.ts`、`src/lib/venue/*`(含 `FURNITURE_DEFAULTS`)、`refinedLighting.tsx`(D9 若獲核准則例外,僅加一個 `color` 欄位)。

---

## Implementation Steps

### 階段 A — 烘焙核心

1. **建立 `src/components/venue/surfaceBakeShader.ts`。** 匯出 `BAKE_VERTEX_SHADER`(fullscreen triangle,把 `uv` 傳給 fragment)與 `buildBakeFragmentShader(surface, mode)`。內含:
   - **可平鋪噪聲庫**:`hash21(vec2 cell, float period)` 先做 `mod(cell, period)` 再 hash;`valueNoise(vec2 p, float period)`;`fbm(vec2 p, float period, int octaves)`,第 `i` 個 octave 用 `period * 2^i` —— **每個 octave 都在貼圖邊界完美接合,整張貼圖因此嚴格可無縫平鋪**。這是 T4「接縫差值」斷言能過的機制基礎;漏掉任一 octave 的 `mod` 就會紅燈(R4)。
   - `uniform vec3 uBaseColor`(線性)、`uniform float uResolution`、`uniform float uNormalStrength`、`uniform float uRoughBase`。
   - **`height(vec2 uv)` 逐表面配方**:
     - `floor`(環氧 / 拋光地坪):`fbm(uv*1.5, 4 oct) * 0.35` + 細橘皮 `fbm(uv*24.0, 2 oct) * 0.08` + 稀疏骨材斑點(對 `uv*40` 的 cell hash 取閾值,低對比)。
     - `wall`(烤漆板):滾塗紋 `fbm(uv*40.0, 2 oct) * 0.6` + 極低頻板面起伏 `fbm(uv*0.8, 2 oct) * 0.4`。
     - `column`(塗裝混凝土):**方向性** `fbm(vec2(uv.x*3.0, uv.y*18.0), 3 oct)`(模板 / 刷痕的垂直走向)+ `fbm(uv*8.0, 2 oct)`。
   - **輸出模式**:
     - `ALBEDO`:`uBaseColor * (1.0 + amp * (tint - 0.5) * 2.0)`,`amp` = 地板 0.045 / 牆 0.025 / 柱 0.035;輸出前加 dither。
     - `NORMAL`:對 `height()` 做中央差分(步長 = 1 texel = `1.0/uResolution`),`n = normalize(vec3(-dhdx * uNormalStrength, -dhdy * uNormalStrength, 1.0))`,輸出 `n * 0.5 + 0.5`。
     - `ROUGHNESS`:`uRoughBase + 0.12 * (fbm(uv*0.9, 3 oct) - 0.5) * 2.0`,寫進 **`.g` 通道**(three 的 `roughnessMap` 只讀 `.g`),加 dither。
     - `MACRO`:平滑 fbm 映射到 `[0.75, 1.0]`,寫滿 RGB。
   - **明確不做**:木紋、大理石、磁磚縫格線。磁磚縫在 200m 上重複 33 次會是最刺眼的「一眼看穿的規律平鋪」,而且高對比細線正是掠射角摩爾紋的溫床 —— 與 orchestrator「素面才是程序化的主場、不要碰複雜有機紋理」的指示一致。

2. **建立 `src/components/venue/surfaceTextures.ts`。**
   - 匯出常數:`FLOOR_TILE_M = 6`、`WALL_TILE_M = 3`、`COLUMN_TILE_M = 3`、`FLOOR_MACRO_TILE_M = 64`、`FLOOR_RES = 1024`、`WALL_RES = 512`、`COLUMN_RES = 512`、`MACRO_RES = 256`、`NORMAL_SCALE = { floor: 0.25, wall: 0.35, column: 0.5 }`、`MAX_ANISOTROPY = 8`、`AO_MAP_INTENSITY = 0.6`、`MACRO_ROTATION_RAD = 0.7`。
   - `bakeSurfaceTextures(gl: THREE.WebGLRenderer): SurfaceTextureSet` —— 建一個共用的 `THREE.Scene` + `OrthographicCamera` + fullscreen `BufferGeometry`,依序:
     1. `const prevTarget = gl.getRenderTarget()`。
     2. 對 8 個目標各建 `new THREE.WebGLRenderTarget(res, res, { depthBuffer: false, stencilBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, colorSpace: THREE.LinearSRGBColorSpace })`。
     3. 設好對應 `ShaderMaterial` 的 uniform → `gl.setRenderTarget(rt)` → `gl.render(quadScene, quadCam)`(mipmap 由 `WebGLRenderer.render()` 自動產生)。
     4. `rt.texture.anisotropy = Math.min(MAX_ANISOTROPY, gl.capabilities.getMaxAnisotropy())`。
     5. 全數完成後 `gl.setRenderTarget(prevTarget)`,並 dispose 臨時的 `ShaderMaterial` 與 quad geometry。
   - **`colorSpace` 一律 `LinearSRGBColorSpace`,含 albedo。** 加註解說明理由(RT 路徑不做 sRGB 編碼,設成 `SRGBColorSpace` 會二次解碼把地板炸亮)—— 見 R1。
   - **計數器**:模組層 `let liveTargets = 0; let totalBakes = 0;`。建立時 `liveTargets++`,並對每個 RT 掛 `rt.addEventListener('dispose', () => { liveTargets--; })` —— **減量掛在 three 實際派發的 dispose 事件上,而不是我們自己的意圖旗標**,這樣計數反映的是真實釋放。匯出 `getSurfaceTextureStats()`。
   - `disposeSurfaceTextureSet(set)`:對 8 個 RT 逐一 `dispose()`。

3. **建立 `src/components/venue/SurfaceMaterials.tsx`。**
   - `useLayoutEffect` 呼叫 `bakeSurfaceTextures(gl)` → `setState(set)`;cleanup 呼叫 `disposeSurfaceTextureSet(set)`。依賴**只有 `[gl]`** —— 貼圖與平面圖內容完全無關(UV 是世界公尺),所以場地改變不重烘焙,`revision` 不參與。
   - `useMemo` 依 `[set]` 建三份 `MeshStandardMaterial`:
     - floor:`{ map, normalMap, roughnessMap, aoMap, color: 0xffffff, metalness: REFINED_SURFACE.floor.metalness, side: THREE.DoubleSide, normalScale: new THREE.Vector2(0.25, 0.25), aoMapIntensity: 0.6 }`;`aoMap.channel = 0`;各貼圖 `repeat` 依其 tile 設定,`aoMap.rotation = 0.7`、`aoMap.center.set(0.5, 0.5)`。
     - wall / column:`{ map, normalMap, color: 0xffffff, roughness: REFINED_SURFACE.<s>.roughness, metalness: ... , normalScale }`。
   - 對應 `useEffect` cleanup 逐一 `material.dispose()`。
   - Context 值 `{ materials, ready }`;`set` 尚未就緒時 `materials = null`,消費端回退到 task 2 的純色材質。因 `useLayoutEffect` + `setState` 在同一次 commit 內完成,實務上使用者不會看到這個中間態,但它保證場景永遠不會有破洞。
   - 以 `onReady` callback 把 ready 狀態往上送給 `RefinedScene`(DOM 層要用)。

### 階段 B — 幾何 UV

4. **建立 `src/components/venue/boxGeometry.ts`。** `applyMeterUv(geometry, w, h, d)` 依 D3 表格逐 group(每 4 頂點)就地縮放 `uv` 屬性並設 `needsUpdate = true`。`useMeterUvBoxGeometries(specs: { id, w, h, d, uOffset? }[])` 用 `useMemo` 產生 `Map<string, BufferGeometry>`,`useEffect` cleanup 逐一 `dispose()` —— 與 `useFloorGeometry` 同一套模式,符合 AGENTS.md「不得在 render 期間新建 geometry;卸載時 dispose」。

5. **`RefinedScene.tsx` 的牆與柱改用 `useMeterUvBoxGeometries`。** 牆 spec `{ id: wall.id, w: wallLengthM(wall), h: WALL_HEIGHT_M, d: WALL_THICKNESS_M, uOffset: hash(wall.id) % WALL_TILE_M }`;柱 spec `{ id: col.id, w: col.w, h: WALL_HEIGHT_M, d: col.h }`。移除 inline `<boxGeometry args={...}>`,改為 `geometry={geoMap.get(id)}`。**位置 / 旋轉 / `castShadow` / `receiveShadow` 全部不動。**

### 階段 C — 場景接線與載入指示

6. **`RefinedScene.tsx`:以 `<SurfaceMaterials onReady={setMaterialsReady}>` 包住 `<FloorMesh>` / 牆 / 柱。** 材質改成 `<primitive object={material} attach="material" />`(材質由 provider 擁有與釋放,**不可**用 `<meshStandardMaterial>` 讓 R3F 重複建立 —— 見 R8)。**家具 mesh 保持原樣的 inline `<meshStandardMaterial>`,一行不改。** 牆 / 柱 mesh 各加 `name={REFINED_WALL_NAME}` / `name={REFINED_COLUMN_NAME}`(新常數放 `RefinedSceneProbe.tsx`,比照既有 `REFINED_FLOOR_NAME`)供探針定位實際材質。

7. **載入指示。** `RefinedScene` 以 `materialsReady` 控制一個 `[data-testid="refined-materials-loading"]` 的絕對定位 overlay(覆在 canvas 容器上,文案「材質產生中…」),並在容器根加 `data-materials-ready={String(materialsReady)}`。既有 `RefinedSceneLoader` 的動態載入 fallback 保留不動 —— 兩者分工:前者蓋 JS chunk 載入,後者蓋烘焙。**誠實說明:在有 GPU 的機器上烘焙在單一 commit 內完成,這個 overlay 實際上不會被看見;它存在是為了低階裝置與 CI(SwiftShader)不會出現無回饋的凍結。**

8. **`RefinedSceneProbe.tsx` 擴充診斷。** 全部**從場景實際物件讀取**,不從常數檔讀:
   - 依 `REFINED_FLOOR_NAME` / `REFINED_WALL_NAME` / `REFINED_COLUMN_NAME` traverse 取得**實際 material 實例**,回報每個 `map` / `normalMap` / `roughnessMap` / `aoMap` 的:存在性、`image.width/height`、`wrapS` / `wrapT` / `minFilter` / `magFilter` / `anisotropy` / `colorSpace` / `channel` / `repeat` / `generateMipmaps`(列舉值轉成常數名字串回報),以及 `material.color.getHexString()`、`material.normalScale.x`。
   - 一併回報 `gl.capabilities.getMaxAnisotropy()`,讓測試能斷言「有效各向異性 = `min(8, 上限)`」而不是硬碰 8。
   - **回讀統計(真實 GPU 輸出)**:`gl.readRenderTargetPixels()` 對地板 albedo RT 取樣 —— (a) 一塊 64×64 內部區塊 → `mean` / `max` / `variance`;(b) 第 0 行與第 `N-1` 行整列 → `seamDelta`(平均絕對差);(c) 第 `N/2` 與 `N/2+1` 兩相鄰行 → `adjacentDelta`。同樣對地板 normal RT 取 `meanZ` 與 `varianceXY`。**只在首次報告時做一次**,不進每幀路徑(沿用既有 `PROBE_ACTIVE_FRAMES` 機制)。
   - **UV 假設守衛**:回報地板 geometry `uv` 屬性的 bounding box 與 `position` 屬性在 shape 平面上的 bounding box(兩者理應相等);回報任一面牆 geometry 各 group 的「uv 跨距 ÷ 該面實際公尺數」對 1 的最大偏差(`wallUvMeterError`)。
   - 回報 `getSurfaceTextureStats()` 的 `liveTargets` / `totalBakes`,以及烘焙耗時(僅供人工參考,不斷言)。

9. **`playwright-tests/pages/PlanEditorPage.ts`** 新增對應存取器。

### 階段 D — 驗收與收尾

10. **撰寫 `playwright-tests/venue-refined-materials.spec.ts`**(內容見 Test Plan)。
11. **`npm run lint` 零錯誤**(AGENTS.md 硬性要求)。
12. **產出人工判讀截圖**進 `playwright-report/`:(a) 10m 預設場地俯視、(b) 大場地**掠射角**、(c) 貼牆家具接觸線特寫。

---

## Data Flow

```
進入步驟 03(PlanEditor: step === "refined")
  └─ RefinedSceneLoader  ── next/dynamic ssr:false ── 「載入中…」(JS chunk)
       └─ RefinedScene
            └─ <Canvas>                     ← gl (WebGLRenderer)
                 └─ <SurfaceMaterials>      ← useThree(gl)
                      │ useLayoutEffect(一次,依賴 [gl])
                      │   bakeSurfaceTextures(gl)
                      │     prev = gl.getRenderTarget()
                      │     for 8 targets:
                      │       ShaderMaterial(uBaseColor = linear(REFINED_SURFACE.*.color))
                      │       gl.setRenderTarget(rt) → gl.render(quad)
                      │       → RT 自動產生 mipmap(WebGLRenderer.js:1773)
                      │       → colorSpace = Linear, wrap = Repeat, aniso = min(8, cap)
                      │     gl.setRenderTarget(prev)
                      │   → setState(set) → onReady(true) → data-materials-ready="true"
                      │
                      │ useMemo([set]) → 3 份 MeshStandardMaterial
                      │   color = 0xffffff(亮度已烘進貼圖 → D5)
                      │   repeat = 1 / TILE_M   ←── UV 單位是公尺
                      ▼
            ┌─────────┴──────────────────────────────────┐
       FloorMesh                                 牆 / 柱 mesh
       useFloorGeometry(不改)                    useMeterUvBoxGeometries
       ExtrudeGeometry UV = (x, y) 公尺           BoxGeometry UV × 該面公尺數
       凹多邊形亦成立(D2)                        0.2m 窄面不再被拉伸(D3)
            └─────────┬──────────────────────────────────┘
                      ▼
            MeshStandardMaterial:
              diffuse = white × map(uv / 6)
              normal ← normalMap(uv / 6) × normalScale
              rough  ← roughnessMap(uv / 6).g      (僅地板)
              indirect × aoMap(rot(uv) / 64)       (僅地板,D7 去重複)
                      ▼
            task 2 的燈組 / VSM 陰影 / ACES 曝光 1.1(完全不動)
              normalBias 走頂點法線 → 與 normal map 無交集(D8)

離開步驟 03(step !== "refined" → RefinedScene unmount)
  └─ SurfaceMaterials cleanup
       ├─ material.dispose() ×3
       └─ disposeSurfaceTextureSet() → rt.dispose() ×8
            → three 派發 'dispose' 事件 → liveTargets -= 8   ← 測試讀的就是這個
```

---

## Test Plan

**驗證紀律(針對 task 2 的教訓):** 每條斷言的來源必須是 **renderer / scene / GPU 的實際狀態**,不得是原始碼字面量或「我們請求的設定」。task 2 的 bug 是斷言了 `PCFSoftShadowMap` 這個*設定*,而 renderer 已把它靜默降級。本計畫的對策:凡能回讀真實輸出的一律回讀(`readRenderTargetPixels`);只能讀設定的,就讀**實際材質實例上的那個貼圖物件**(不是常數檔),並額外斷言一個只有「機制真的跑起來」才成立的推論值。

**沒有單元測試框架的因應:** 本專案無 JS 單元測試框架。`applyMeterUv` 這類純函式的正確性改由**探針回報 + Playwright 斷言**覆蓋 —— T3 的 `wallUvMeterError` 就是 `applyMeterUv` 的等價單元測試,而且是在真實 geometry 上跑的,比單元測試更接近真相。

### Playwright 驗收(`venue-refined-materials.spec.ts`)

| # | 測試 | 斷言(讀真實狀態) | 對應 AC |
| --- | --- | --- | --- |
| T1 | 貼圖確實掛在實際材質上 | traverse 場景取得地板 / 牆 / 柱**實際 material**:`map` 與 `normalMap` 皆非 null;`image.width` 分別為 1024 / 512 / 512;地板另有 `roughnessMap` 與 `aoMap`(`channel === 0`) | 「表面呈現紋理且有法線起伏」 |
| T2 | **貼圖內容非平坦(shader 真的跑了)** | 回讀地板 albedo RT:`variance > 0.0002`(不是純色);回讀 normal RT:`meanZ > 0.9` 且 `varianceXY > 0`(有真實法線擾動,且不是全 `(0.5,0.5,1)` 的空白法線圖)。**這是唯一能證明烘焙 shader 真的執行的斷言 —— 若設定值全對但 shader 沒跑,T1 仍會過,T2 會紅** | 同上 |
| T3 | **UV 假設守衛** | 地板:`uvBounds` 與 `xyBounds` 之差 < 1e-3(證明 `WorldUVGenerator` 仍輸出公尺 UV;three 升級若改了它會立刻紅燈,而不是靜默出現拉伸)。牆:`wallUvMeterError < 1e-3`(證明 `applyMeterUv` 對**含 0.2m 窄面在內的六個面**都正確) | 「凹多邊形無拉伸」「牆窄邊不成條紋」 |
| T4 | **無縫平鋪(數值化)** | `seamDelta <= 2 × adjacentDelta`。若噪聲不是週期性的,首末行的差會遠大於相鄰行的差 → 紅燈。**這是把「看起來沒接縫」變成可斷言命題的關鍵設計** | 「200m 無明顯接縫」 |
| T5 | **不過曝(繼承 task 2 調校)** | 回讀地板 albedo:`mean` 落在 `linear(REFINED_SURFACE.floor.color) ± 2%`;`max <= mean × 1.05`;且實際 `material.color.getHexString() === "ffffff"`。三者合起來證明「材質在數學上不可能比 task 2 亮」 | 「ACES 曝光 1.1 下不過曝」 |
| T6 | 摩爾紋防護機制到位 | 讀**實際貼圖物件**:`minFilter === LinearMipmapLinearFilter`、`generateMipmaps === true`、`wrapS`/`wrapT === RepeatWrapping`、`anisotropy === Math.min(8, reportedMaxAnisotropy)`(對照探針回報的裝置上限,不硬碰 8) | 「200m 不出現摩爾紋」 |
| T7 | **往返不累積(真實 dispose 事件)** | 02→03→02→03→02→03 三輪後:`totalBakes === 3`(證明每次進入才烘焙 → 步驟 02 沒有預付成本)且 `liveTargets === 8`(證明前兩輪的 16 個 RT **確實派發過 dispose 事件**,不是 24)。最後回到 02 再讀一次,`liveTargets === 0` | 「往返不累積」「02 不付成本」 |
| T8 | 步驟 02 不付成本(結構面) | 停留在 02 時 `[data-testid="step-refined"]` 不存在;首次進入 03 前 `totalBakes === 0` | 「02 不預先生成貼圖」 |
| T9 | 陰影未退化 | 沿用 `venue-refined-lighting.spec.ts` 既有探針欄位:`shadowMapType === "VSM"`、`shadowMapAllocatedWidth === 2048`、`floorCastsShadow === false`、`toneMappingExposure === "1.1"` 全數不變 | 「既有行為不退化」 |
| T10 | **零外部網路請求** | `page.route('**/*')` 全程監聽;斷言無任何請求命中 `.png` / `.jpg` / `.jpeg` / `.ktx2` / `.hdr` / `.exr` / `githack.com` / `polyhaven`(擴充 `venue-refined-lighting.spec.ts` 既有的 `FORBIDDEN_ENV_ASSET_PATTERNS`) | 「全程零外部網路請求」 |
| T11 | 尺寸無關性 | 10m 預設場地與放大後的大場地,探針回報的 `repeat` 值**完全相同**(證明沒有依尺寸分支的縮放邏輯,平鋪正確性不隨尺寸改變) | 「10m 與 200m 皆正常」 |
| T12 | 空場景 | 只有地板、無牆無柱時:`materials-ready === true`、地板貼圖齊備、`liveTargets === 8`(牆 / 柱貼圖仍烘焙 —— 刻意如此,見 Architecture Notes)、無 console error | edge case「空場景」 |
| T13 | 載入指示 | `data-materials-ready` 最終為 `"true"`;為 `"true"` 時 `[data-testid="refined-materials-loading"]` 不可見。**不斷言「overlay 曾經可見」**(在有 GPU 的機器上它是 sub-frame 的,斷言必然 flaky)—— 該支路由人工判讀覆蓋 | 「有可感知延遲時顯示載入指示」 |
| T14 | 人工判讀截圖(非斷言) | 產出三張截圖:10m 俯視、大場地**掠射角**、貼牆家具接觸線特寫。掠射角是摩爾紋唯一有效的判讀方式;接觸線那張驗 D8 的 shading noise 與 VSM 漏光 | 品質基準(對外提案用) |
| T15 | 步驟 01 / 02 不退化 | 既有 `venue-3d-scene.spec.ts` / `venue-plan-editor.spec.ts` / `venue-objects.spec.ts` / `ai-panel-persistent.spec.ts` / `venue-refined-3d.spec.ts` 全綠;另補一條:步驟 02 白模外觀與本任務前一致 | 「02 維持白模」「既有行為不變」 |

### 明說「不可斷言」的部分

- **「看起來像不像展場」無法自動化斷言。** WebGL 輸出跨機器 / 驅動不可能逐像素一致(task 2 已確立此原則),因此本任務不做像素比對。品質判斷由 T14 的人工截圖負責,**QA 需在報告中明確給出通過與否,不得略過**。
- **「烘焙耗時」不設斷言門檻。** CI 跑 SwiftShader(軟體光柵化),耗時與真實 GPU 差一到兩個數量級,任何時間門檻都是 flaky 來源。探針**回報**耗時供人工參考,但不斷言。
- **「overlay 曾經可見」不斷言**,理由見 T13。

---

## Architecture Notes

- **`SurfaceMaterials.tsx` 的存在是刻意的分層。** AGENTS.md 已標記 `PlanEditor.tsx`(約 1584 行)為複雜度熱點並要求新功能拆子元件;本任務全部新邏輯都在新檔,`RefinedScene.tsx` 的改動限於「接線」(換材質來源、換幾何來源、加兩個 DOM 屬性),不新增業務邏輯。
- **常數放在 `src/components/venue/surfaceTextures.ts` 而非 `src/lib/venue/`,是刻意的、也是本計畫唯一的慣例偏離,在此明說。** AGENTS.md 規定「場地相關型別或尺寸常數一律進 `src/lib/venue/`」,但那條規則服務的是**平面圖領域**(公尺、吸附刻度、家具尺寸)—— 2D 編輯器與步驟 02 都需要那些值。貼圖 tile 尺寸與 RT 解析度是**步驟 03 專屬的渲染參數**,2D 編輯器永遠不會讀;放進 `lib/venue/` 反而讓純領域層背上渲染語意。此外 `src/lib/venue/` 禁止 import Three,而 `bakeSurfaceTextures` 必須用 `THREE.WebGLRenderTarget`。這與 task 2 把 `refinedLighting.tsx` 放 components 層、卻把純幾何的 `bounds.ts` 放進 `lib/venue/` 的分法完全一致。
- **貼圖與平面圖內容解耦。** 因為 UV 是世界公尺,貼圖對「地板長什麼形狀」一無所知 → 場地改變(含 AI `resize_floor` / `move_item`)**不觸發重烘焙**,`revision` 完全不參與 `SurfaceMaterials`。這是 D2 帶來、容易被低估的一項收益:AI 在步驟 03 連續改動場景時,材質成本恆為零。
- **空場景仍烘焙全部 8 張,是刻意的取捨。** 依牆 / 柱數量條件式烘焙可省 4 張 512²(約 4MB),但會讓貼圖數量隨場景內容變動,T7 的洩漏偵測就失去確定的期望值。GPU 上烘焙 4 張 512² 是微秒級,拿它換一個確定可斷言的資源計數是划算的。
- **`RefinedScene` 的唯讀約束未被觸碰。** 新增的 state 只有 `materialsReady`(布林,渲染設定,非幾何);沒有 `TransformControls`、沒有 `onSceneChange`、沒有幾何 state、沒有快照 —— 02↔03 仍讀同一份頂層 props。
- **`AiPanel` 完全未觸及**(`PlanEditor.tsx` 不改),commit `97d548c` 的跨步驟對話常駐不受影響。
- **02 / 03 互斥掛載未改動**,單一 WebGL context 的前提維持。
- **效能**:烘焙是每次進入 03 一次的 GPU 工作(8 個 fullscreen quad,合計約 1.6M fragment),真實 GPU 上是零點幾毫秒級;之後每幀只多出貼圖取樣成本。AGENTS.md 要求的「明確界定資源在哪個步驟載入 / 釋放」已由 D1(進入 03 烘焙)與 T7(離開 03 釋放,以真實 dispose 事件計數證明)滿足。**步驟 02 的 2D 編輯互動延遲在結構上不可能受影響** —— 這些程式碼只被 `RefinedScene` import,而 02 / 03 互斥掛載。
- **8-bit 線性 RT 的量化**:牆的深色底(linear ≈ 0.19)在 8-bit 線性下階距較粗,已用 dither 處理(D5)。若日後 D9 把牆改成淺色,這個顧慮自動消失。

## Risks

| # | 風險 | 影響 | 對策 |
| --- | --- | --- | --- |
| R1 | **albedo RT 的 `colorSpace` 被誤設為 `SRGBColorSpace`** | 地板亮度暴增、ACES 下過曝,直接毀掉 task 2 的調校 —— 而且畫面「只是有點亮」,極易被誤認為調得不錯 | 已逐行查證 RT 路徑不做 sRGB 編碼(`WebGLPrograms.js:212`);程式碼加註解;**T5 用回讀平均值把它變成紅燈而非觀感問題** |
| R2 | **忘了設 `generateMipmaps` / `minFilter`** | `WebGLRenderTarget` 預設無 mipmap → 200m 地板嚴重摩爾紋。**近距離測試完全看不出來**,只有掠射角遠景才炸 | T6 讀實際貼圖物件斷言;T14 專門產出掠射角截圖 |
| R3 | CI(SwiftShader)烘焙耗時遠高於真實 GPU,或 `readRenderTargetPixels` 行為有差異 | 測試 flaky | 不設任何時間門檻(明列於 Test Plan);ready 一律用 `expect.poll` 搭配寬鬆 timeout;回讀只在首次報告做一次。若 SwiftShader 下 `readRenderTargetPixels` 真的不可用,退路是把統計改由烘焙後立即回讀並存進模組層,**但不得改成回報常數** |
| R4 | 週期性噪聲若沒對**每個 octave** 都取 `mod(period)`,高頻 octave 會破壞接縫 | 200m 地板出現規律接縫線 | T4 的 `seamDelta` 斷言直接量到;實作步驟 1 明文要求逐 octave `period * 2^i` |
| R5 | normal map 造成受光面逐 texel 的明暗雜訊,被誤判為 shadow acne | 觀感倒退,且可能誘使後續開發者去亂調 `SHADOW_NORMAL_BIAS` | D8 已證明 `normalBias` 與 normal map 無交集,**明文禁止調整 task 2 的陰影參數**;`normalScale` 壓在 0.25–0.5;T14 的接觸線特寫供判讀 |
| R6 | 33 次重複在大俯角截圖仍被看出格律 | 品質未達「對外提案」基準 | D7 的 64m macro `aoMap` + 旋轉錯開;低對比圖案。若人工判讀仍不滿意,`FLOOR_TILE_M` 與 macro 強度是兩個可獨立微調的旋鈕,**不需改結構** |
| R7 | 牆的深棕底色讓 normal map 幾乎看不見,牆面仍像塑膠 | 未完全達成「不像塑膠玩具」 | D9 已列為需人工拍板項,並備妥一行反轉的改法 |
| R8 | 材質改由 provider 擁有,若消費端誤用 `<meshStandardMaterial>` 會重複建立且不被釋放 | GPU 資源洩漏 | 實作步驟 6 明文要求用 `<primitive object={material} attach="material">`;T7 的 `liveTargets` 計數會抓到 RT 端洩漏;review 階段列為檢查點 |
| R9 | `useMeterUvBoxGeometries` 的 memo 依賴若寫錯,牆數量變動時 geometry 漏 dispose | GPU 資源洩漏,且 AI 在 03 加減物件時會累積 | 比照 `useFloorGeometry` 的既有寫法(`useMemo` + `useEffect` cleanup);探針同時回報 `gl.info.memory.geometries`,QA 在 03 內以 AI 連續增刪物件後檢查該值不單調成長 |

---

## Security Checklist

- [ ] 無硬編碼 secrets / tokens / credentials(本任務不涉及任何憑證)
- [ ] 系統邊界輸入驗證:不適用(無 API、無使用者輸入進入本路徑;貼圖生成不吃任何使用者資料)
- [ ] Auth / 權限檢查:不適用(純渲染,未觸及 `src/proxy.ts`、`src/lib/supabase/*`)
- [ ] 不記錄敏感資料:不新增任何 log
- [ ] **零外部網路請求**(專案特定):不下載貼圖 / HDRI / CDN 資源 —— 由 T10 以 route 監聽強制
- [ ] `service_role` / `admin.ts` 未被觸及
- [ ] 未新增 npm 依賴(無新增供應鏈風險面)
- [ ] `data-*` 診斷屬性只暴露渲染器狀態,不含任何使用者或帳號資訊

## Definition of Done

- [ ] 實作步驟 1–12 全數完成
- [ ] T1–T15 全綠;T14 的三張人工判讀截圖已產出,且 QA 在報告中明確判定「對外提案品質」通過與否
- [ ] `npm run lint` 零錯誤
- [ ] 無 TODO、無註解掉的程式碼、無 debug log
- [ ] `VenueScene.tsx` / `PlanEditor.tsx` / `RefinedSceneLoader.tsx` / `floorGeometry.ts` / `src/lib/venue/*` / `FURNITURE_DEFAULTS` **零改動**(以 `git diff --stat` 佐證)
- [ ] task 2 的陰影參數(`SHADOW_BIAS` / `SHADOW_NORMAL_BIAS` / `VSM_RADIUS` / `VSM_BLUR_SAMPLES` / `SHADOW_MAP_SIZE`)與燈組常數**零改動**
- [ ] 家具 mesh 與其材質零改動(task 4–6 的地盤)
- [ ] 符合 AGENTS.md 全部規則;唯一的慣例偏離(常數放置位置)已在 Architecture Notes 明文說明理由
- [ ] Security checklist 通過
