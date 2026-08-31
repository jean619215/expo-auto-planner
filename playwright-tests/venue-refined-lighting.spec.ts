import { test, expect, type Page } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";

// Playwright acceptance gate for「精密 3D 場景 (步驟 03)」task 2: 打光與
// 陰影(.claude/pipeline/architect-plan.md D1-D8)。涵蓋
// orchestrator-output.md 的 10 條 Clarified Acceptance Criteria + edge
// cases。
//
// 本 spec 一律讀 [data-testid="refined-scene"] 上由場景探針
// (RefinedSceneProbe.tsx)回報的 data-* 屬性 — 那些值取自 renderer /
// scene 實例(gl.shadowMap / light.shadow.camera / gl.info.memory 等),
// 而非原始碼字面量;不做像素比對(理由見 architect-plan.md D8:WebGL 輸出
// 跨機器/驅動不可能逐像素一致)。其中一個測試(案例 14)會產出一張
// 非斷言用的截圖(playwright-report/refined-lighting.png),供人工判讀
// 「展場實景感」是否到位。

// Hosts / file types that would mean the IBL silently regressed to drei's
// `<Environment preset=...>` path, which fetches an HDRI from
// raw.githack.com at runtime (useEnvironment.js:8). D4 rejected that in
// favour of a zero-download procedural environment, so a request matching
// any of these is a defect, not a flake.
const FORBIDDEN_ENV_ASSET_PATTERNS = ["githack.com", "polyhaven", ".hdr", ".exr"];

/** Waits for the step-03 <canvas> to grow past its default intrinsic size. */
async function waitForRefinedCanvas(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector<HTMLCanvasElement>(
      '[data-testid="refined-scene"] canvas',
    );
    return !!el && el.getBoundingClientRect().width > 300;
  });
}

/**
 * Waits for the scene probe's first report (`data-lighting-ready="true"`).
 *
 * 30s 不是隨手放大的:沒有 GPU 的環境(CI 容器走 SwiftShader 軟體算圖)掛一次
 * 步驟 03 的場景要十幾秒,整批連跑時更久。原本的 10s 在單跑時剛好夠、連跑時
 * 就不夠 —— 失敗會呈現成「lightingReady 一直是 false」,看起來像場景壞掉,
 * 其實只是還沒畫完。見 AGENTS.md「重量級 3D 測試要明確編列 timeout 預算」。
 */
async function waitForLightingReady(editor: PlanEditorPage) {
  await expect
    .poll(() => editor.refinedLightingReady(), { timeout: 30_000 })
    .toBe(true);
}

/**
 * Waits for the imported furniture models (task 5) to be in the scene graph.
 *
 * `waitForLightingReady()` is NOT enough for anything that counts furniture:
 * the probe's first report lands on frame 2, whereas the GLBs are fetched and
 * Draco-decoded in a worker and only mount seconds later. Reading a
 * furniture-dependent diagnostic before this resolves reads a scene that
 * genuinely has no furniture in it yet.
 */
async function waitForFurnitureModels(editor: PlanEditorPage) {
  await expect
    .poll(() => editor.refinedFurnitureModelsLoaded(), { timeout: 20_000 })
    .toBe(true);
}

/** Center point of the 3D <canvas> inside [data-testid="venue-scene"] (step 02). */
async function step2CanvasCenter(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector<HTMLCanvasElement>(
      '[data-testid="venue-scene"] canvas',
    );
    return !!el && el.getBoundingClientRect().width > 300;
  });
  const canvas = page.locator('[data-testid="venue-scene"] canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error("venue-scene canvas not visible");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Clicks the floor at the given screen point (see venue-refined-3d.spec.ts). */
async function clickFloor(page: Page, point: { x: number; y: number }) {
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.waitForTimeout(50);
  await page.mouse.up();
}

/**
 * Places one piece of furniture on the Step 2 canvas via the sidebar tool.
 * `offsetPx` shifts the click point away from the canvas center so repeated
 * placements don't land on an already-placed item (see venue-refined-3d.spec.ts).
 */
async function placeFurnitureOnStep2(
  page: Page,
  code: string,
  offsetPx: { x: number; y: number } = { x: 0, y: 0 },
) {
  await new PlanEditorPage(page).pickCatalogItem(code);
  const center = await step2CanvasCenter(page);
  await clickFloor(page, { x: center.x + offsetPx.x, y: center.y + offsetPx.y });
}

/** Draws a wall then advances 01 -> 02, without placing any furniture. */
async function toStep2WithWall(editor: PlanEditorPage) {
  await editor.navigate();
  // 見 venue-furniture-models.spec.ts 的同名說明:預設攤位改成 3x3m 之後,
  // 3D 相機會 fit 到實際地板,下面的像素偏移是按 fit=50 的遠距取景調的。
  // 開一塊 50x50 的場地把取景距離調回原樣。
  await editor.applyCustomBoothSize(50, 50);
  await editor.wallTool();
  await editor.drawWall({ x: 30, y: 30 }, { x: 35, y: 30 });
  await editor.clickNextStep();
}

test.describe("精密 3D 場景 (步驟 03) - Task 2: 打光與陰影", () => {
  test("案例1 AC1: 多光源打光,僅 1 盞投影光", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toStep2WithWall(editor);
    await editor.goToRefined();
    await waitForLightingReady(editor);

    expect(await editor.refinedLightCount()).toBeGreaterThanOrEqual(4);
    expect(await editor.refinedShadowCastingLightCount()).toBe(1);
  });

  test("案例2 AC2: 陰影啟用且為 VSM soft shadow", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toStep2WithWall(editor);
    await editor.goToRefined();
    await waitForLightingReady(editor);

    expect(await editor.refinedShadowsEnabled()).toBe(true);
    // VSM, not PCFSoftShadowMap: three r185 deprecates PCFSoftShadowMap and
    // silently coerces it to PCFShadowMap at render time
    // (three.module.js:9148-9153) — this assertion reads
    // RefinedSceneProbe's `resolveShadowMapType()`, which is derived from
    // the shadow map's actual allocated GPU resource shape (RGFormat +
    // HalfFloatType, unique to VSM), not the mutable `gl.shadowMap.type`
    // setting, so it cannot report a mechanism the renderer already
    // abandoned.
    expect(await editor.refinedShadowMapType()).toBe("VSM");
  });

  test("案例3 AC3: shadow map 解析度 2048,且陰影確實跑過(實際配置值)", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await toStep2WithWall(editor);
    await editor.goToRefined();
    await waitForLightingReady(editor);

    expect(await editor.refinedShadowMapSize()).toBe(2048);
    expect(await editor.refinedShadowMapAllocatedWidth()).toBe(2048);
  });

  test("案例4 AC2: 投影/受影對象正確(地板受影但不投影,牆/柱/家具投影)", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    // 見 toStep2WithWall 的說明:像素偏移需要固定的相機取景距離。
    await editor.applyCustomBoothSize(50, 50);

    await editor.wallTool();
    await editor.drawWall({ x: 30, y: 30 }, { x: 35, y: 30 });
    await editor.columnTool();
    await editor.placeColumn({ x: 40, y: 40 });
    await editor.clickNextStep();

    await placeFurnitureOnStep2(page, "TBL-120-75");
    await placeFurnitureOnStep2(page, "CHR-45-90", { x: 40, y: 0 });

    await editor.goToRefined();
    await waitForLightingReady(editor);
    await waitForFurnitureModels(editor);

    // 1 wall + 1 column + 2 furniture all cast; floor is deliberately
    // excluded (architect-plan.md D5).
    //
    // Asserted per category as *item* counts rather than as one total mesh
    // count: task 5 draws table/chair from GLBs, and a GLB kind contributes
    // one `InstancedMesh` per part (cabinet has 5) no matter how many items
    // are placed — so a raw mesh total no longer answers "did every piece of
    // furniture cast?" (RefinedSceneProbe.tsx's field comment).
    //
    // Polled rather than read once: the GLBs decode asynchronously, the probe
    // re-arms (RefinedScene's `probeResetKey`) only once they mount, and
    // drei's `<Instances>` fills in `InstancedMesh.count` on its own useFrame
    // — correct within a frame or two of `waitForFurnitureModels`, not on the
    // same tick.
    await expect
      .poll(() => editor.refinedShadowCasterFurnitureCount(), { timeout: 10_000 })
      .toBe(2);
    expect(await editor.refinedShadowCasterWallCount()).toBe(1);
    expect(await editor.refinedShadowCasterColumnCount()).toBe(1);
    // Both flags are read off the actual floor mesh (looked up by name in the
    // scene graph), so removing `receiveShadow` — or adding `castShadow` back,
    // which D5 forbids — fails here.
    expect(await editor.refinedFloorReceivesShadow()).toBe(true);
    expect(await editor.refinedFloorCastsShadow()).toBe(false);
  });

  test("案例5 AC4: tone mapping / color space / 曝光", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toStep2WithWall(editor);
    await editor.goToRefined();
    await waitForLightingReady(editor);

    expect(await editor.refinedToneMapping()).toBe("ACESFilmic");
    expect(await editor.refinedOutputColorSpace()).toBe("srgb");
    const exposure = await editor.refinedToneMappingExposure();
    expect(Number.isFinite(exposure)).toBe(true);
    expect(exposure).toBeGreaterThanOrEqual(0.8);
    expect(exposure).toBeLessThanOrEqual(1.6);
  });

  test("案例6 requirement 4: 環境光/IBL 已套用,且全程零下載(無 raw.githack.com 等外部請求)", async ({
    page,
  }) => {
    const externalRequests: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (!url.startsWith("http://localhost") && !url.startsWith("http://127.0.0.1")) {
        externalRequests.push(url);
      }
    });

    const editor = new PlanEditorPage(page);
    await toStep2WithWall(editor);
    await editor.goToRefined();
    await waitForLightingReady(editor);

    expect(await editor.refinedEnvironmentSet()).toBe(true);
    // Report the offending URLs rather than a bare `false`, so a regression
    // names the asset it fetched.
    const forbidden = externalRequests.filter((url) =>
      FORBIDDEN_ENV_ASSET_PATTERNS.some((pattern) => url.toLowerCase().includes(pattern)),
    );
    expect(forbidden).toEqual([]);
  });

  test("案例7 AC5: 步驟 02 完全未受影響(無探針屬性,既有打光不變)", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await toStep2WithWall(editor);

    // 步驟 02 的 venue-scene 不掛探針 — data-lighting-ready 應為 null。
    expect(await editor.scene.getAttribute("data-lighting-ready")).toBeNull();
  });

  test("案例8 edge case 極小場地: 預設 10m 地板,視錐貼合(span < 60)", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.clickNextStep();
    await editor.goToRefined();
    await waitForLightingReady(editor);

    const span = await editor.refinedShadowCameraSpanM();
    expect(span).toBeGreaterThan(0);
    expect(span).toBeLessThan(60);
  });

  test("案例9 edge case 極大場地: 視錐隨場地內容擴張(span > 60)", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    // 第三輪 T1 之後可編輯範圍是「攤位 + 5m 邊距」,預設 3×3 攤位只有 13m
    // 見方 —— 撐不出 span > 60 的場地。這一項要驗的是「極大場地」,所以先
    // 真的開一塊大攤位(60×60,範圍 [15,75]),再照原本的方式畫長牆。
    await editor.applyCustomBoothSize(60, 60);
    await editor.clickZoomReset();

    // 縮小到底(25%),讓可編輯範圍完整落在可視區域內,才能對遠端座標下達
    // 滑鼠拖曳/繪製指令(venue-zoom-pan.spec.ts 案4 慣例)。
    for (let i = 0; i < 30; i++) {
      await editor.clickZoomOut();
    }

    // 不能假設縮放收斂到固定比例後,遠端座標(如 195m)仍落在畫布可視範圍
    // 內 —— 在 25% 縮放下 (pxPerMeter x scale = 4px/m) meter x=195 會落在
    // 畫布邊界外,導致 mouseup 掉出 canvas、Konva 不會建立牆體(見
    // qa-report.md Bug 1)。改為從實際的 pxPerMeter()/stageScale()/
    // stagePosition() 與 canvas boundingBox() 反推「畫布可視範圍內能到達的
    // 最遠 meter x」,確保端點必定落在畫布內,不受縮放收斂結果的影響。
    const [box, ppm, scale, pos] = await Promise.all([
      editor.canvas.boundingBox(),
      editor.pxPerMeter(),
      editor.stageScale(),
      editor.stagePosition(),
    ]);
    if (!box) throw new Error("plan-editor canvas not visible");

    const MARGIN_PX = 20; // stay safely clear of the canvas edge
    const maxReachableMeterX = (box.width - MARGIN_PX - pos.x) / (ppm * scale);

    // 牆體要撐大到讓場地 AABB 遠超預設 10m 地板(span 需 > 60),取「畫布可
    // 視範圍內能到達的最遠端點」與「案例8基準的安全上界(65m,QA 已驗證得
    // span=73)」中較保守(較短)的一個,兩者都遠大於門檻,不會弱化斷言。
    const targetMeterX = Math.min(maxReachableMeterX, 70);
    expect(targetMeterX).toBeGreaterThan(30); // sanity: wall must still be long

    await editor.wallTool();
    await editor.drawWall({ x: 20, y: 20 }, { x: targetMeterX, y: 20 });
    // 端點必須落在畫布內才會被 Konva 建立,否則牆體數量停在 0(見 Bug 1
    // root cause)—— 在推進到下一步前先確認牆體確實建立,而非等到最後才靠
    // span 斷言間接推測。
    expect(await editor.wallCount()).toBe(1);

    await editor.clickNextStep();
    await editor.goToRefined();
    await waitForLightingReady(editor);

    const span = await editor.refinedShadowCameraSpanM();
    expect(Number.isFinite(span)).toBe(true);
    expect(span).toBeGreaterThan(60);
  });

  test("案例10 edge case 高瘦物件: near/far 未截斷陰影", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.clickNextStep();

    await placeFurnitureOnStep2(page, "BNR-80-200");
    await placeFurnitureOnStep2(page, "CAB-60-180", { x: 40, y: 0 });

    await editor.goToRefined();
    await waitForLightingReady(editor);
    await waitForFurnitureModels(editor);

    // bannerStand has no imported model (still a box, task 6); cabinet is a
    // 5-part GLB — see 案例4 for why this counts items, not meshes, and why
    // it is polled.
    await expect
      .poll(() => editor.refinedShadowCasterFurnitureCount(), { timeout: 10_000 })
      .toBe(2);
    const near = await editor.refinedShadowCameraNearM();
    const far = await editor.refinedShadowCameraFarM();
    const span = await editor.refinedShadowCameraSpanM();
    expect(near).toBeGreaterThanOrEqual(0);
    expect(far).toBeGreaterThan(near);
    // The real invariant: the depth range must cover the full frustum span
    // (= 2R, the worst-case along-axis extent of the content AABB) plus the
    // tallest object (bannerStand 2.0m, MAX_OBJECT_HEIGHT_M 3m). Without this
    // the assertions above hold for *any* near/far formula, since near is
    // clamped to >= 0.5 and far is always built from near + positive terms.
    expect(far - near).toBeGreaterThanOrEqual(span + 3);
  });

  test("案例11 edge case 空場景: 無牆/柱/家具仍正常打光,無 console error", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.clickNextStep();
    await editor.goToRefined();
    await waitForLightingReady(editor);

    expect(await editor.refinedShadowCasterMeshCount()).toBe(0);
    const span = await editor.refinedShadowCameraSpanM();
    expect(span).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  });

  test("案例12 edge case 往返多次不累積資源", async ({ page }) => {
    // 三趟 02<->03 往返,每趟都要卸掉一個 WebGL context、再建一個、再等探針
    // 重新武裝。在沒有 GPU 的環境(SwiftShader 軟體算圖)實測約 33s,預設的
    // 30s 一定不夠 —— 這支跟 `venue-procedural-furniture` 的 P6 是同一種測試,
    // 那邊早就掛了 `test.slow()`,這裡是漏掉。
    test.slow();
    const editor = new PlanEditorPage(page);
    await toStep2WithWall(editor);

    await editor.goToRefined();
    await waitForLightingReady(editor);
    const first = {
      lightCount: await editor.refinedLightCount(),
      shadowCastingLightCount: await editor.refinedShadowCastingLightCount(),
      textures: await editor.refinedRendererTextures(),
      geometries: await editor.refinedRendererGeometries(),
    };

    for (let i = 0; i < 3; i++) {
      await editor.backToPreview();
      await expect(page.locator("canvas")).toHaveCount(1);
      await editor.goToRefined();
      await waitForLightingReady(editor);
      await expect(page.locator("canvas")).toHaveCount(1);
    }

    expect(await editor.refinedLightCount()).toBe(first.lightCount);
    expect(await editor.refinedShadowCastingLightCount()).toBe(
      first.shadowCastingLightCount,
    );
    expect(await editor.refinedRendererTextures()).toBe(first.textures);
    expect(await editor.refinedRendererGeometries()).toBe(first.geometries);
  });

  test("案例13 AC8: 唯讀行為未因打光變更而退化", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toStep2WithWall(editor);
    await placeFurnitureOnStep2(page, "TBL-120-75");
    const furnitureBefore = await editor.editor.getAttribute("data-furniture");

    await editor.goToRefined();
    await waitForLightingReady(editor);
    await waitForRefinedCanvas(page);

    const canvas = editor.refinedScene.locator("canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("refined-scene canvas not visible");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    const furnitureAfter = await editor.editor.getAttribute("data-furniture");
    expect(furnitureAfter).toBe(furnitureBefore);
    await expect(page.locator('[data-testid="venue-sidebar"]')).toHaveCount(0);
    await expect(
      page.locator('[data-testid="furniture-place-TBL-120-75"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid="reset-view-button"]'),
    ).toHaveCount(0);
  });

  test("案例14 視覺證據產出(不斷言,供人工判讀)", async ({ page }) => {
    // 截圖類測試要建場景、等打光穩定、再操相機,實測約 33s,壓在預設 30s 上
    // 緣。同性質的 `venue-refined-materials` T14 與 `venue-procedural-furniture`
    // 的 P8 都有放寬預算,這裡同樣是漏掉。
    test.slow();
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 30, y: 30 }, { x: 35, y: 30 });
    await editor.columnTool();
    await editor.placeColumn({ x: 40, y: 40 });
    await editor.clickNextStep();

    await placeFurnitureOnStep2(page, "TBL-120-75");
    await placeFurnitureOnStep2(page, "CAB-60-180", { x: 40, y: 0 });
    await placeFurnitureOnStep2(page, "PLT-50-120", { x: -40, y: 20 });

    await editor.goToRefined();
    await waitForLightingReady(editor);
    await waitForRefinedCanvas(page);

    await editor.refinedScene
      .locator("canvas")
      .screenshot({ path: "playwright-report/refined-lighting.png" });
  });
});
