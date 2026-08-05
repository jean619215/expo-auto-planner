import { test, expect, type Page } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";

// 精密 3D 場景 (步驟 03) — Task 6: 3 種展場家具程序化幾何
//
// counter 接待櫃檯 / bannerStand 展示架 / podium 講台。Poly Haven 沒有這類
// 展場專屬物件的 CC0 資產(story 架構定調),所以用基本量體拼出來。
//
//   P1  三種家具的外廓**剛好等於** FURNITURE_DEFAULTS 的標稱尺寸。這是本 task
//       最容易悄悄壞掉的地方:造型是由一堆比例拼出來的,任何一個零件位移或
//       傾斜算錯,外廓就會偷偷超出或縮水,而畫面上幾乎看不出來。
//   P2  三種家具各自是**多零件**造型,不再是單一方塊(story 驗收條件:
//       「櫃檯/展示架/講台為可辨識的程序化造型」)。
//   P3  程序化家具與匯入模型互斥 —— 同一件不會被兩條路各畫一次。
//   P4  投影件數正確(牆/柱/家具投影,地板受影不投影)。
//   P5  零 GLB 請求 —— 這三種沒有模型,擺再多也不該去拉任何 .glb。
//   P6  往返 02↔03 不累積 GPU 資源。geometry 與 material 依 kind 快取在模組層,
//       所以這條要證明的是「快取真的被重用」而不只是「數字沒漲」——
//       `gl.info.memory` 根本不統計 material,少了這組計數什麼都測不到。
//   P7  同 kind 多件共用一組 `<Instances>`。
//   P8  產出人工判讀用的截圖(不斷言)。「可辨識的造型」沒有辦法自動斷言 ——
//       P2 的零件數只是最低限度的代理 —— 所以沿用 task 2/3 的做法留一張圖。
//
// 全部走 [data-testid="refined-scene"] 的 data-* 契約,不做像素比對。

const KINDS = [
  { kind: "counter", target: [1.0, 1.1, 0.5] },
  { kind: "bannerStand", target: [0.8, 2.0, 0.3] },
  { kind: "podium", target: [0.6, 1.1, 0.5] },
] as const;

async function waitForRefinedReady(editor: PlanEditorPage) {
  await expect
    .poll(() => editor.refinedLightingReady(), { timeout: 15_000 })
    .toBe(true);
}

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

/**
 * 放一件家具並確認真的放上去了。步驟 02 的可點擊地板只有 10m x 10m,在螢幕上
 * 是畫布中心附近一塊菱形,偏移太大就點空 —— 見 venue-furniture-models.spec.ts
 * 的同名 helper。
 */
async function placeFurnitureOnStep2(
  page: Page,
  editor: PlanEditorPage,
  kind: string,
  offsetPx: { x: number; y: number } = { x: 0, y: 0 },
) {
  const before = await editor.furnitureCount();
  await page.getByTestId(`furniture-place-${kind}`).click();
  const center = await step2CanvasCenter(page);
  await page.mouse.move(center.x + offsetPx.x, center.y + offsetPx.y);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.waitForTimeout(50);
  await page.mouse.up();
  await expect
    .poll(() => editor.furnitureCount(), {
      timeout: 5_000,
      message: `${kind} 沒有放上去 — 偏移 (${offsetPx.x}, ${offsetPx.y}) 可能點在地板之外`,
    })
    .toBe(before + 1);
}

async function toStep2(editor: PlanEditorPage) {
  await editor.navigate();
  await editor.clickNextStep();
}

/** 三個都在可點擊範圍內、且落在互不相同的平面圖座標上。 */
const SPREAD = [
  { x: -40, y: 0 },
  { x: 0, y: 0 },
  { x: 40, y: 0 },
];

test.describe("精密 3D 場景 (步驟 03) - Task 6: 展場家具程序化幾何", () => {
  test("P1: 三種家具的外廓剛好等於 FURNITURE_DEFAULTS 的標稱尺寸", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    for (const [index, entry] of KINDS.entries()) {
      await placeFurnitureOnStep2(page, editor, entry.kind, SPREAD[index]);
    }

    await editor.goToRefined();
    await waitForRefinedReady(editor);
    await expect
      .poll(
        () => editor.refinedProceduralFurnitureReports().then((r) => r.length),
        { timeout: 15_000 },
      )
      .toBe(KINDS.length);

    for (const entry of KINDS) {
      const report = await editor.refinedProceduralFurnitureReport(entry.kind);
      expect(report, `${entry.kind} 應該由程序化幾何繪製`).toBeDefined();
      if (!report) continue;

      expect(report.targetM, `${entry.kind} 標稱尺寸應取自 FURNITURE_DEFAULTS`)
        .toEqual([...entry.target]);

      // 1mm 容差。刻意用「等於」而不是「不超過」:程序化造型的尺寸是我們自己
      // 算出來的,沒有匯入模型那種「原生比例對不上、只好留空隙」的問題,所以
      // 外廓應該精準吃滿標稱尺寸。講台的斜面是這裡最容易出錯的一項 —— 傾斜的
      // 板子在高度與深度兩個方向佔的空間都比自身尺寸大。
      for (let axis = 0; axis < 3; axis++) {
        expect(
          report.sizeM[axis],
          `${entry.kind} 第 ${axis} 軸外廓 ${report.sizeM[axis]} 與標稱 ${report.targetM[axis]} 不符`,
        ).toBeCloseTo(report.targetM[axis], 3);
      }
    }
  });

  test("P2: 三種家具都是多零件造型,不再是單一方塊", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    for (const [index, entry] of KINDS.entries()) {
      await placeFurnitureOnStep2(page, editor, entry.kind, SPREAD[index]);
    }

    await editor.goToRefined();
    await waitForRefinedReady(editor);
    await expect
      .poll(
        () => editor.refinedProceduralFurnitureReports().then((r) => r.length),
        { timeout: 15_000 },
      )
      .toBe(KINDS.length);

    for (const entry of KINDS) {
      const report = await editor.refinedProceduralFurnitureReport(entry.kind);
      // story 驗收條件要的是「可辨識的程序化造型」。零件數 > 1 是這件事最低限度
      // 的可斷言代理:單一 box 退回去的話這條立刻紅。
      expect(
        report?.partCount ?? 0,
        `${entry.kind} 只有 ${report?.partCount} 個零件 — 退回單一方塊了?`,
      ).toBeGreaterThan(1);
    }
  });

  test("P3: 程序化與匯入模型互斥,同一件家具不會被畫兩次", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    // 一件程序化(counter)+ 一件匯入模型(table),兩條路同時活著。
    await placeFurnitureOnStep2(page, editor, "counter", { x: -30, y: 0 });
    await placeFurnitureOnStep2(page, editor, "table", { x: 30, y: 0 });

    await editor.goToRefined();
    await waitForRefinedReady(editor);
    await expect
      .poll(() => editor.refinedFurnitureModelReports().then((r) => r.length), {
        timeout: 20_000,
      })
      .toBe(1);

    const procedural = await editor.refinedProceduralFurnitureReports();
    const models = await editor.refinedFurnitureModelReports();
    expect(procedural.map((r) => r.kind)).toEqual(["counter"]);
    expect(models.map((r) => r.kind)).toEqual(["table"]);

    // 兩件家具、兩種來源,件數就是 2 —— 若某一件被兩條路各畫一次,這裡會是 3。
    await expect
      .poll(() => editor.refinedShadowCasterFurnitureCount(), { timeout: 15_000 })
      .toBe(2);
  });

  test("P4: 程序化家具會投影,地板仍然只受影不投影", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });
    await editor.columnTool();
    await editor.placeColumn({ x: 15, y: 15 });
    await editor.clickNextStep();

    for (const [index, entry] of KINDS.entries()) {
      await placeFurnitureOnStep2(page, editor, entry.kind, SPREAD[index]);
    }

    await editor.goToRefined();
    await waitForRefinedReady(editor);

    // 件數,不是 mesh 數 —— 三件家具共有 9 個零件(每種 3 個),各自是一個
    // InstancedMesh。這正是 task 5 建立 shadowCasterFurnitureCount 的理由。
    await expect
      .poll(() => editor.refinedShadowCasterFurnitureCount(), { timeout: 15_000 })
      .toBe(KINDS.length);
    expect(await editor.refinedShadowCasterWallCount()).toBe(1);
    expect(await editor.refinedShadowCasterColumnCount()).toBe(1);
    expect(await editor.refinedFloorReceivesShadow()).toBe(true);
    expect(await editor.refinedFloorCastsShadow()).toBe(false);
  });

  test("P5: 只擺程序化家具時,全程零 GLB 請求", async ({ page }) => {
    const glbRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/models/venue/")) glbRequests.push(req.url());
    });

    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    for (const [index, entry] of KINDS.entries()) {
      await placeFurnitureOnStep2(page, editor, entry.kind, SPREAD[index]);
    }

    await editor.goToRefined();
    await waitForRefinedReady(editor);
    await expect
      .poll(
        () => editor.refinedProceduralFurnitureReports().then((r) => r.length),
        { timeout: 15_000 },
      )
      .toBe(KINDS.length);
    // 「零請求」是否定斷言,讀太快就恆綠 —— 給一個安定窗口(同
    // venue-furniture-assets.spec.ts 的 settleForStrayRequests)。
    await page.waitForTimeout(1_500);

    expect(
      glbRequests,
      "這三種家具沒有模型,不該去拉任何 GLB",
    ).toEqual([]);
  });

  test("P6: 02 <-> 03 往返多次不累積 GPU 資源", async ({ page }) => {
    test.slow();
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    for (const [index, entry] of KINDS.entries()) {
      await placeFurnitureOnStep2(page, editor, entry.kind, SPREAD[index]);
    }

    await editor.goToRefined();
    await waitForRefinedReady(editor);
    await expect
      .poll(
        () => editor.refinedProceduralFurnitureReports().then((r) => r.length),
        { timeout: 15_000 },
      )
      .toBe(KINDS.length);
    const first = {
      textures: await editor.refinedRendererTextures(),
      geometries: await editor.refinedRendererGeometries(),
      procedural: await editor.refinedProceduralFurnitureStats(),
    };
    // 三種家具 x 3 個零件 = 9 組 geometry/material。
    //
    // 這兩行第一次跑就抓到東西:原本的寫法是「useMemo 建立 + useEffect 卸載時
    // dispose」,而 React StrictMode(Next.js 預設開啟)會把 render 跑兩次、
    // 只 commit 一次 —— 被丟掉的那一份永遠沒有人 dispose,所以這裡讀到的是 18。
    // 改成模組層依 kind 快取之後才是 9。
    expect(first.procedural.liveGeometries).toBe(9);
    expect(first.procedural.liveMaterials).toBe(9);

    for (let i = 0; i < 3; i++) {
      await editor.backToPreview();
      await expect(page.locator("canvas")).toHaveCount(1);
      await editor.goToRefined();
      await waitForRefinedReady(editor);
      await expect
        .poll(
          () => editor.refinedProceduralFurnitureReports().then((r) => r.length),
          { timeout: 15_000 },
        )
        .toBe(KINDS.length);
    }

    expect(await editor.refinedRendererGeometries()).toBe(first.geometries);
    expect(await editor.refinedRendererTextures()).toBe(first.textures);

    // 關鍵的一段:material 若漏放,在 gl.info.memory 上是**完全看不見**的。
    // 三趟往返之後仍然只有 9 組,而且 totalBuilds 一次都沒有再漲 —— 後者才是
    // 真正的證據:資源是被重用的,不是「每趟重建 + 每趟剛好釋放乾淨」。
    const after = await editor.refinedProceduralFurnitureStats();
    expect(after.liveGeometries, "程序化 geometry 隨往返累積了").toBe(9);
    expect(after.liveMaterials, "程序化 material 隨往返累積了").toBe(9);
    expect(
      after.totalBuilds,
      "往返之後又重建了一次 — 依 kind 的快取沒有被重用",
    ).toBe(first.procedural.totalBuilds);
  });

  test("P8: 視覺證據產出(不斷言,供人工判讀造型是否可辨識)", async ({
    page,
  }) => {
    // story 驗收條件是「櫃檯/展示架/講台為**可辨識的**程序化造型」。這件事
    // 沒辦法自動斷言,所以比照 venue-refined-lighting 案例14 / materials T14
    // 留一張截圖:三件家具並排,相機拉到接近視平線的近距離,輪廓才看得出來。
    test.slow();

    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    for (const [index, entry] of KINDS.entries()) {
      await placeFurnitureOnStep2(page, editor, entry.kind, SPREAD[index]);
    }

    await editor.goToRefined();
    await waitForRefinedReady(editor);
    await page.waitForFunction(() => {
      const el = document.querySelector<HTMLCanvasElement>(
        '[data-testid="refined-scene"] canvas',
      );
      return !!el && el.getBoundingClientRect().width > 300;
    });
    await page.waitForTimeout(2_000);

    const canvas = editor.refinedScene.locator("canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("refined-scene canvas not visible");
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // 左鍵上拖 -> 相機壓低到接近視平線(俯視看不出斜面與外伸檯面)。
    await page.mouse.move(cx, cy + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(cx, cy - box.height * 0.28, { steps: 12 });
    await page.mouse.up();

    // OrbitControls 的滾輪每格只縮一小段,而預設相機距離 target 約 47m、
    // 家具高度只有 1~2m —— 要拉到看得清輪廓需要相當多格。
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 60; i++) {
      await page.mouse.wheel(0, -400);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(1_200);

    await canvas.screenshot({
      path: "playwright-report/procedural-furniture.png",
    });
  });

  test("P7: 同 kind 多件共用一組 <Instances>", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await placeFurnitureOnStep2(page, editor, "podium", { x: -40, y: 0 });
    await placeFurnitureOnStep2(page, editor, "podium", { x: 0, y: 0 });
    await placeFurnitureOnStep2(page, editor, "podium", { x: 40, y: 0 });

    await editor.goToRefined();
    await waitForRefinedReady(editor);

    await expect
      .poll(
        () => editor.refinedProceduralFurnitureReports().then((r) => r.length),
        { timeout: 15_000 },
      )
      .toBe(1);
    const report = await editor.refinedProceduralFurnitureReport("podium");
    expect(report?.instanceCount).toBe(3);

    await expect
      .poll(() => editor.refinedShadowCasterFurnitureCount(), { timeout: 15_000 })
      .toBe(3);
  });
});
