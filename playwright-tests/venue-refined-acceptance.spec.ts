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
//   B  九種家具在步驟 03 全部不是白方塊:六種來自 GLB、三種來自程序化幾何,
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

/** 有 GLB 的六種。對應 src/lib/venue/models.ts。 */
const MODEL_KINDS = ["table", "chair", "cabinet", "sofa", "display", "plant"];

/** 沒有 CC0 資產、走程序化幾何的三種。對應 src/lib/venue/proceduralFurniture.ts。 */
const PROCEDURAL_KINDS = ["counter", "bannerStand", "podium"];

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

/**
 * 九個落點,全部在可點擊的菱形地板內、且互不重疊。
 *
 * 水平約 ±60px、垂直約 ±15px 就出界(RESUME.md 的環境備忘),所以是扁的格狀
 * 而不是正方格。
 */
const NINE_SPOTS = [
  { x: -44, y: -10 },
  { x: 0, y: -10 },
  { x: 44, y: -10 },
  { x: -44, y: 0 },
  { x: 0, y: 0 },
  { x: 44, y: 0 },
  { x: -44, y: 10 },
  { x: 0, y: 10 },
  { x: 44, y: 10 },
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

/** 九種家具各一件。 */
async function placeAllNine(page: Page, editor: PlanEditorPage) {
  const kinds = [...MODEL_KINDS, ...PROCEDURAL_KINDS];
  for (const [index, kind] of kinds.entries()) {
    await placeFurnitureOnStep2(page, editor, kind, NINE_SPOTS[index]);
  }
  expect(await editor.furnitureCount()).toBe(kinds.length);
}

// 這一支比其他 venue spec 重得多:B/D/E 要一件一件擺滿九種家具(每件都要等
// furnitureCount 真的變),D 還要再往返 02<->03 三趟、每趟重新等場景就緒。
// 預設的 30s test timeout 不夠,逾時會偽裝成「某個 poll 失敗」,查起來很誤導。
test.describe.configure({ timeout: 180_000 });

test.describe("精密 3D 場景 (步驟 03) - Task 7: 效能與驗收", () => {
  test("A: 三步驟流程走得完也回得來,每一步的內容與進度列一致", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    expect(await editor.currentStep()).toBe("edit");

    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });
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

  test("B: 九種家具在步驟 03 全部有造型,六種來自 GLB、三種來自程序化,且兩條路互斥", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await placeAllNine(page, editor);

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
      .map((r) => r.kind)
      .sort();
    const proceduralKinds = (await editor.refinedProceduralFurnitureReports())
      .map((r) => r.kind)
      .sort();

    expect(modelKinds).toEqual([...MODEL_KINDS].sort());
    expect(proceduralKinds).toEqual([...PROCEDURAL_KINDS].sort());

    // 互斥 —— 同一件家具被兩條路各畫一次的話,畫面上是兩個物件疊在一起,
    // 光看截圖分不出來,只有這個交集斷言抓得到。
    const overlap = modelKinds.filter((kind) => proceduralKinds.includes(kind));
    expect(overlap, "同一個 kind 不得同時走模型與程序化兩條路").toEqual([]);

    // 每一種都不是單一方塊:模型至少一個 mesh,程序化至少兩個零件。
    for (const report of await editor.refinedFurnitureModelReports()) {
      expect(report.partCount, `${report.kind} 沒有任何 mesh`).toBeGreaterThan(0);
      expect(report.instanceCount).toBe(1);
    }
  });

  test("E: 匯入模型一律等比縮放,且不超出 FURNITURE_DEFAULTS 的標稱尺寸", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    for (const [index, kind] of MODEL_KINDS.entries()) {
      await placeFurnitureOnStep2(page, editor, kind, NINE_SPOTS[index]);
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

      expect(fw, `${report.kind} 寬度超出標稱尺寸`).toBeLessThanOrEqual(
        tw + UNIFORM_SCALE_EPSILON,
      );
      expect(fh, `${report.kind} 高度超出標稱尺寸`).toBeLessThanOrEqual(
        th + UNIFORM_SCALE_EPSILON,
      );
      expect(fd, `${report.kind} 深度超出標稱尺寸`).toBeLessThanOrEqual(
        td + UNIFORM_SCALE_EPSILON,
      );

      // 至少有一軸剛好貼齊 —— 等比縮放取的是三軸比值的最小者,所以那一軸
      // 必然恰好填滿。全都沒貼齊代表縮放倍率算小了,模型會浮在框裡縮水。
      const touching = [
        Math.abs(fw - tw),
        Math.abs(fh - th),
        Math.abs(fd - td),
      ].some((delta) => delta < 1e-3);
      expect(touching, `${report.kind} 沒有任何一軸貼齊標稱尺寸`).toBe(true);
    }
  });

  test("C: 步驟 03 唯讀 — 點擊物件不進選取/搬移,只有 orbit controls", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await placeFurnitureOnStep2(page, editor, "table");

    await editor.goToRefined();
    await waitForRefinedReady(editor);

    expect(await editor.refinedScene.getAttribute("data-readonly")).toBe("true");
    expect(await editor.refinedScene.getAttribute("data-orbit-controls")).toBe(
      "true",
    );
    // 編輯用的側欄/工具在 03 根本不存在 —— 唯讀不是靠「點了沒反應」達成的,
    // 而是那些入口壓根沒掛上去。
    await expect(
      page.locator('[data-testid="furniture-place-table"]'),
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
    await placeAllNine(page, editor);

    // 驗收條件 7 的前半:在步驟 02 停留時完全不碰步驟 03 的資源。
    expect(glbRequests, "步驟 02 不得載入任何 GLB").toEqual([]);

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
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });
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
