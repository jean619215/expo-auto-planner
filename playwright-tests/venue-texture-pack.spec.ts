import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";

// 驗收閘:R6 真實貼圖包(round 2, T10)。
//
// 四款實拍貼圖(2 地板 + 2 牆面),各三張:diffuse / normal / roughness。
// 檔案由 scripts/build-venue-textures.mjs 產生,來源 Poly Haven(CC0)。

const TEXTURE_DIR = join(process.cwd(), "public", "textures", "venue");
const PACKS = [
  { id: "laminate", surface: "floor" },
  { id: "worn-concrete", surface: "floor" },
  { id: "beige-plaster", surface: "wall" },
  { id: "dirty-carpet", surface: "wall" },
];
const MAPS = ["diff", "nor", "rough"];
const MAX_BYTES = 400 * 1024;

test.describe.configure({ timeout: 120_000 });

test.describe("Real texture packs (T10)", () => {
  test("授權記錄檔存在,寫明 CC0 與 Poly Haven,且涵蓋全部四款", () => {
    const text = readFileSync(join(TEXTURE_DIR, "ATTRIBUTION.md"), "utf8");
    expect(text).toContain("CC0");
    expect(text.toLowerCase()).toContain("polyhaven");
    for (const pack of PACKS) {
      expect(text, `授權記錄缺少 ${pack.id}`).toContain(pack.id);
    }
  });

  test("每款各三張 WebP,單檔不超過上限", async ({ request, baseURL }) => {
    for (const pack of PACKS) {
      for (const map of MAPS) {
        const url = `${baseURL}/textures/venue/${pack.id}_${map}.webp`;
        const response = await request.get(url);
        expect(response.status(), `${url} 應可取得`).toBe(200);

        const body = await response.body();
        expect(
          body.byteLength,
          `${pack.id}_${map}.webp 超過 ${MAX_BYTES} bytes`,
        ).toBeLessThanOrEqual(MAX_BYTES);

        // RIFF....WEBP —— 驗容器,不是只驗副檔名。
        expect(body.subarray(0, 4).toString("ascii")).toBe("RIFF");
        expect(body.subarray(8, 12).toString("ascii")).toBe("WEBP");
      }
    }
  });

  test("選單裡出現實拍選項,套用後畫面真的改變", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.wallTool();
    await editor.drawWall({ x: 20.5, y: 21 }, { x: 22.5, y: 21 });
    await editor.clickNextStep();
    await editor.goToRefined();
    await expect
      .poll(() => editor.refinedLightingReady(), { timeout: 60_000 })
      .toBe(true);

    // 第四輪:選項是縮圖格,標籤在格子裡的文字。
    const options = await page
      .locator('[data-testid^="surface-option-floor-"]')
      .allTextContents();
    expect(options.join("|")).toContain("實拍");

    const before = (await editor.refinedMaterialDiagnostics())!;
    // 程序化那組是烘焙出來的 render target:輸出是線性資料,鋪貼尺度是
    // FLOOR_TILE_M(6m,repeat 1/6)。
    expect(before.floor!.map.colorSpace).toBe("srgb-linear");

    await editor.selectFloorSurface("laminate");

    // 實拍貼圖是從檔案載入的 sRGB 圖,鋪貼尺度 2m(repeat 1/2)。
    //
    // 刻意不用貼圖寬度來分辨:程序化地板的 render target 也是 1024 見方,
    // 寬度相同 —— 本 task 第一次破壞驗證就是被這一點騙過去的(把實拍
    // preset 的貼圖拿掉、退回程序化,五個案例全綠)。
    await expect
      .poll(
        async () =>
          (await editor.refinedMaterialDiagnostics())?.floor?.map.colorSpace,
        { timeout: 60_000 },
      )
      .toBe("srgb");
    expect(
      (await editor.refinedMaterialDiagnostics())!.floor!.map.repeatX,
    ).toBeCloseTo(0.5, 3);
  });

  test("實拍貼圖有法線與粗糙度貼圖(不是只有一張彩色圖)", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.wallTool();
    await editor.drawWall({ x: 20.5, y: 21 }, { x: 22.5, y: 21 });
    await editor.clickNextStep();
    await editor.goToRefined();
    await expect
      .poll(() => editor.refinedLightingReady(), { timeout: 60_000 })
      .toBe(true);

    await editor.selectFloorSurface("worn-concrete");

    await expect
      .poll(
        async () =>
          (await editor.refinedMaterialDiagnostics())?.floor?.normalMap.present,
        { timeout: 60_000 },
      )
      .toBe(true);
    expect(
      (await editor.refinedMaterialDiagnostics())!.floor!.roughnessMap?.present,
    ).toBe(true);
  });

  test("貼圖全部同源,沒有任何外部下載", async ({ page }) => {
    const external: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (!url.startsWith("http://localhost:3000") && !url.startsWith("blob:")) {
        external.push(url);
      }
    });

    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.wallTool();
    await editor.drawWall({ x: 20.5, y: 21 }, { x: 22.5, y: 21 });
    await editor.clickNextStep();
    await editor.goToRefined();
    await expect
      .poll(() => editor.refinedLightingReady(), { timeout: 60_000 })
      .toBe(true);
    await editor.selectFloorSurface("laminate");
    await expect
      .poll(
        async () =>
          (await editor.refinedMaterialDiagnostics())?.floor?.map.width ?? 0,
        { timeout: 60_000 },
      )
      .toBe(1024);

    expect(external, "步驟 03 有外部下載").toEqual([]);
  });
});
