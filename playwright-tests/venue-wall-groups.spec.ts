import { test, expect } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";
import { PlanSlotsPage } from "./pages/PlanSlotsPage";

// 驗收閘:第三輪 T9 —— 牆面材質從「全場共用一組」改成**逐面牆各自設定**
// (stories/venue-catalog-and-quote-draft.md 第三節,2026-08-26 定案)。
//
// 備選方案是依牆的方位分成恆定四組;使用者選了逐面牆,理由是牆本來就是任意
// 線段,不是固定四面的盒子。材質設定因此跟著 `WallSegment` 走。
//
// **每一條斷言的來源都是探針從場景圖與 GPU 讀回來的東西**,不是選單的值:
//  - `materialUuid` —— 場景裡那面牆掛著的材質物件的身分
//  - `mapUuid` —— 那份材質上貼圖物件的身分
//  - `albedoMean` —— 那張烘焙貼圖從 GPU 讀回來的平均亮度
// 讀 `data-wall-preset`(設定值的回音)會讓所有案例在實作壞掉時照樣全綠 ——
// 這正是 AGENTS.md 點名、而且第二輪真的發生過三次的空守衛。

const WOOD = "wood"; // 木紋,程序化
const DARK = "dark"; // 深色板,程序化(與木紋亮度差距明顯)
const FABRIC = "fabric"; // 布幕,程序化
const PACK = "beige-plaster"; // 米色批土牆,實拍貼圖包

/** 1×1 的透明 PNG。內容不重要 —— 要驗的是「換成了檔案貼圖」這件事。 */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * 沒有 GPU 的環境(容器走 SwiftShader 軟體算圖)掛一次步驟 03 的場景要十幾秒,
 * 而本檔多數案例要**改材質再等重新烘焙與 readback**,等於掛完之後還要再跑
 * 好幾輪。預設 30s 會在連跑時偽裝成隨機 flake(見 AGENTS.md)。
 * 實測單跑約 35–60s / 案例,連跑更久,所以整個 describe 編列 240s。
 */
test.describe.configure({ timeout: 240_000 });

async function waitForLightingReady(editor: PlanEditorPage) {
  await expect
    .poll(() => editor.refinedLightingReady(), { timeout: 60_000 })
    .toBe(true);
}

async function waitForMaterialDiagnostics(editor: PlanEditorPage) {
  await expect
    .poll(async () => (await editor.refinedMaterialDiagnostics())?.ready, {
      timeout: 60_000,
    })
    .toBe(true);
}

/** 畫 n 面牆(互不重疊),進到步驟 03。 */
async function toRefinedWithWalls(editor: PlanEditorPage, count: number) {
  await editor.navigate();
  await editor.applyCustomBoothSize(20, 20);
  for (let i = 0; i < count; i += 1) {
    await editor.wallTool();
    const y = 22 + i * 3;
    await editor.drawWall({ x: 20, y }, { x: 28, y });
  }
  expect(await editor.wallCount()).toBe(count);
  await editor.clickNextStep();
  await editor.goToRefined();
  await waitForLightingReady(editor);
  await waitForMaterialDiagnostics(editor);
}

/**
 * 等探針回報的牆面材質換過去。
 *
 * 換款式會觸發重新烘焙 + 一次整張 512² 的 readback,兩者都不是同一幀完成的
 * —— 直接讀會拿到上一次的報告。以 uuid 變了為準,而不是固定睡幾秒。
 */
async function waitForWallMaterialChange(
  editor: PlanEditorPage,
  wallId: string,
  previousUuid: string,
) {
  await expect
    .poll(
      async () => {
        const walls = await editor.refinedWallSurfaces();
        return walls.find((w) => w.wallId === wallId)?.materialUuid ?? "";
      },
      { timeout: 60_000, message: `牆 ${wallId} 的材質沒有換過去` },
    )
    .not.toBe(previousUuid);
}

async function wallReport(editor: PlanEditorPage, wallId: string) {
  const walls = await editor.refinedWallSurfaces();
  const report = walls.find((w) => w.wallId === wallId);
  expect(report, `探針沒有回報牆 ${wallId}`).toBeTruthy();
  return report!;
}

test.describe("Per-wall surface groups (T9)", () => {
  test("兩面牆可以是不同材質 —— 不再是全場共用一組", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toRefinedWithWalls(editor, 2);

    // 起點:兩面牆都沒有個別指定,所以共用同一份材質。**共用是刻意的**
    // (十面同款牆只該有一份材質),先確認這個起點成立,後面的「變得不同」
    // 才有意義。
    const idA = await editor.wallSurfaceRowId(1);
    const idB = await editor.wallSurfaceRowId(2);
    const before = await editor.refinedWallSurfaces();
    expect(before).toHaveLength(2);
    expect(before[0].materialUuid).toBe(before[1].materialUuid);

    await editor.setWallSurface(1, WOOD);
    await waitForWallMaterialChange(editor, idA, before[0].materialUuid);

    const a = await wallReport(editor, idA);
    const b = await wallReport(editor, idB);
    expect(a.materialUuid, "兩面牆仍掛著同一個材質物件").not.toBe(
      b.materialUuid,
    );
    expect(a.mapUuid).not.toBe(b.mapUuid);
    // 不只是不同物件 —— 烘出來的像素也真的不一樣。
    expect(a.albedoMean).not.toBeNull();
    expect(b.albedoMean).not.toBeNull();
    expect(Math.abs(a.albedoMean! - b.albedoMean!)).toBeGreaterThan(0.02);
  });

  test("改其中一面不影響另一面(探針讀實際材質,不是選單的回音)", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await toRefinedWithWalls(editor, 2);
    const idA = await editor.wallSurfaceRowId(1);
    const idB = await editor.wallSurfaceRowId(2);

    const initial = await editor.refinedWallSurfaces();
    await editor.setWallSurface(1, WOOD);
    await waitForWallMaterialChange(editor, idA, initial[0].materialUuid);
    await editor.setWallSurface(2, DARK);
    await waitForWallMaterialChange(editor, idB, initial[1].materialUuid);

    const beforeA = await wallReport(editor, idA);
    const beforeB = await wallReport(editor, idB);
    expect(beforeA.materialUuid).not.toBe(beforeB.materialUuid);

    // 再改第一面 —— 第二面必須原封不動(材質物件與烘出來的像素都是)。
    await editor.setWallSurface(1, FABRIC);
    await waitForWallMaterialChange(editor, idA, beforeA.materialUuid);

    const afterB = await wallReport(editor, idB);
    expect(afterB.materialUuid, "改甲牆把乙牆一起換掉了").toBe(
      beforeB.materialUuid,
    );
    expect(afterB.albedoMean).toBeCloseTo(beforeB.albedoMean!, 6);

    const afterA = await wallReport(editor, idA);
    expect(afterA.materialUuid).not.toBe(afterB.materialUuid);
  });

  test("每一面都能套用內建程序化材質與實拍貼圖包", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toRefinedWithWalls(editor, 2);
    const idA = await editor.wallSurfaceRowId(1);
    const idB = await editor.wallSurfaceRowId(2);
    const initial = await editor.refinedWallSurfaces();

    await editor.setWallSurface(1, WOOD); // 程序化
    await waitForWallMaterialChange(editor, idA, initial[0].materialUuid);
    await editor.setWallSurface(2, PACK); // 實拍貼圖包
    await waitForWallMaterialChange(editor, idB, initial[1].materialUuid);

    const a = await wallReport(editor, idA);
    const b = await wallReport(editor, idB);

    // 程序化的那面有 render target(albedoMean 讀得到);貼圖包那面的貼圖是
    // 檔案,沒有 render target —— 兩者的差別本身就是「走了不同的路徑」的證據。
    expect(a.albedoMean, "程序化的牆應該有烘焙結果可讀").not.toBeNull();
    expect(b.albedoMean, "貼圖包的牆不該有烘焙 render target").toBeNull();
    expect(a.mapUuid).not.toBe(b.mapUuid);
    expect(b.mapUuid).not.toBe("");
  });

  test("每一面都能上傳自己的圖", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toRefinedWithWalls(editor, 2);
    const idA = await editor.wallSurfaceRowId(1);
    const idB = await editor.wallSurfaceRowId(2);
    const initial = await editor.refinedWallSurfaces();

    await editor.uploadWallSurfaceImage(2, {
      name: "wall.png",
      mimeType: "image/png",
      buffer: PNG_1PX,
    });
    await waitForWallMaterialChange(editor, idB, initial[1].materialUuid);

    const a = await wallReport(editor, idA);
    const b = await wallReport(editor, idB);
    expect(b.materialUuid).not.toBe(a.materialUuid);
    expect(b.mapUuid).not.toBe(a.mapUuid);
    // 上傳的圖是檔案貼圖,不是烘出來的 —— 沒有 render target。
    expect(b.albedoMean).toBeNull();
    expect(a.albedoMean).not.toBeNull();

    // 清除之後回到與另一面相同的預設,再次共用同一份材質。
    await page.getByTestId("wall-surface-upload-clear-2").click();
    await waitForWallMaterialChange(editor, idB, b.materialUuid);
    const restored = await wallReport(editor, idB);
    expect(restored.materialUuid).toBe(
      (await wallReport(editor, idA)).materialUuid,
    );
  });

  test("分組選擇進存檔,讀檔還原", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    const slots = new PlanSlotsPage(page);

    // 存檔走 route mock(同 plan-slots.spec.ts),不打真後端也不需登入。
    // 存下來的整份 plan 原樣留著,讀檔時再吐回去 —— 那才是真的「存了什麼就
    // 讀回什麼」,自己另外手寫一份 fixture 只會驗到 fixture 寫得對不對。
    let savedPlan: {
      walls: { id: string }[];
      surfaces: {
        floor: string;
        wall: string;
        wallOverrides: Record<string, string>;
      };
    } | null = null;

    await page.route(/\/api\/plans$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          slots: [1, 2, 3].map((slot) => ({
            slot,
            occupied: savedPlan !== null && slot === 1,
            name: savedPlan !== null && slot === 1 ? "T9" : null,
            updatedAt: savedPlan !== null && slot === 1 ? "2026-08-26T00:00:00Z" : null,
          })),
        }),
      });
    });
    await page.route(/\/api\/plans\/\d$/, async (route) => {
      const method = route.request().method();
      if (method === "PUT") {
        savedPlan = (route.request().postDataJSON() as { plan: typeof savedPlan })
          .plan;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ planId: "plan-1", slot: 1 }),
        });
        return;
      }
      if (method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            planId: "plan-1",
            slot: 1,
            name: "T9",
            plan: savedPlan,
            updatedAt: "2026-08-26T00:00:00Z",
            conversation: [],
          }),
        });
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "unhandled in test" }),
      });
    });

    await toRefinedWithWalls(editor, 2);
    const idA = await editor.wallSurfaceRowId(1);
    const idB = await editor.wallSurfaceRowId(2);
    const initial = await editor.refinedWallSurfaces();
    await editor.setWallSurface(1, DARK);
    await waitForWallMaterialChange(editor, idA, initial[0].materialUuid);

    // 存檔鈕只在步驟 01 —— 材質是在步驟 03 設的,所以要走回去存。
    await editor.backToPreview();
    await editor.clickBackToEdit();
    await slots.open();
    await slots.saveToSlot(1, "T9");
    await expect.poll(() => savedPlan !== null).toBe(true);
    expect(savedPlan!.surfaces.wallOverrides[idA]).toBe(DARK);
    expect(savedPlan!.surfaces.wallOverrides[idB]).toBeUndefined();

    // 把設定改掉再讀檔,才知道是「讀回來的」而不是「本來就在畫面上」。
    await editor.goToRefined();
    await editor.setWallSurface(1, FABRIC);
    await editor.backToPreview();
    await editor.clickBackToEdit();

    await slots.open();
    await slots.loadSlot(1);
    await slots.confirmLoad();

    await expect
      .poll(async () => {
        const raw = await editor.editor.getAttribute("data-plan-surfaces");
        return JSON.parse(raw ?? "{}").wallOverrides?.[idA] ?? "";
      })
      .toBe(DARK);

    // 光是狀態對還不夠 —— 回到步驟 03 確認場景真的照著讀回來的設定掛材質。
    await editor.clickNextStep();
    await editor.goToRefined();
    await waitForLightingReady(editor);
    await waitForMaterialDiagnostics(editor);
    const restored = await editor.refinedWallSurfaces();
    expect(restored).toHaveLength(2);
    const a = restored.find((w) => w.wallId === idA)!;
    const b = restored.find((w) => w.wallId === idB)!;
    expect(a.materialUuid).not.toBe(b.materialUuid);
  });

  test("沒有牆時不崩潰,也不出現空的分組清單", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.clickNextStep();
    await editor.goToRefined();
    await waitForLightingReady(editor);
    await waitForMaterialDiagnostics(editor);

    // 一面牆都沒有 —— 清單整段不渲染,而不是渲染一個空框。空選單會讓人以為
    // 功能壞了,而不是「還沒畫牆」。
    expect(await editor.wallSurfaceRowCount()).toBe(0);
    await expect(page.getByTestId("wall-surface-list")).toHaveCount(0);
    // 場景本身照常:預設牆面的選單仍在,地板材質也照樣烘好。
    await expect(page.getByTestId("surface-wall-select")).toBeVisible();
    expect((await editor.refinedWallSurfaces()).length).toBe(0);
    expect(await editor.refinedMaterialsReady()).toBe(true);
  });

  test("柱子跟隨預設牆面 —— 改個別牆不動柱子,改預設才動", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.applyCustomBoothSize(20, 20);
    await editor.wallTool();
    await editor.drawWall({ x: 20, y: 22 }, { x: 28, y: 22 });
    await editor.columnTool();
    await editor.placeColumn({ x: 24, y: 26 });
    await editor.clickNextStep();
    await editor.goToRefined();
    await waitForLightingReady(editor);
    await waitForMaterialDiagnostics(editor);

    const wallId = await editor.wallSurfaceRowId(1);
    const before = await editor.refinedMaterialDiagnostics();
    const columnBefore = before.columnAlbedo!.mean;

    // 改個別牆:柱子沒有「所屬牆」,不該跟著動。
    await editor.setWallSurface(1, DARK);
    await waitForWallMaterialChange(
      editor,
      wallId,
      before.walls[0].materialUuid,
    );
    const afterOverride = await editor.refinedMaterialDiagnostics();
    expect(afterOverride.columnAlbedo!.mean).toBeCloseTo(columnBefore, 6);

    // 改預設牆面:柱子跟著換(第二輪決議「柱子不給獨立選項」仍然成立)。
    await page.getByTestId("surface-wall-select").selectOption(DARK);
    await expect
      .poll(
        async () =>
          (await editor.refinedMaterialDiagnostics()).columnAlbedo?.mean ?? 0,
        { timeout: 60_000 },
      )
      .not.toBeCloseTo(columnBefore, 3);
  });

  test("同款式的多面牆共用一份材質(不是每面各烘一份)", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toRefinedWithWalls(editor, 3);
    const idA = await editor.wallSurfaceRowId(1);
    const idB = await editor.wallSurfaceRowId(2);
    const idC = await editor.wallSurfaceRowId(3);
    const initial = await editor.refinedWallSurfaces();

    await editor.setWallSurface(1, WOOD);
    await waitForWallMaterialChange(editor, idA, initial[0].materialUuid);
    await editor.setWallSurface(2, WOOD);
    await waitForWallMaterialChange(editor, idB, initial[1].materialUuid);

    const a = await wallReport(editor, idA);
    const b = await wallReport(editor, idB);
    const c = await wallReport(editor, idC);
    // 兩面木紋牆共用同一個材質物件 —— 十面木紋牆不該烘十份。
    expect(a.materialUuid).toBe(b.materialUuid);
    // 而沒設定的第三面仍是預設,與那兩面不同。
    expect(c.materialUuid).not.toBe(a.materialUuid);
  });
});
