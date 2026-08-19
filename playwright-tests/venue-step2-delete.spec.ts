import { test, expect, type Page } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";

// 驗收閘:R4 步驟 02 刪除物件(stories/venue-feedback-round2-draft.md T2)。
//
// 回饋:「預覽 3D 場景的時候,家具沒有地方刪除」。步驟 02 原本可以放置、
// 移動、旋轉,唯獨不能刪 —— 刪除鈕與 Delete 鍵處理都只掛在步驟 01。
//
// 刪除範圍比照步驟 01 的 deleteSelectedObject():選到什麼刪什麼(牆/柱/
// 家具),而不是只有家具。理由是選取機制本來就三種都支援,只讓家具可刪
// 會變成「選得到卻刪不掉」的怪行為。

/** 步驟 02 的 canvas 中心點(螢幕座標)。 */
async function canvasCenter(page: Page) {
  const canvas = page.locator('[data-testid="venue-scene"] canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error("venue-scene canvas not visible");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * 點擊地板以觸發 R3F 的 raycast onClick。裸的 page.mouse.click() 會在
 * OrbitControls 第一輪 update 把相機 lookAt(target) 安定下來之前就送出,
 * 有機率打不到地板 mesh —— move 與 down/up 之間留一點時間就穩定。
 * (同 ai-panel-persistent.spec.ts 的既有做法。)
 */
async function clickFloor(page: Page, point: { x: number; y: number }) {
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.waitForTimeout(50);
  await page.mouse.up();
}

/** 進到步驟 02 並在畫面中央放一件桌子。放置後該件會自動被選取。 */
async function placeTableInPreview(page: Page, editor: PlanEditorPage) {
  await editor.navigate();
  await editor.clickNextStep();
  await expect(editor.stepPreview).toBeVisible();

  await page.getByTestId("furniture-place-table").click();

  // 重試三次:clickFloor 的時序問題偶爾會讓第一次點擊打不到地板 mesh
  // (見上面的註解)。這裡不是在容忍缺陷 —— 放置成功與否仍然要被斷言,
  // 只是不讓「放置這個前置動作」的既有不穩定污染刪除功能的驗收結果。
  const center = await canvasCenter(page);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await editor.scene.getAttribute("data-furniture-mesh-count")) === "1") {
      break;
    }
    await clickFloor(page, center);
    await page.waitForTimeout(150);
  }
  await expect(editor.scene).toHaveAttribute("data-furniture-mesh-count", "1");
  expect(await editor.sceneSelectedType()).toBe("furniture");
}

test.describe("Venue step 02 delete (R4)", () => {
  test("選取家具後按刪除鈕,該件消失", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await placeTableInPreview(page, editor);

    await editor.clickSceneDelete();

    await expect(editor.scene).toHaveAttribute(
      "data-furniture-mesh-count",
      "0",
    );
    expect(await editor.sceneSelectedType()).toBe("");
  });

  test("選取家具後按 Delete 鍵,該件消失", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await placeTableInPreview(page, editor);

    await page.keyboard.press("Delete");

    await expect(editor.scene).toHaveAttribute(
      "data-furniture-mesh-count",
      "0",
    );
  });

  test("Backspace 同樣可刪(與步驟 01 一致)", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await placeTableInPreview(page, editor);

    await page.keyboard.press("Backspace");

    await expect(editor.scene).toHaveAttribute(
      "data-furniture-mesh-count",
      "0",
    );
  });

  test("未選取任何物件時,刪除鈕不可按、Delete 鍵沒有作用", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.columnTool();
    await editor.placeColumn({ x: 8, y: 8 });
    await editor.clickNextStep();
    await expect(editor.stepPreview).toBeVisible();

    expect(await editor.sceneSelectedType()).toBe("");
    await expect(editor.sceneDeleteButton).toBeDisabled();

    await page.keyboard.press("Delete");

    await expect(editor.scene).toHaveAttribute("data-column-mesh-count", "1");
  });

  test("在牆高輸入框裡按 Backspace 只是編輯數字,不會刪掉場上的家具", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await placeTableInPreview(page, editor);

    const input = page.locator('[data-testid="wall-height-input"]');
    await input.click();
    await page.keyboard.press("Backspace");

    await expect(editor.scene).toHaveAttribute(
      "data-furniture-mesh-count",
      "1",
    );
  });

  test("步驟 02 刪掉的家具,回到步驟 01 也確實不在", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await placeTableInPreview(page, editor);

    await editor.clickSceneDelete();
    await editor.clickBackToEdit();

    expect(await editor.furnitureCount()).toBe(0);
  });

  test("從步驟 01 帶著選取進入步驟 02 時,選取被清空(防誤刪)", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.columnTool();
    await editor.placeColumn({ x: 8, y: 8 });
    expect(await editor.selectedType()).toBe("column");

    await editor.clickNextStep();

    expect(await editor.selectedType()).toBe("");
    expect(await editor.sceneSelectedType()).toBe("");
  });
});
