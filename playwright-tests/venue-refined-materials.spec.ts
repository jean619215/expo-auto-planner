import { test, expect, type Page } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";
import { AiPanelPage } from "./pages/AiPanelPage";

// Playwright acceptance gate for「精密 3D 場景 (步驟 03)」task 3: 程序化
// PBR 材質(地板/牆/柱)。涵蓋 orchestrator-output.md 的 Clarified
// Acceptance Criteria + edge cases,依 architect-plan.md 的 Test Plan
// (T1-T15) 逐條實作。
//
// 驗證紀律(針對 task 2 的教訓,architect-plan.md 開頭明列):每條斷言的
// 來源必須是 renderer / scene / GPU 的實際狀態,不得是原始碼字面量或
// 「我們請求的設定」。本檔一律讀 RefinedSceneProbe.tsx 回報、經
// [data-testid="refined-scene"] 上 data-material-diagnostics(JSON)/
// data-materials-ready 曝露的值 —— 那些值取自實際 material 實例上的貼圖
// 物件與 gl.readRenderTargetPixels() 回讀,而非常數檔。

const FORBIDDEN_TEXTURE_ASSET_PATTERNS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".ktx2",
  ".hdr",
  ".exr",
  "githack.com",
  "polyhaven",
];

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

/** Waits for SurfaceMaterials' bake to commit (`data-materials-ready="true"`). */
async function waitForMaterialsReady(editor: PlanEditorPage) {
  await expect
    .poll(() => editor.refinedMaterialsReady(), { timeout: 30_000 })
    .toBe(true);
}

/** Waits until the probe has cached a real (post-readback) material report. */
async function waitForMaterialDiagnostics(editor: PlanEditorPage) {
  await expect
    .poll(async () => (await editor.refinedMaterialDiagnostics())?.ready, {
      timeout: 30_000,
    })
    .toBe(true);
  return editor.refinedMaterialDiagnostics();
}

/** Draws a wall then advances 01 -> 02, without placing any furniture. */
async function toStep2WithWall(editor: PlanEditorPage) {
  await editor.navigate();
  await editor.wallTool();
  await editor.drawWall({ x: 20, y: 20 }, { x: 25, y: 20 });
  await editor.clickNextStep();
}

/** Draws a wall + a column, then advances 01 -> 02. */
async function toStep2WithWallAndColumn(editor: PlanEditorPage) {
  await editor.navigate();
  await editor.wallTool();
  await editor.drawWall({ x: 20, y: 20 }, { x: 25, y: 20 });
  await editor.columnTool();
  await editor.placeColumn({ x: 15, y: 15 });
  await editor.clickNextStep();
}

// review-report.md Issue 4 (T14) — placing furniture flush against a wall
// requires the AI's `add_furniture` tool call (there is no manual 2D
// furniture-placement tool yet), mocked via `page.route` so the test never
// hits the real Anthropic API — same convention as
// ai-panel-persistent.spec.ts / plan-slots.spec.ts.
interface MockChatResponse {
  status: number;
  body: unknown;
}

async function mockAiChat(page: Page, responses: MockChatResponse[]) {
  let callIndex = 0;
  await page.route("**/api/ai/chat", async (route) => {
    const resp = responses[Math.min(callIndex, responses.length - 1)];
    callIndex += 1;
    await route.fulfill({
      status: resp.status,
      contentType: "application/json",
      body: JSON.stringify(resp.body),
    });
  });
}

async function mockAiConfig(page: Page) {
  await page.route("**/api/ai/config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ chatCost: 10, balance: 100 }),
    });
  });
}

// linear(#e7e5e4) — task 2's anti-overexposure floor color, converted from
// sRGB hex to linear via the standard piecewise sRGB EOTF (same conversion
// `new THREE.Color("#e7e5e4")` performs under three's default color
// management, which the app itself relies on — see architect-plan.md D5).
function srgbHexToLinear(hex: string): { r: number; g: number; b: number } {
  const toLinearChannel = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const n = parseInt(hex.replace("#", ""), 16);
  return {
    r: toLinearChannel((n >> 16) & 255),
    g: toLinearChannel((n >> 8) & 255),
    b: toLinearChannel(n & 255),
  };
}

const FLOOR_LINEAR = srgbHexToLinear("#e7e5e4");
const FLOOR_LINEAR_MEAN = (FLOOR_LINEAR.r + FLOOR_LINEAR.g + FLOOR_LINEAR.b) / 3;

// linear(#d6d3d1) — the wall's D9 base color (review-report.md Issue 5: the
// wall's brightness had no GPU-readback check of any kind).
const WALL_LINEAR = srgbHexToLinear("#d6d3d1");
const WALL_LINEAR_MEAN = (WALL_LINEAR.r + WALL_LINEAR.g + WALL_LINEAR.b) / 3;

test.describe("精密 3D 場景 (步驟 03) - Task 3: 程序化 PBR 材質(地板/牆/柱)", () => {
  test("T1: 貼圖確實掛在實際材質上(地板/牆/柱)", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toStep2WithWallAndColumn(editor);
    await editor.goToRefined();
    await waitForLightingReady(editor);
    const diagnostics = await waitForMaterialDiagnostics(editor);

    expect(diagnostics.floor?.map.present).toBe(true);
    expect(diagnostics.floor?.normalMap.present).toBe(true);
    expect(diagnostics.floor?.map.width).toBe(1024);
    expect(diagnostics.floor?.normalMap.width).toBe(1024);
    expect(diagnostics.floor?.roughnessMap?.present).toBe(true);
    expect(diagnostics.floor?.aoMap?.present).toBe(true);
    expect(diagnostics.floor?.aoMap?.channel).toBe(0);

    expect(diagnostics.wall?.map.present).toBe(true);
    expect(diagnostics.wall?.normalMap.present).toBe(true);
    expect(diagnostics.wall?.map.width).toBe(512);
    expect(diagnostics.wall?.normalMap.width).toBe(512);

    expect(diagnostics.column?.map.present).toBe(true);
    expect(diagnostics.column?.normalMap.present).toBe(true);
    expect(diagnostics.column?.map.width).toBe(512);
    expect(diagnostics.column?.normalMap.width).toBe(512);
  });

  test("T2: 貼圖內容非平坦 — shader 真的跑了(讀真實 GPU 輸出)", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toStep2WithWall(editor);
    await editor.goToRefined();
    await waitForLightingReady(editor);
    const diagnostics = await waitForMaterialDiagnostics(editor);

    // review-report.md Issue 2 — this threshold was previously calibrated
    // against a dispersed-grid readback that (per Issue 2) under-sampled
    // the texture; now that RefinedSceneProbe.tsx's `readFullAlbedoStats`
    // reads every texel, the real, honest variance of the current shader
    // (TINT_AMP.floor = 0.05 — see surfaceTextures.ts's retune note) is
    // ~0.000146, measured directly against the real GPU output (not
    // simulated). 0.0001 keeps real margin below that measured value (~31%)
    // while staying ~78x above the pure-dither noise floor a fully flat
    // `surfaceHeight()` would leave (dithering alone contributes variance
    // ~(0.5/255)^2/3 ~= 1.3e-6) — wide enough to still fail if the shader's
    // height signal were removed, without depending on a coincidental
    // sub-sample.
    expect(diagnostics.floorAlbedo?.variance).toBeGreaterThan(0.0001);
    expect(diagnostics.floorNormal?.meanZ).toBeGreaterThan(0.9);
    // varianceXY (normal-map XY perturbation, also read via a full-texture
    // readback — RefinedSceneProbe.tsx's `readFullNormalStats`) measured
    // ~0.131 for the real shader against the real GPU output — 0.01 keeps
    // wide margin above the near-zero value a flattened surfaceHeight()
    // would leave (8-bit quantization noise only) while staying well below
    // the real measurement.
    expect(diagnostics.floorNormal?.varianceXY).toBeGreaterThan(0.01);
  });

  test("T3: UV 假設守衛 — 地板 UV=公尺、牆窄邊不成條紋", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toStep2WithWall(editor);
    await editor.goToRefined();
    await waitForLightingReady(editor);
    const diagnostics = await waitForMaterialDiagnostics(editor);

    expect(diagnostics.floorUvMeterError).not.toBeNull();
    expect(diagnostics.floorUvMeterError as number).toBeLessThan(1e-3);
    expect(diagnostics.wallUvMeterError).not.toBeNull();
    expect(diagnostics.wallUvMeterError as number).toBeLessThan(1e-3);
  });

  test("T4: 無縫平鋪(數值化) — 接縫差值不大於相鄰列差值的兩倍", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toStep2WithWall(editor);
    await editor.goToRefined();
    await waitForLightingReady(editor);
    const diagnostics = await waitForMaterialDiagnostics(editor);

    const albedo = diagnostics.floorAlbedo;
    expect(albedo).not.toBeNull();
    expect(albedo!.seamDelta).toBeLessThanOrEqual(albedo!.adjacentDelta * 2);
  });

  test("T5: 不過曝 — 繼承 task 2 抗過曝調校(讀回真實貼圖平均值)", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    // review-report.md Issue 3 (R1) needs a column mesh present too, so the
    // colorSpace guard below can cover all three surfaces — toStep2WithWall
    // alone never mounts a REFINED_COLUMN_NAME mesh.
    await toStep2WithWallAndColumn(editor);
    await editor.goToRefined();
    await waitForLightingReady(editor);
    const diagnostics = await waitForMaterialDiagnostics(editor);

    const albedo = diagnostics.floorAlbedo;
    expect(albedo).not.toBeNull();
    expect(albedo!.mean).toBeGreaterThan(FLOOR_LINEAR_MEAN * 0.98);
    expect(albedo!.mean).toBeLessThan(FLOOR_LINEAR_MEAN * 1.02);
    expect(albedo!.max).toBeLessThanOrEqual(albedo!.mean * 1.05);
    expect(diagnostics.floor?.materialColorHex).toBe("ffffff");

    // review-report.md Issue 5 — the wall's D9 base color (`#d6d3d1`, ~3.5x
    // the old `#78350f`'s linear brightness) previously had no readback
    // check at all; T5's floor-only coverage could not have caught a
    // brightness regression on the one surface whose color actually
    // changed.
    const wallAlbedo = diagnostics.wallAlbedo;
    expect(wallAlbedo).not.toBeNull();
    expect(wallAlbedo!.mean).toBeGreaterThan(WALL_LINEAR_MEAN * 0.98);
    expect(wallAlbedo!.mean).toBeLessThan(WALL_LINEAR_MEAN * 1.02);
    expect(wallAlbedo!.max).toBeLessThanOrEqual(wallAlbedo!.mean * 1.05);
    expect(diagnostics.wall?.materialColorHex).toBe("ffffff");

    // review-report.md Issue 3 — R1 (colorSpace mis-set to SRGBColorSpace,
    // the plan's highest-risk item) previously had no assertion anywhere:
    // T5's byte readback above cannot see it (colorSpace only changes how
    // the shader *decodes* the texture at shading time, not the RT's raw
    // bytes), so it must be asserted directly off the real texture object.
    expect(diagnostics.floor?.map.colorSpace).toBe("srgb-linear");
    expect(diagnostics.floor?.normalMap.colorSpace).toBe("srgb-linear");
    expect(diagnostics.floor?.roughnessMap?.colorSpace).toBe("srgb-linear");
    expect(diagnostics.floor?.aoMap?.colorSpace).toBe("srgb-linear");
    expect(diagnostics.wall?.map.colorSpace).toBe("srgb-linear");
    expect(diagnostics.wall?.normalMap.colorSpace).toBe("srgb-linear");
    expect(diagnostics.column?.map.colorSpace).toBe("srgb-linear");
    expect(diagnostics.column?.normalMap.colorSpace).toBe("srgb-linear");
  });

  test("T6: 摩爾紋防護機制到位(mipmap/wrap/各向異性,讀實際貼圖物件與 renderer 真實狀態)", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await toStep2WithWall(editor);
    await editor.goToRefined();
    await waitForLightingReady(editor);
    const diagnostics = await waitForMaterialDiagnostics(editor);

    expect(diagnostics.floor?.map.minFilter).toBe("LinearMipmapLinearFilter");
    expect(diagnostics.floor?.map.generateMipmaps).toBe(true);
    expect(diagnostics.floor?.map.wrapS).toBe("RepeatWrapping");
    expect(diagnostics.floor?.map.wrapT).toBe("RepeatWrapping");
    expect(diagnostics.maxAnisotropy).not.toBeNull();
    const expectedAnisotropy = Math.min(8, diagnostics.maxAnisotropy as number);
    expect(diagnostics.floor?.map.anisotropy).toBe(expectedAnisotropy);

    // review-report.md Issue 1 (🔴) — `anisotropy` above is the JS property
    // the code requested; it stays whatever we last set it to even if three
    // silently discarded the request (exactly what the pre-fix code did:
    // assigned it AFTER WebGLRenderer.setRenderTarget()'s one-time
    // setupRenderTarget() -> setTextureParameters() pass had already run
    // with the texture still at its default anisotropy of 1, so the branch
    // that issues TEXTURE_MAX_ANISOTROPY_EXT was skipped and nothing ever
    // re-applied it). Assert the renderer's own record of what it actually
    // pushed to GL (`__currentAnisotropy`, WebGLTextures.js:696-706) as well,
    // and that the two agree — this is what makes the assertion blind to a
    // repeat of that exact bug rather than merely re-reading the same
    // (possibly stale) JS property under a different name.
    expect(diagnostics.floor?.map.anisotropyGpu).not.toBeNull();
    expect(diagnostics.floor?.map.anisotropyGpu).toBe(expectedAnisotropy);
    expect(diagnostics.floor?.map.anisotropyGpu).toBe(diagnostics.floor?.map.anisotropy);
  });

  test("T7: 往返多次不累積(真實 dispose 事件驅動的計數)", async ({ page }) => {
    // 多趟 02<->03 往返,每趟都要重建/卸掉一個 WebGL context —— 預設 30s
    // 在無 GPU 的環境不夠(同 venue-refined-lighting 案例12)。
    test.slow();
    const editor = new PlanEditorPage(page);
    await toStep2WithWall(editor);

    await editor.goToRefined();
    await waitForLightingReady(editor);
    let diagnostics = await waitForMaterialDiagnostics(editor);
    expect(diagnostics.totalSurfaceBakes).toBe(1);
    expect(diagnostics.liveSurfaceTargets).toBe(8);

    for (let i = 0; i < 2; i++) {
      await editor.backToPreview();
      await editor.goToRefined();
      await waitForLightingReady(editor);
      diagnostics = await waitForMaterialDiagnostics(editor);
    }

    expect(diagnostics.totalSurfaceBakes).toBe(3);
    expect(diagnostics.liveSurfaceTargets).toBe(8);

    await editor.backToPreview();
    // 離開步驟 03 後探針一併卸載,直接讀不到 data-material-diagnostics —
    // 改為透過一次乾淨的重新進入,確認 liveSurfaceTargets 沒有從「前兩輪
    // 共 16 個 RT」的洩漏中累積(若曾洩漏,這裡會是 16 或 24 而非 8)。
    await editor.goToRefined();
    await waitForLightingReady(editor);
    diagnostics = await waitForMaterialDiagnostics(editor);
    expect(diagnostics.totalSurfaceBakes).toBe(4);
    expect(diagnostics.liveSurfaceTargets).toBe(8);
  });

  test("T8: 步驟 02 不預先烘焙(首次進入 03 只烘焙一次)", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    // 停留在 02:沒有 refined-scene,材質診斷屬性不存在。
    expect(await editor.refinedScene.count()).toBe(0);

    await editor.wallTool();
    await editor.drawWall({ x: 20, y: 20 }, { x: 25, y: 20 });
    await editor.clickNextStep();
    // 仍在 02(preview),尚未進入 03。
    expect(await editor.refinedScene.count()).toBe(0);

    await editor.goToRefined();
    await waitForLightingReady(editor);
    const diagnostics = await waitForMaterialDiagnostics(editor);
    // 若 02 停留期間曾預先烘焙,這裡的計數會 > 1。
    expect(diagnostics.totalSurfaceBakes).toBe(1);
  });

  test("T11: 尺寸無關性 — 10m 與放大場地的 repeat 值相同", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toStep2WithWall(editor);
    await editor.goToRefined();
    await waitForLightingReady(editor);
    const small = await waitForMaterialDiagnostics(editor);
    const smallRepeat = small.floor?.map.repeatX;
    expect(smallRepeat).not.toBeNull();

    await editor.backToPreview();
    // `backToPreview()` only returns to step "preview" (02); drawing a new
    // wall requires step "edit" (01), where `[data-testid="tool-wall"]`
    // actually exists in the DOM (`PlanEditor.tsx`: `step === "edit" &&`).
    await editor.clickBackToEdit();
    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 40 }, { x: 60, y: 40 });
    await editor.clickNextStep();
    await editor.goToRefined();
    await waitForLightingReady(editor);
    const large = await waitForMaterialDiagnostics(editor);

    expect(large.floor?.map.repeatX).toBe(smallRepeat);
  });

  test("T12: 空場景 — 只有地板,牆/柱貼圖仍烘焙(8 個 RT)", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.clickNextStep();
    await editor.goToRefined();
    await waitForLightingReady(editor);
    await waitForMaterialsReady(editor);
    const diagnostics = await waitForMaterialDiagnostics(editor);

    expect(diagnostics.floor?.map.present).toBe(true);
    expect(diagnostics.liveSurfaceTargets).toBe(8);
    expect(pageErrors).toEqual([]);
  });

  test("T13: 載入指示 — 就緒後不可見,最終 data-materials-ready 為 true", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await toStep2WithWall(editor);
    await editor.goToRefined();
    await waitForMaterialsReady(editor);

    expect(await editor.refinedMaterialsReady()).toBe(true);
    await expect(page.locator('[data-testid="refined-materials-loading"]')).toBeHidden();
  });

  test("T10 (擴充自 lighting spec): 全程零外部貼圖網路請求", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (!url.startsWith("http://localhost") && !url.startsWith("http://127.0.0.1")) {
        externalRequests.push(url);
      }
    });

    const editor = new PlanEditorPage(page);
    await toStep2WithWallAndColumn(editor);
    await editor.goToRefined();
    await waitForLightingReady(editor);
    await waitForMaterialsReady(editor);

    const forbidden = externalRequests.filter((url) =>
      FORBIDDEN_TEXTURE_ASSET_PATTERNS.some((pattern) => url.toLowerCase().includes(pattern)),
    );
    expect(forbidden).toEqual([]);
  });

  test("AC: 步驟 02 完全未受影響(白模顏色/材質不變)", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.wallTool();
    await editor.drawWall({ x: 20, y: 20 }, { x: 25, y: 20 });
    await editor.clickNextStep();

    // 步驟 02 的 venue-scene 不掛材質探針。
    expect(await editor.scene.getAttribute("data-materials-ready")).toBeNull();
    await expect(page.locator('[data-testid="refined-materials-loading"]')).toHaveCount(0);
  });

  // review-report.md Issue 4 — the plan's T14 requires THREE screenshots
  // (10m top view / large-venue grazing angle / wall-flush furniture
  // contact-line close-up), not just the default view: the grazing angle is
  // the only way a human can catch the 🔴 anisotropy bug by eye (mip/aniso
  // failures are invisible close-up), and the contact-line shot is D8/R5's
  // designated check for normal-map-induced shading noise being mistaken
  // for VSM shadow acne. Not an assertion test — QA judges these visually.
  test("T14: 人工判讀截圖 — 10m 俯視 / 大場地掠射角 / 貼牆家具接觸線特寫(不斷言)", async ({
    page,
  }) => {
    // 30 次縮小 + 4 個頂點拖曳 + AI mock 對話,之後才在一片放大到 65m 的地板
    // 上做三段相機操作與截圖。在軟體渲染(CI / SwiftShader)上跑,光是後半段
    // 的相機操作就會超過預設 30 秒 —— 這條本來就不斷言任何東西,拉長預算而
    // 不是砍掉步驟,截圖才留得住原本的判讀價值。
    test.slow();
    await mockAiConfig(page);

    const editor = new PlanEditorPage(page);
    const ai = new AiPanelPage(page);
    await editor.navigate();

    // 縮小到底,讓遠端拖曳目標留在可視畫布內(venue-refined-lighting.spec.ts
    // 案例9 慣例)——把預設 10m 地板拉大到可視範圍內能到達的最大值,讓 6m
    // tile 在畫面上重複足夠多次,才是掠射角摩爾紋這個檢查真正要面對的情境。
    for (let i = 0; i < 30; i++) {
      await editor.clickZoomOut();
    }
    const [box, ppm, scale, pos] = await Promise.all([
      editor.canvas.boundingBox(),
      editor.pxPerMeter(),
      editor.stageScale(),
      editor.stagePosition(),
    ]);
    if (!box) throw new Error("plan-editor canvas not visible");
    const MARGIN_PX = 20;
    const reachableX = (box.width - MARGIN_PX - pos.x) / (ppm * scale);
    const reachableY = (box.height - MARGIN_PX - pos.y) / (ppm * scale);
    const far = Math.min(reachableX, reachableY, 65);
    expect(far).toBeGreaterThan(30); // sanity: must still be a meaningfully large floor

    await editor.dragVertexTo(0, { x: 2, y: 2 });
    await editor.dragVertexTo(1, { x: far, y: 2 });
    await editor.dragVertexTo(2, { x: far, y: far });
    await editor.dragVertexTo(3, { x: 2, y: far });

    await editor.wallTool();
    await editor.drawWall({ x: 2, y: 2 }, { x: far, y: 2 });
    await editor.clickNextStep();
    await expect(editor.stepPreview).toBeVisible();

    // 貼牆展示架(bannerStand, depth 0.3m)— D8 提到的既有測試物件,center
    // 落在牆體(厚 0.2m,中心線 y=2)近側面正外側,達成「貼牆」。
    const bannerCenterX = far / 2;
    const bannerCenterY = 2 + 0.1 + 0.15;
    await mockAiChat(page, [
      {
        status: 200,
        body: {
          content: [
            { type: "text", text: "已放置一個貼牆展示架。" },
            {
              type: "tool_use",
              id: "toolu_add_banner_1",
              name: "add_furniture",
              input: {
                code: "BNR-80-200",
                center: { x: bannerCenterX, y: bannerCenterY },
                rotationDeg: 0,
              },
            },
          ],
          stopReason: "tool_use",
          usage: { inputTokens: 40, outputTokens: 30, cacheReadTokens: 0 },
          balance: 80,
        },
      },
    ]);
    await ai.open();
    await ai.sendMessage("在牆邊放一個展示架");
    await expect(editor.scene).toHaveAttribute("data-furniture-mesh-count", "1");

    await editor.goToRefined();
    await waitForLightingReady(editor);
    await waitForMaterialsReady(editor);

    await page.waitForFunction(() => {
      const el = document.querySelector<HTMLCanvasElement>(
        '[data-testid="refined-scene"] canvas',
      );
      return !!el && el.getBoundingClientRect().width > 300;
    });

    const canvas = editor.refinedScene.locator("canvas");

    // (a) 10m 俯視(預設相機取景)。
    await canvas.screenshot({ path: "playwright-report/refined-materials-default.png" });

    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error("refined-scene canvas not visible");
    const cx = canvasBox.x + canvasBox.width / 2;
    const cy = canvasBox.y + canvasBox.height / 2;

    // (b) 大場地掠射角。OrbitControls 左鍵拖曳:向上移動滑鼠會把
    // sphericalDelta.phi 往上推,使相機貼近 maxPolarAngle(接近水平),再
    // 滾輪拉遠涵蓋整片放大後的地板 — 這是唯一能用肉眼判讀 D4/R2 的各向異
    // 性/摩爾紋防護是否真的生效的方式(review-report.md Issue 4/🔴 Issue 1)。
    await page.mouse.move(cx, cy + canvasBox.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(cx, cy - canvasBox.height * 0.45, { steps: 12 });
    await page.mouse.up();
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(200);
    await canvas.screenshot({ path: "playwright-report/refined-materials-grazing.png" });

    // (c) 貼牆家具接觸線特寫 — 驗 D8 的 shading noise / VSM 陰影漏光風險
    // (R5)。右鍵拖曳平移鏡頭朝展示架方向靠近,再滾輪拉近。
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(cx - canvasBox.width * 0.1, cy - canvasBox.height * 0.2, {
      steps: 10,
    });
    await page.mouse.up({ button: "right" });
    await page.mouse.wheel(0, -900);
    await page.waitForTimeout(200);
    await canvas.screenshot({ path: "playwright-report/refined-materials-wall-contact.png" });
  });
});
