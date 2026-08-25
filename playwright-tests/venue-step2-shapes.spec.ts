import { test, expect, type Page } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";

// 驗收閘:R5 步驟 02 家具顯示模型輪廓(round 2, T7)。
//
// 回饋:「家具也應該看得當模型的形狀(不需要貼圖),而不是現在的方塊」。
//
// 「不是方塊」用三角面數驗:單一 box 是 12 個三角面,任何真實模型都遠多於
// 這個數。「沒有貼圖」用材質驗,不用網路請求驗 —— 貼圖是嵌在 GLB 裡的,
// 不會有獨立的 .webp 請求,拿網路來驗等於什麼都沒驗。

async function toStep2WithRoom(editor: PlanEditorPage) {
  await editor.navigate();
  // 像素偏移需要固定的相機取景距離(見 venue-furniture-models.spec.ts)。
  await editor.applyCustomBoothSize(50, 50);
  await editor.clickNextStep();
}

async function place(
  page: Page,
  editor: PlanEditorPage,
  code: string,
  offsetPx: { x: number; y: number } = { x: 0, y: 0 },
) {
  const before = await editor.furnitureCount();
  await page.getByTestId(`furniture-place-${code}`).click();
  const canvas = page.locator('[data-testid="venue-scene"] canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error("venue-scene canvas not visible");
  const point = {
    x: box.x + box.width / 2 + offsetPx.x,
    y: box.y + box.height / 2 + offsetPx.y,
  };
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.waitForTimeout(50);
  await page.mouse.up();
  await expect
    .poll(() => editor.furnitureCount(), {
      timeout: 5_000,
      message: `${code} 沒有放上去 — 偏移可能點在地板之外`,
    })
    .toBe(before + 1);
}

test.describe("Step 02 furniture silhouettes (T7)", () => {
  test("有 GLB 的家具不再是方塊(三角面數遠多於 12)", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toStep2WithRoom(editor);

    await place(page, editor, "TBL-120-75");

    // GLB 是非同步解碼的,探針要等它進場景圖才量得到。
    await expect
      .poll(
        async () =>
          (await editor.sceneFurnitureShapes()).find((s) => s.code === "TBL-120-75")
            ?.triangles ?? 0,
        { timeout: 30_000 },
      )
      .toBeGreaterThan(12);
  });

  test("家具材質沒有貼圖也沒有法線貼圖", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toStep2WithRoom(editor);

    await place(page, editor, "TBL-120-75");
    await place(page, editor, "CHR-45-90", { x: 40, y: 0 });

    await expect
      .poll(async () => (await editor.sceneFurnitureShapes()).length, {
        timeout: 30_000,
      })
      .toBe(2);
    const shapes = await editor.sceneFurnitureShapes();
    for (const shape of shapes) {
      expect(shape.hasMap, `${shape.code} 掛了貼圖`).toBe(false);
      expect(shape.hasNormalMap, `${shape.code} 掛了法線貼圖`).toBe(false);
    }
  });

  test("步驟 03 專屬的地板/牆程序化材質在步驟 02 完全沒有被烘焙", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await toStep2WithRoom(editor);

    await place(page, editor, "TBL-120-75");

    expect(await editor.sceneSurfaceBakes()).toBe(0);
  });

  test("程序化家具(接待櫃檯)在步驟 02 也有造型,不是方塊", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await toStep2WithRoom(editor);

    await place(page, editor, "CNT-100-110");

    await expect
      .poll(
        async () =>
          (await editor.sceneFurnitureShapes()).some(
            (s) => s.code === "CNT-100-110",
          ),
        { timeout: 30_000 },
      )
      .toBe(true);
    const counter = (await editor.sceneFurnitureShapes()).find(
      (s) => s.code === "CNT-100-110",
    );
    expect(counter).toBeTruthy();
    expect(counter!.triangles).toBeGreaterThan(12);
    expect(counter!.partCount).toBeGreaterThan(1);
  });

  test("步驟 02 的家具仍可選取與刪除(外型換了但互動沒壞)", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await toStep2WithRoom(editor);

    await place(page, editor, "TBL-120-75");
    expect(await editor.sceneSelectedType()).toBe("furniture");

    await editor.clickSceneDelete();
    await expect(editor.scene).toHaveAttribute(
      "data-furniture-mesh-count",
      "0",
    );
  });

  test("往返步驟 03 後,模型快取沒有重複建置(02 與 03 共用同一份幾何)", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await toStep2WithRoom(editor);

    // T5 之後桌子走程序化 —— 這一項守的是**模型**快取,必須放仍是 GLB 的品項。
    await place(page, editor, "CHR-45-90");

    await editor.goToRefined();
    await expect
      .poll(async () => (await editor.refinedFurnitureModelStats())?.cachedKinds ?? 0, {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    const afterFirst = await editor.refinedFurnitureModelStats();

    await editor.backToPreview();
    await editor.goToRefined();
    await expect
      .poll(async () => (await editor.refinedFurnitureModelStats())?.cachedKinds ?? 0, {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    const afterTrip = await editor.refinedFurnitureModelStats();

    expect(
      afterTrip.totalBuilds,
      "往返後又重新正規化了模型 — 步驟 02 與 03 沒有共用同一份快取",
    ).toBe(afterFirst.totalBuilds);
  });
});
