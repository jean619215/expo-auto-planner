import { test, expect, type Page } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";

// 精密 3D 場景 (步驟 03) — Task 7: 效能與驗收
//
// 前六個 task 各自守著自己那一塊(骨架 / 打光 / 材質 / asset pipeline /
// 匯入模型 / 程序化幾何)。這一支守的是**整個 story 的驗收條件**與**跨步驟的
// 資源紀律** —— 也就是那些沒有任何單一 task 會去測、但少了就等於 story 沒做完
// 的東西:
//
//   A  三步驟流程走得完、也回得來,進度列與內容一致(story 驗收條件 1、2)。
//   B  目錄裡每一件在步驟 03 都有造型:曲面件來自 GLB、方正件來自程序化,
//      而且兩條路互斥(story 驗收條件 3)。
//   C  唯讀 —— 點物件不會進選取/搬移,只有 orbit controls(驗收條件 6)。
//   D  資源只在進入步驟 03 時載入(驗收條件 7),而且**離開再回來不會累積**。
//   E  等比縮放,無非等比拉伸(驗收條件 4)。
//   F  步驟 01/02 既有行為不受影響(驗收條件 8)。
//
// D 是 task 7 的效能重點。匯入模型那條路原本是「useMemo 建立 + useEffect
// 卸載時 dispose」,在 React StrictMode 下被丟棄的那一份 clone 永遠沒人
// dispose,而它沒上傳過 GPU 所以 `gl.info.memory` 也看不見 —— 跟 task 6 在
// 程序化那條路上實測到「預期 9、實際 18」是同一個坑。現在兩條路都是依 kind
// 的模組層快取,這裡用 `totalBuilds` 證明快取真的被重用:live 數字不漲也可能
// 只是「根本沒再畫」,而 totalBuilds 在模型明明在畫面上時仍不漲,就只剩快取
// 命中一種解釋。

// T5(第三輪 D4)重新劃了這條線:方正規格件全部改走程序化,因為一份 GLB 只有
// 一種比例,做不出「同款不同高度」的兩個品項。留在 GLB 的只剩方箱畫不出來的
// 曲面件。兩份清單合起來仍是目錄的全部品項 —— 下面的案例靠這點確認「每一件
// 都有造型」。
/** 仍走 GLB 的曲面件。 */
const MODEL_KINDS = ["CHR-45-90", "SOF-180-80", "PLT-50-120"];

/** 走程序化幾何的方正規格件與展場專屬家具。 */
const PROCEDURAL_KINDS = [
  "CNT-100-110",
  "BNR-80-200",
  "POD-60-110",
  "TBL-120-75",
  "TBL-120-100",
  "CAB-60-180",
  "DSP-100-160",
];

/** 等比縮放的容許誤差 —— 浮點與 bounding box 計算的雜訊,不是給變形留空間的。 */
const UNIFORM_SCALE_EPSILON = 1e-4;

async function waitForRefinedReady(editor: PlanEditorPage) {
  // 30s 而非其他 spec 慣用的 15s:這一支會擺滿九種家具、六個 GLB,而且往返
  // 多趟,在 CI/SwiftShader 上探針要跑完首次量測明顯更久。
  await expect
    .poll(() => editor.refinedLightingReady(), { timeout: 30_000 })
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
 * 放一件家具並確認真的放上去了。
 *
 * 步驟 02 的可點擊地板只有 10m x 10m,在螢幕上是畫布中心附近一塊菱形,偏移
 * 太大就點空。**一定要保留這個 poll 驗證** —— 少了它,「沒放上去」會偽裝成
 * 後面某個計數斷言的失敗,查起來完全找不到方向(見 venue-furniture-models /
 * venue-procedural-furniture 的同名 helper)。
 */
async function placeFurnitureOnStep2(
  page: Page,
  editor: PlanEditorPage,
  code: string,
  offsetPx: { x: number; y: number } = { x: 0, y: 0 },
) {
  const before = await editor.furnitureCount();
  await page.getByTestId(`furniture-place-${code}`).click();
  const center = await step2CanvasCenter(page);
  await page.mouse.move(center.x + offsetPx.x, center.y + offsetPx.y);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.waitForTimeout(50);
  await page.mouse.up();
  await expect
    .poll(() => editor.furnitureCount(), {
      timeout: 5_000,
      message: `${code} 沒有放上去 — 偏移 (${offsetPx.x}, ${offsetPx.y}) 可能點在地板之外`,
    })
    .toBe(before + 1);
}

/**
 * 九個落點,全部在可點擊的菱形地板內、且互不重疊。
 *
 * 水平約 ±60px、垂直約 ±15px 就出界(RESUME.md 的環境備忘),所以是扁的格狀
 * 而不是正方格。
 */
// 一個品項一格。目錄長大時這裡要跟著加格子 —— placeAll() 會斷言件數,
// 格子不夠會直接紅在那裡,不會靜靜少放一件。
const CATALOG_SPOTS = [
  { x: -44, y: -10 },
  { x: 0, y: -10 },
  { x: 44, y: -10 },
  { x: -44, y: 0 },
  { x: 0, y: 0 },
  { x: 44, y: 0 },
  { x: -44, y: 10 },
  { x: 0, y: 10 },
  { x: 44, y: 10 },
  { x: -22, y: 20 },
];

async function toStep2(editor: PlanEditorPage) {
  await editor.navigate();
  // 預設攤位在 feedback round 2 之後是 3x3m,而 3D 相機現在會 fit 到實際
  // 地板 —— 下面那些像素偏移是按「fit=50 的遠距取景」調出來的,場地一小,
  // 同樣的像素對應的世界距離就變小,家具會互相擋住彼此的點擊。開一塊
  // 50x50 的場地把取景距離調回原樣,這些偏移才維持原本的語意。
  await editor.applyCustomBoothSize(50, 50);
  await editor.clickNextStep();
}

/** 目錄裡每個品項各一件。 */
async function placeAll(page: Page, editor: PlanEditorPage) {
  const codes = [...MODEL_KINDS, ...PROCEDURAL_KINDS];
  expect(
    CATALOG_SPOTS.length,
    "格子不夠放完目錄裡的品項 —— 目錄長大了就補格子",
  ).toBeGreaterThanOrEqual(codes.length);
  for (const [index, code] of codes.entries()) {
    await placeFurnitureOnStep2(page, editor, code, CATALOG_SPOTS[index]);
  }
  expect(await editor.furnitureCount()).toBe(codes.length);
}

// 這一支比其他 venue spec 重得多:B/D/E 要一件一件擺滿目錄裡的每個品項(每件都要等
// furnitureCount 真的變),D 還要再往返 02<->03 三趟、每趟重新等場景就緒。
// 預設的 30s test timeout 不夠,逾時會偽裝成「某個 poll 失敗」,查起來很誤導。
//
// 180s 也不夠了:T5 讓目錄多一個品項(高桌),B/D/E 每支就多擺一件、多等一次
// 放置確認。D 最重(擺滿 + 往返三趟),單獨跑實測 2.2 分,整批連跑 3.1 分 ——
// 剛好越過 3 分鐘。目錄之後還會長(T6),這裡留的餘裕要跟著走。
test.describe.configure({ timeout: 300_000 });

test.describe("精密 3D 場景 (步驟 03) - Task 7: 效能與驗收", () => {
  test("A: 三步驟流程走得完也回得來,每一步的內容與進度列一致", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    expect(await editor.currentStep()).toBe("edit");

    await editor.wallTool();
    await editor.drawWall({ x: 20, y: 20 }, { x: 25, y: 20 });
    await editor.columnTool();
    await editor.placeColumn({ x: 15, y: 15 });

    await editor.clickNextStep();
    expect(await editor.currentStep()).toBe("preview");
    await expect.poll(() => editor.sceneGenerated(), { timeout: 15_000 }).toBe(true);

    await editor.goToRefined();
    expect(await editor.currentStep()).toBe("refined");
    await waitForRefinedReady(editor);

    // 驗收條件 2:步驟 03 呈現的內容與步驟 02 完全一致。牆/柱/地板頂點數是
    // 這件事最直接的代理 —— 03 讀的是同一份頂層 props,不另存快照。
    expect(await editor.refinedWallMeshCount()).toBe(1);
    expect(await editor.refinedColumnMeshCount()).toBe(1);
    expect(await editor.refinedFloorVertexCount()).toBe(4);

    // 回得來,而且回去之後 01 仍可編輯。03->02 是 clickBackToPreview,
    // 02->01 才是 clickBackToEdit —— 兩顆是不同的按鈕。
    await editor.clickBackToPreview();
    expect(await editor.currentStep()).toBe("preview");
    await editor.clickBackToEdit();
    expect(await editor.currentStep()).toBe("edit");
    expect(await editor.wallCount()).toBe(1);
    expect(await editor.columnCount()).toBe(1);
  });

  test("B: 目錄每一件在步驟 03 都有造型,GLB 與程序化兩條路互斥", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await placeAll(page, editor);

    await editor.goToRefined();
    await waitForRefinedReady(editor);
    await expect
      .poll(() => editor.refinedFurnitureModelsLoaded(), { timeout: 30_000 })
      .toBe(true);
    await expect
      .poll(
        () => editor.refinedFurnitureModelReports().then((r) => r.length),
        { timeout: 30_000 },
      )
      .toBe(MODEL_KINDS.length);

    const modelKinds = (await editor.refinedFurnitureModelReports())
      .map((r) => r.code)
      .sort();
    const proceduralKinds = (await editor.refinedProceduralFurnitureReports())
      .map((r) => r.code)
      .sort();

    expect(modelKinds).toEqual([...MODEL_KINDS].sort());
    expect(proceduralKinds).toEqual([...PROCEDURAL_KINDS].sort());

    // 互斥 —— 同一件家具被兩條路各畫一次的話,畫面上是兩個物件疊在一起,
    // 光看截圖分不出來,只有這個交集斷言抓得到。
    const overlap = modelKinds.filter((code) => proceduralKinds.includes(code));
    expect(overlap, "同一個 kind 不得同時走模型與程序化兩條路").toEqual([]);

    // 每一種都不是單一方塊:模型至少一個 mesh,程序化至少兩個零件。
    for (const report of await editor.refinedFurnitureModelReports()) {
      expect(report.partCount, `${report.code} 沒有任何 mesh`).toBeGreaterThan(0);
      expect(report.instanceCount).toBe(1);
    }
  });

  test("E: 匯入模型一律等比縮放,且不超出 FURNITURE_DEFAULTS 的標稱尺寸", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    for (const [index, code] of MODEL_KINDS.entries()) {
      await placeFurnitureOnStep2(page, editor, code, CATALOG_SPOTS[index]);
    }

    await editor.goToRefined();
    await waitForRefinedReady(editor);
    await expect
      .poll(
        () => editor.refinedFurnitureModelReports().then((r) => r.length),
        { timeout: 30_000 },
      )
      .toBe(MODEL_KINDS.length);

    for (const report of await editor.refinedFurnitureModelReports()) {
      // `scale` 是**單一數字**,這本身就是「三軸同倍率」的結構性保證 ——
      // 不可能有非等比拉伸,因為根本沒有三個獨立倍率可以填。這裡再對
      // fittedM/targetM 做一次量測比對,是為了守住「縮放後真的塞得進標稱框」。
      expect(report.scale).toBeGreaterThan(0);

      const [fw, fh, fd] = report.fittedM;
      const [tw, th, td] = report.targetM;

      expect(fw, `${report.code} 寬度超出標稱尺寸`).toBeLessThanOrEqual(
        tw + UNIFORM_SCALE_EPSILON,
      );
      expect(fh, `${report.code} 高度超出標稱尺寸`).toBeLessThanOrEqual(
        th + UNIFORM_SCALE_EPSILON,
      );
      expect(fd, `${report.code} 深度超出標稱尺寸`).toBeLessThanOrEqual(
        td + UNIFORM_SCALE_EPSILON,
      );

      // 至少有一軸剛好貼齊 —— 等比縮放取的是三軸比值的最小者,所以那一軸
      // 必然恰好填滿。全都沒貼齊代表縮放倍率算小了,模型會浮在框裡縮水。
      const touching = [
        Math.abs(fw - tw),
        Math.abs(fh - th),
        Math.abs(fd - td),
      ].some((delta) => delta < 1e-3);
      expect(touching, `${report.code} 沒有任何一軸貼齊標稱尺寸`).toBe(true);
    }
  });

  test("C: 步驟 03 唯讀 — 點擊物件不進選取/搬移,只有 orbit controls", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await placeFurnitureOnStep2(page, editor, "TBL-120-75");

    await editor.goToRefined();
    await waitForRefinedReady(editor);

    expect(await editor.refinedScene.getAttribute("data-readonly")).toBe("true");
    expect(await editor.refinedScene.getAttribute("data-orbit-controls")).toBe(
      "true",
    );
    // 編輯用的側欄/工具在 03 根本不存在 —— 唯讀不是靠「點了沒反應」達成的,
    // 而是那些入口壓根沒掛上去。
    await expect(
      page.locator('[data-testid="furniture-place-TBL-120-75"]'),
    ).toHaveCount(0);
    await expect(page.locator('[data-testid="venue-sidebar"]')).toHaveCount(0);

    // 直接往場景中央點下去 —— 家具就在那裡。唯讀的話資料不能有任何變動。
    const furnitureBefore = await editor.editor.getAttribute("data-furniture");
    const canvas = editor.refinedScene.locator("canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("refined-scene canvas not visible");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(200);

    expect(await editor.selectedId()).toBe("");
    expect(await editor.editor.getAttribute("data-furniture")).toBe(
      furnitureBefore,
    );
  });

  test("D: 資源只在進入步驟 03 時載入,往返三趟不累積且快取確實被重用", async ({
    page,
  }) => {
    const glbRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().toLowerCase().includes(".glb")) glbRequests.push(req.url());
    });

    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await placeAll(page, editor);

    // 驗收條件 7 的前半原本是「步驟 02 完全不碰 GLB」。feedback round 2 的
    // R5 推翻了那條 —— 步驟 02 現在也要顯示家具輪廓,幾何就在 GLB 裡。
    // 改守真正剩下的規定:步驟 02 不烘焙步驟 03 專屬的地板/牆材質。
    expect(
      await editor.sceneSurfaceBakes(),
      "步驟 02 烘焙了步驟 03 專屬的表面材質",
    ).toBe(0);

    await editor.goToRefined();
    await waitForRefinedReady(editor);
    await expect
      .poll(() => editor.refinedFurnitureModelsLoaded(), { timeout: 30_000 })
      .toBe(true);
    await expect
      .poll(
        () => editor.refinedFurnitureModelReports().then((r) => r.length),
        { timeout: 30_000 },
      )
      .toBe(MODEL_KINDS.length);

    const afterFirst = await editor.refinedFurnitureModelStats();
    const proceduralAfterFirst = await editor.refinedProceduralFurnitureStats();
    const requestsAfterFirst = glbRequests.length;

    expect(afterFirst.cachedKinds).toBe(MODEL_KINDS.length);
    expect(afterFirst.totalBuilds).toBe(MODEL_KINDS.length);
    expect(afterFirst.liveGeometries).toBeGreaterThan(0);
    expect(requestsAfterFirst).toBeGreaterThan(0);

    for (let trip = 0; trip < 3; trip += 1) {
      // `backToPreview()`(而非 clickBackToPreview)會等步驟 02 真的可見;
      // 再等 canvas 剩一張,確認 03 的 WebGL context 已經卸掉 —— 02 與 03 是
      // 互斥掛載,不等這個就切回去會撞上兩個 context 同時存在的瞬間,
      // 探針時常來不及重新武裝(沿用 venue-refined-lighting 案例12 的寫法)。
      await editor.backToPreview();
      await expect(page.locator("canvas")).toHaveCount(1);
      expect(await editor.currentStep()).toBe("preview");
      await editor.goToRefined();
      await expect(page.locator("canvas")).toHaveCount(1);
      await waitForRefinedReady(editor);
      await expect
        .poll(() => editor.refinedFurnitureModelsLoaded(), { timeout: 30_000 })
        .toBe(true);
      await expect
        .poll(
          () => editor.refinedFurnitureModelReports().then((r) => r.length),
          { timeout: 30_000 },
        )
        .toBe(MODEL_KINDS.length);
    }

    const afterTrips = await editor.refinedFurnitureModelStats();
    const proceduralAfterTrips = await editor.refinedProceduralFurnitureStats();

    // 沒累積。
    expect(afterTrips.liveGeometries).toBe(afterFirst.liveGeometries);
    expect(afterTrips.cachedKinds).toBe(afterFirst.cachedKinds);
    expect(proceduralAfterTrips.liveGeometries).toBe(
      proceduralAfterFirst.liveGeometries,
    );
    expect(proceduralAfterTrips.liveMaterials).toBe(
      proceduralAfterFirst.liveMaterials,
    );

    // 而且是因為快取命中,不是因為根本沒再畫 —— 上面剛剛才 poll 過模型報告
    // 仍是六個,所以東西確實在畫面上。
    expect(
      afterTrips.totalBuilds,
      "往返後又重新正規化了模型 — 依 kind 快取沒有生效",
    ).toBe(afterFirst.totalBuilds);
    expect(proceduralAfterTrips.totalBuilds).toBe(
      proceduralAfterFirst.totalBuilds,
    );

    // GLB 也不該被重抓(useGLTF 的模組層快取)。
    expect(
      glbRequests.length,
      "往返後又重新下載了 GLB — useGLTF 快取沒有生效",
    ).toBe(requestsAfterFirst);
  });

  test("F: 步驟 01/02 既有行為不受影響 — 2D 編輯與白模預覽照舊", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    // 01:畫得動、選得到、刪得掉。
    await editor.wallTool();
    await editor.drawWall({ x: 20, y: 20 }, { x: 25, y: 20 });
    expect(await editor.wallCount()).toBe(1);
    await editor.columnTool();
    await editor.placeColumn({ x: 15, y: 15 });
    expect(await editor.columnCount()).toBe(1);
    await editor.selectTool();
    await editor.clickAt({ x: 15, y: 15 });
    expect(await editor.selectedType()).toBe("column");
    await editor.pressDelete();
    expect(await editor.columnCount()).toBe(0);

    // 02:白模預覽仍然生成,而且**沒有**步驟 03 的探針屬性 —— 兩者互斥掛載,
    // 03 的東西漏進 02 會在這裡現形。
    await editor.clickNextStep();
    await expect.poll(() => editor.sceneGenerated(), { timeout: 15_000 }).toBe(true);
    expect(await editor.sceneWallMeshCount()).toBe(1);
    await expect(page.locator('[data-testid="refined-scene"]')).toHaveCount(0);
  });
});
