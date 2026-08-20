import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";

// 驗收閘:R3 牆高可調(stories/venue-feedback-round2-draft.md T1)。
//
// 牆高原本是 VenueScene.tsx 與 RefinedScene.tsx 各自硬編的 `WALL_HEIGHT_M = 3`
// —— 兩份字面量,沒有任何東西保證它們一致。這裡的檢查分兩類:
//
//   * 「設定值有沒有傳到」:讀 data-wall-height-m。
//   * 「幾何有沒有真的變」:讀 data-wall-mesh-height-m / data-column-mesh-height-m,
//     那是場景內探針量 mesh 世界包圍盒得到的**實際**高度,不是把 prop 印回畫面。
//     只驗前者的話,把 boxGeometry 的高度寫死成 3 也照樣會通過。
//
// WebGL canvas 對 Playwright 不透明,所以一律走 data-* 屬性(與既有
// venue-3d-scene / venue-refined-* 各支相同做法)。

test.describe("Venue wall height (R3)", () => {
  test("預設牆高為 4m,且實際幾何就是 4m", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });
    await editor.clickNextStep();

    expect(await editor.wallHeightM()).toBe(4);
    // 探針是逐幀回報的,首次讀取時可能還沒量到 —— 一律用輪詢等它出現。
    await expect
      .poll(async () => await editor.sceneWallMeshHeightM())
      .toBeCloseTo(4, 2);
  });

  test("調到 6m 後,牆的實際幾何高度變成 6m", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });
    await editor.clickNextStep();

    await editor.setWallHeight(6);

    expect(await editor.wallHeightM()).toBe(6);
    await expect
      .poll(async () => await editor.sceneWallMeshHeightM())
      .toBeCloseTo(6, 2);
  });

  test("柱子高度跟著牆高走(兩者共用同一個值)", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.columnTool();
    await editor.placeColumn({ x: 8, y: 8 });
    await editor.clickNextStep();

    await expect
      .poll(async () => await editor.sceneColumnMeshHeightM())
      .toBeCloseTo(4, 2);

    await editor.setWallHeight(7);

    await expect
      .poll(async () => await editor.sceneColumnMeshHeightM())
      .toBeCloseTo(7, 2);
  });

  test("步驟 03 讀到與步驟 02 相同的牆高", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });
    await editor.clickNextStep();

    await editor.setWallHeight(5);
    const inPreview = await editor.wallHeightM();

    await editor.goToRefined();

    expect(await editor.refinedWallHeightM()).toBe(inPreview);
    expect(await editor.refinedWallHeightM()).toBe(5);

    // 設定值一致還不夠 —— 步驟 03 的幾何也必須真的是 5m。少了這一段,
    // 把 RefinedScene 的牆高寫死成 3 也會全綠(這正是本 task 第一次
    // 破壞驗證抓到的事)。
    await expect
      .poll(async () => await editor.refinedWallMeshHeightM())
      .toBeCloseTo(5, 2);
  });

  test("步驟 03 的柱子幾何高度同樣跟著設定值", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.columnTool();
    await editor.placeColumn({ x: 8, y: 8 });
    await editor.clickNextStep();

    await editor.setWallHeight(8);
    await editor.goToRefined();

    await expect
      .poll(async () => await editor.refinedColumnMeshHeightM())
      .toBeCloseTo(8, 2);
  });

  test("超出 2–10m 範圍的輸入被夾制", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });
    await editor.clickNextStep();

    await editor.setWallHeight(99);
    expect(await editor.wallHeightM()).toBe(10);

    await editor.setWallHeight(0.5);
    expect(await editor.wallHeightM()).toBe(2);
  });

  test("牆高常數只住在 src/lib/venue/,元件裡沒有第二份字面量", () => {
    const dir = join(process.cwd(), "src", "components", "venue");
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
      .filter((f) =>
        /(?:const|let|var)\s+WALL_HEIGHT_M\s*=/.test(
          readFileSync(join(dir, f), "utf8"),
        ),
      );

    expect(
      offenders,
      "牆高被重新宣告在元件裡 —— 它必須來自 src/lib/venue/plan.ts",
    ).toEqual([]);
  });
});
