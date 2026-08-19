import { test, expect } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";

// 驗收閘:R6 上傳材質預覽(round 2, T9)。
//
// 只在瀏覽器裡預覽:blob URL、不進存檔、不碰後端、重整就沒了。上傳的只有
// 一張彩色圖,所以刻意關掉凹凸 —— 用亮度硬推 normal 會產生與圖案對不上的
// 假陰影,寧可平一點。

/** 一張 4x4 的純色 PNG(紅)。 */
const RED_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFklEQVQIW2P8z8Dwn4EIwDiqkL4hBQCxTQMDlLnxjwAAAABJRU5ErkJggg==",
  "base64",
);

async function toRefined(editor: PlanEditorPage) {
  await editor.navigate();
  await editor.wallTool();
  await editor.drawWall({ x: 20.5, y: 21 }, { x: 22.5, y: 21 });
  await editor.clickNextStep();
  await editor.goToRefined();
  await expect
    .poll(() => editor.refinedLightingReady(), { timeout: 30_000 })
    .toBe(true);
}

test.describe("Step 03 surface upload (T9)", () => {
  // 進步驟 03 要等打光與模型就緒,再加上兩次材質輪詢,預設 30 秒不夠 ——
  // 逾時會偽裝成「斷言失敗」,誤導排查方向。
  test.describe.configure({ timeout: 120_000 });

  test("上傳 PNG 之後,地板材質來源標記為 upload", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toRefined(editor);

    await editor.uploadSurfaceImage("floor", "floor.png", RED_PNG);

    await expect
      .poll(async () => await editor.refinedSurfaceFloorSource(), {
        timeout: 30_000,
      })
      .toBe("upload");
  });

  test("上傳的材質不掛法線貼圖(關掉凹凸感)", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toRefined(editor);

    // 上傳前:內建材質是有法線貼圖的,這是對照組 —— 少了它,「上傳後沒有
    // 法線貼圖」有可能只是因為場上根本沒量到材質。
    await expect
      .poll(
        async () =>
          (await editor.refinedMaterialDiagnostics())?.floor?.normalMap.present,
        { timeout: 30_000 },
      )
      .toBe(true);

    await editor.uploadSurfaceImage("floor", "floor.png", RED_PNG);

    await expect
      .poll(
        async () =>
          (await editor.refinedMaterialDiagnostics())?.floor?.normalMap.present,
        { timeout: 30_000 },
      )
      .toBe(false);
  });

  test("上傳非圖片檔被拒絕,材質不變", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toRefined(editor);

    await editor.uploadSurfaceImage(
      "floor",
      "notes.txt",
      Buffer.from("not an image"),
      "text/plain",
    );

    await expect(page.getByTestId("surface-upload-error")).toBeVisible();
    expect(await editor.refinedSurfaceFloorSource()).toBe("preset");
  });

  test("超過 8MB 的圖片被拒絕", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toRefined(editor);

    await editor.uploadSurfaceImage(
      "floor",
      "huge.png",
      Buffer.alloc(9 * 1024 * 1024, 1),
    );

    await expect(page.getByTestId("surface-upload-error")).toBeVisible();
    expect(await editor.refinedSurfaceFloorSource()).toBe("preset");
  });

  test("上傳過程不打任何後端 API", async ({ page }) => {
    const apiCalls: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/")) apiCalls.push(req.url());
    });

    const editor = new PlanEditorPage(page);
    await toRefined(editor);
    apiCalls.length = 0;

    await editor.uploadSurfaceImage("floor", "floor.png", RED_PNG);
    await expect
      .poll(async () => await editor.refinedSurfaceFloorSource(), {
        timeout: 30_000,
      })
      .toBe("upload");

    expect(apiCalls, "上傳材質不應該碰後端").toEqual([]);
  });

  test("重整之後回到預設材質(刻意不持久)", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toRefined(editor);
    await editor.uploadSurfaceImage("floor", "floor.png", RED_PNG);
    await expect
      .poll(async () => await editor.refinedSurfaceFloorSource(), {
        timeout: 30_000,
      })
      .toBe("upload");

    await page.reload();
    await toRefined(editor);

    expect(await editor.refinedSurfaceFloorSource()).toBe("preset");
  });

  test("清除上傳之後回到選單選的材質", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toRefined(editor);
    await editor.uploadSurfaceImage("floor", "floor.png", RED_PNG);
    await expect
      .poll(async () => await editor.refinedSurfaceFloorSource(), {
        timeout: 30_000,
      })
      .toBe("upload");

    await page.getByTestId("surface-floor-upload-clear").click();

    await expect
      .poll(async () => await editor.refinedSurfaceFloorSource(), {
        timeout: 30_000,
      })
      .toBe("preset");
  });
});
