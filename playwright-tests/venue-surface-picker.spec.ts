import { test, expect } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";

// 驗收閘:R6 步驟 03 地板/牆面材質選擇(round 2, T8)。
//
// 選項是既有程序化烘焙的參數化(底色 + 粗糙度),不是外部貼圖包。
// 「有沒有真的重烘」用 totalSurfaceBakes 驗,那是烘焙函式自己的計數,
// 不是 UI 的回音。

async function toRefined(editor: PlanEditorPage) {
  await editor.navigate();
  await editor.wallTool();
  await editor.drawWall({ x: 20.5, y: 21 }, { x: 22.5, y: 21 });
  // 柱子是必要的:柱子材質的診斷只在場上真的有柱子時才量得到。
  await editor.columnTool();
  await editor.placeColumn({ x: 21.5, y: 22 });
  await editor.clickNextStep();
  await editor.goToRefined();
  await expect
    .poll(() => editor.refinedLightingReady(), { timeout: 30_000 })
    .toBe(true);
}

test.describe("Step 03 surface picker (T8)", () => {
  test("地板與牆面各有一組選單,選項都不少於 3 個", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toRefined(editor);

    // 第四輪把下拉選單換成縮圖選擇器,所以數的是縮圖格而不是 <option>。
    expect(await editor.surfaceOptionCount("floor")).toBeGreaterThanOrEqual(3);
    expect(await editor.surfaceOptionCount("wall")).toBeGreaterThanOrEqual(3);
  });

  test("換地板材質會真的重新烘焙", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toRefined(editor);

    const beforeReport = (await editor.refinedMaterialDiagnostics())!;
    const before = Number(beforeReport.totalSurfaceBakes);
    const beforeMean = beforeReport.floorAlbedo!.mean;

    await editor.selectFloorSurface("wood");

    await expect
      .poll(async () => (await editor.refinedMaterialDiagnostics())!.totalSurfaceBakes, {
        timeout: 30_000,
      })
      .toBe(before + 1);
    expect(await editor.refinedSurfaceFloor()).toBe("wood");

    // 有重烘還不夠 —— 烘出來的東西必須真的不一樣。少了這一段,把底色與
    // 粗糙度寫死照樣全綠(這正是本 task 破壞驗證抓到的事):選單換了、
    // 重烘了、畫面卻沒變。木地板明顯比水泥暗,平均亮度必然下降。
    await expect
      .poll(
        async () =>
          (await editor.refinedMaterialDiagnostics())!.floorAlbedo?.mean ??
          beforeMean,
        { timeout: 30_000 },
      )
      .toBeLessThan(beforeMean * 0.9);
  });

  test("切回原本的材質不重烘(同一次造訪內有快取)", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toRefined(editor);

    const original = await editor.refinedSurfaceFloor();
    await editor.selectFloorSurface("wood");
    await expect
      .poll(async () => (await editor.refinedMaterialDiagnostics())!.totalSurfaceBakes, {
        timeout: 30_000,
      })
      .toBeGreaterThan(1);
    const afterSwitch = (await editor.refinedMaterialDiagnostics())!.totalSurfaceBakes;

    await editor.selectFloorSurface(original);
    await expect
      .poll(async () => await editor.refinedSurfaceFloor(), { timeout: 30_000 })
      .toBe(original);

    expect(
      (await editor.refinedMaterialDiagnostics())!.totalSurfaceBakes,
      "切回已烘過的材質又重烘了一次 — 快取沒有生效",
    ).toBe(afterSwitch);
  });

  test("換牆面材質後,柱子材質也跟著換(柱子跟隨牆面)", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toRefined(editor);

    const before = (await editor.refinedMaterialDiagnostics())!;
    const beforeColumnMean = before.columnAlbedo!.mean;

    await editor.selectWallSurface("dark");
    await expect
      .poll(async () => await editor.refinedSurfaceWall(), { timeout: 30_000 })
      .toBe("dark");

    // 讀的是烘焙出來的像素平均,不是貼圖參數描述 —— 換底色不會改變寬高/
    // wrap/filter,只會改變內容。深色板明顯比白牌漆面暗,所以平均必然下降。
    await expect
      .poll(
        async () =>
          (await editor.refinedMaterialDiagnostics())!.columnAlbedo?.mean ??
          beforeColumnMean,
        { timeout: 30_000 },
      )
      .toBeLessThan(beforeColumnMean * 0.9);
  });

  test("材質選擇會存進存檔快照", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toRefined(editor);

    await editor.selectFloorSurface("carpet");
    await expect
      .poll(async () => await editor.refinedSurfaceFloor(), { timeout: 30_000 })
      .toBe("carpet");

    // 存檔快照是 dirty 判定的依據 —— 材質換了就應該被視為有變更。
    //
    // `wallOverrides` 是第三輪 T9 加的(逐面牆各自貼圖)。這裡刻意仍然用
    // `toEqual` 比整個物件而不是只挑欄位:快照的形狀本來就是這一項要守的東西,
    // 多一個沒人預期的欄位應該讓它紅,而不是安靜通過。沒有任何個別設定時它是
    // 空物件 —— 不是 undefined,那個差別會讓讀舊檔的 Object.entries 丟例外。
    expect(await editor.planSnapshotSurfaces()).toEqual({
      floor: "carpet",
      wall: "painted",
      wallOverrides: {},
    });
  });

  test("步驟 02 不受影響:仍然不烘焙任何表面材質", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toRefined(editor);
    await editor.selectFloorSurface("stone");

    await editor.backToPreview();

    expect(await editor.sceneSurfaceBakes()).toBe(0);
  });
});
