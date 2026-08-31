import { test, expect } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";

// Playwright acceptance gate for 場地白模產生器 (階段一) Task 2:
// 物件系統 — 牆壁線段工具與柱子矩形工具, 含選取/移動/刪除.
// Covers the acceptance criteria in .claude/pipeline/orchestrator-output.md
// (Task 2 spec). The canvas has no per-shape DOM, so every scenario reads
// state from the plan-editor wrapper's data-* attributes (see
// PlanEditorPage) rather than querying canvas internals directly.
//
// 第三輪 T1 之後,可編輯範圍不再是固定的 0 起算 200m 平面,而是「攤位 + 5m
// 邊距」。本檔原本的座標整體平移了 +15m(可編輯範圍的左上緣),吸附/夾制/
// 選取這些相對行為與原本完全一致 —— 換的只是這些案例站在哪一塊地上。

function snapToGrid(v: number): number {
  return Math.round(v / 0.5) * 0.5;
}

// 可編輯範圍 = 攤位 + 5m 邊距。攤位錨在 (20,20),所以預設 3×3 攤位的範圍是
// [15,28];下面多數案例會先開一塊 40×40 的攤位,範圍變成 [15,65]。
const AREA_MIN_M = 15;
const HALF_COLUMN_M = 0.25;

function clampColumnCenter(v: number, areaMax = 65): number {
  return Math.min(
    areaMax - HALF_COLUMN_M,
    Math.max(AREA_MIN_M + HALF_COLUMN_M, snapToGrid(v)),
  );
}

/**
 * 本檔案例一律用**預設 3×3 攤位**,可編輯範圍 [15,28],座標也都落在裡面。
 *
 * 不要為了「有地方施展」而先開一塊大攤位:換攤位尺寸會觸發 `fitViewTo`,
 * 視圖縮到攤位上,反而讓 15~20 這一帶跑出畫布外,點不到。預設視圖看得到
 * 0~50m,整個 [15,28] 都在畫面裡。
 */
async function openRoom(editor: PlanEditorPage) {
  await editor.navigate();
}

test.describe("Venue Plan Editor - Task 2 object system", () => {
  test("default mode is 選取 on load", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    expect(await editor.mode()).toBe("select");
  });

  test("wall mode: draw A->B creates a snapped wall, auto-selects it, returns to 選取", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await openRoom(editor);

    await editor.wallTool();
    expect(await editor.mode()).toBe("wall");

    await editor.drawWall({ x: 20.2, y: 20.3 }, { x: 25.1, y: 20.4 });

    expect(await editor.wallCount()).toBe(1);
    expect(await editor.mode()).toBe("select");
    expect(await editor.selectedType()).toBe("wall");

    const { walls } = await editor.objects();
    expect(walls.length).toBe(1);
    expect(walls[0].start.x).toBeCloseTo(snapToGrid(20.2), 5);
    expect(walls[0].start.y).toBeCloseTo(snapToGrid(20.3), 5);
    expect(walls[0].end.x).toBeCloseTo(snapToGrid(25.1), 5);
    expect(walls[0].end.y).toBeCloseTo(snapToGrid(20.4), 5);
    expect(await editor.selectedId()).toBe(walls[0].id);
  });

  test("wall mode: a sub-snap-unit drag (start==end after snap) creates no wall", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await openRoom(editor);

    await editor.wallTool();
    await editor.drawWall({ x: 20, y: 20 }, { x: 20.1, y: 20.1 });

    expect(await editor.wallCount()).toBe(0);
    // Rejected draw does not switch mode away from 牆壁.
    expect(await editor.mode()).toBe("wall");
  });

  test("column mode: click places a snapped/clamped column, auto-selects it, returns to 選取", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await openRoom(editor);

    await editor.columnTool();
    expect(await editor.mode()).toBe("column");

    await editor.placeColumn({ x: 27.3, y: 27.4 });

    expect(await editor.columnCount()).toBe(1);
    expect(await editor.mode()).toBe("select");
    expect(await editor.selectedType()).toBe("column");

    const { columns } = await editor.objects();
    expect(columns.length).toBe(1);
    expect(columns[0].center.x).toBeCloseTo(clampColumnCenter(27.3), 5);
    expect(columns[0].center.y).toBeCloseTo(clampColumnCenter(27.4), 5);
    expect(await editor.selectedId()).toBe(columns[0].id);
  });

  test("column mode: 柱子中心被夾在可編輯範圍的內緣", async ({ page }) => {
    // T1 之前這一項守的是固定 200m 平面的邊(0.25 / 199.75),要先 zoom out
    // 30 格才點得到。現在範圍是「攤位 + 5m 邊距」,預設 3×3 攤位就是
    // [15,28] —— 邊界落在預設視圖裡,不必縮放就點得到。
    //
    // 守的東西沒變:柱子半寬 0.25,所以中心最多只能到 15.25 / 27.75,
    // 整根柱子完整留在範圍內。
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.columnTool();
    await editor.placeColumn({ x: 14, y: 29 });

    const { columns } = await editor.objects();
    expect(columns[0].center.x).toBeCloseTo(15.25, 5);
    expect(columns[0].center.y).toBeCloseTo(27.75, 5);
  });

  test("選取模式: clicking a wall/column selects it; clicking empty space clears selection", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await openRoom(editor);

    await editor.wallTool();
    await editor.drawWall({ x: 20, y: 20 }, { x: 25, y: 20 });
    const { walls } = await editor.objects();
    const wallId = walls[0].id;

    // Clicking empty space clears the auto-selection from creation.
    await editor.clickAt({ x: 16, y: 27 });
    expect(await editor.selectedId()).toBe("");

    // Clicking the wall body re-selects it.
    await editor.clickAt({ x: 22.5, y: 20 });
    expect(await editor.selectedType()).toBe("wall");
    expect(await editor.selectedId()).toBe(wallId);

    await editor.clickAt({ x: 16, y: 27 });
    expect(await editor.selectedId()).toBe("");
  });

  test("dragging a selected wall's body translates the whole wall, snapped, in bounds", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await openRoom(editor);

    await editor.wallTool();
    await editor.drawWall({ x: 20, y: 20 }, { x: 25, y: 20 });
    // Wall is auto-selected after creation.

    await editor.dragObjectBody({ x: 22.5, y: 20 }, { x: 24.5, y: 22 });

    const { walls } = await editor.objects();
    expect(walls.length).toBe(1);
    expect(walls[0].start.x).toBeCloseTo(22, 5);
    expect(walls[0].start.y).toBeCloseTo(22, 5);
    expect(walls[0].end.x).toBeCloseTo(27, 5);
    expect(walls[0].end.y).toBeCloseTo(22, 5);
  });

  test("dragging a selected column's body translates it, snapped, in bounds", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await openRoom(editor);

    await editor.columnTool();
    await editor.placeColumn({ x: 25, y: 25 });
    // Column is auto-selected after creation.

    await editor.dragObjectBody({ x: 25, y: 25 }, { x: 27, y: 23 });

    const { columns } = await editor.objects();
    expect(columns.length).toBe(1);
    expect(columns[0].center.x).toBeCloseTo(27, 5);
    expect(columns[0].center.y).toBeCloseTo(23, 5);
  });

  test("dragging a wall endpoint moves only that endpoint, snapped, other endpoint fixed", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await openRoom(editor);

    await editor.wallTool();
    await editor.drawWall({ x: 20, y: 20 }, { x: 25, y: 20 });
    const { walls } = await editor.objects();
    const wallId = walls[0].id;

    await editor.dragWallEndpoint(wallId, "start", { x: 20, y: 27.3 });

    const { walls: after } = await editor.objects();
    const wall = after.find((w) => w.id === wallId)!;
    expect(wall.start.x).toBeCloseTo(20, 5);
    expect(wall.start.y).toBeCloseTo(snapToGrid(27.3), 5);
    // Other endpoint untouched.
    expect(wall.end.x).toBeCloseTo(25, 5);
    expect(wall.end.y).toBeCloseTo(20, 5);
  });

  test("dragging a wall endpoint onto the other endpoint is rejected and reverts", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await openRoom(editor);

    await editor.wallTool();
    await editor.drawWall({ x: 20, y: 20 }, { x: 25, y: 20 });
    const { walls } = await editor.objects();
    const wallId = walls[0].id;
    const original = walls[0];

    // Single-jump drag (steps: 1) so the only position evaluated mid-gesture
    // is the exact coincidence point, making "reverts to last valid
    // position" unambiguous (== the pre-drag original position here).
    await editor.dragWallEndpoint(wallId, "start", original.end, 1);

    const { walls: after } = await editor.objects();
    const wall = after.find((w) => w.id === wallId)!;
    expect(wall.start.x).toBeCloseTo(original.start.x, 5);
    expect(wall.start.y).toBeCloseTo(original.start.y, 5);
    expect(wall.end.x).toBeCloseTo(original.end.x, 5);
    expect(wall.end.y).toBeCloseTo(original.end.y, 5);
  });

  test("Delete/Backspace key removes the selected object and clears selection", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await openRoom(editor);

    await editor.wallTool();
    await editor.drawWall({ x: 20, y: 20 }, { x: 25, y: 20 });
    expect(await editor.wallCount()).toBe(1);

    await editor.pressDelete();

    expect(await editor.wallCount()).toBe(0);
    expect(await editor.selectedId()).toBe("");
  });

  test("刪除 button removes the selected object; no-op when nothing selected", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    // No-op when nothing is selected: the control is disabled outright
    // (rather than clickable-but-inert), so assert the disabled state
    // directly instead of forcing a click Playwright would otherwise
    // refuse to deliver to a disabled element.
    await expect(page.locator('[data-testid="tool-delete"]')).toBeDisabled();
    expect(await editor.wallCount()).toBe(0);
    expect(await editor.columnCount()).toBe(0);

    await editor.columnTool();
    await editor.placeColumn({ x: 25, y: 25 });
    expect(await editor.columnCount()).toBe(1);

    await editor.clickDelete();
    expect(await editor.columnCount()).toBe(0);
    expect(await editor.selectedId()).toBe("");
  });

  test("multiple walls/columns are each independently selectable, movable, deletable", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await openRoom(editor);

    await editor.wallTool();
    await editor.drawWall({ x: 17, y: 17 }, { x: 21, y: 17 });
    await editor.wallTool();
    await editor.drawWall({ x: 17, y: 23 }, { x: 21, y: 23 });
    await editor.columnTool();
    await editor.placeColumn({ x: 25.5, y: 25.5 });
    await editor.columnTool();
    await editor.placeColumn({ x: 27, y: 27 });

    expect(await editor.wallCount()).toBe(2);
    expect(await editor.columnCount()).toBe(2);

    const { walls, columns } = await editor.objects();
    const firstWall = walls[0];
    const secondWall = walls[1];
    const firstColumn = columns[0];

    // Select and move the first wall only; others stay put.
    await editor.clickAt({ x: 19, y: 17 });
    expect(await editor.selectedId()).toBe(firstWall.id);
    await editor.dragObjectBody({ x: 19, y: 17 }, { x: 19, y: 19 });

    const afterMove = await editor.objects();
    const movedWall = afterMove.walls.find((w) => w.id === firstWall.id)!;
    const untouchedWall = afterMove.walls.find((w) => w.id === secondWall.id)!;
    expect(movedWall.start.y).toBeCloseTo(19, 5);
    expect(untouchedWall.start.y).toBeCloseTo(secondWall.start.y, 5);

    // Delete the first column only; the second remains.
    await editor.clickAt({ x: 25.5, y: 25.5 });
    expect(await editor.selectedId()).toBe(firstColumn.id);
    await editor.pressDelete();

    expect(await editor.wallCount()).toBe(2);
    expect(await editor.columnCount()).toBe(1);
    const { columns: remainingColumns } = await editor.objects();
    expect(remainingColumns[0].id).not.toBe(firstColumn.id);
  });

  test("bounds: dragging an object toward the edge clamps so the full extent stays in 50x50m", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await openRoom(editor);

    await editor.columnTool();
    await editor.placeColumn({ x: 20, y: 20 });
    // Column is auto-selected; drag far toward the top-left corner.
    await editor.dragObjectBody({ x: 20, y: 20 }, { x: -5, y: -5 });

    const { columns } = await editor.objects();
    expect(columns[0].center.x).toBeCloseTo(15.25, 5);
    expect(columns[0].center.y).toBeCloseTo(15.25, 5);
  });

  test("regression (QA bug 1): re-entering 牆壁 mode with a stale selection does not hijack a new draw gesture into dragging the old wall", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await openRoom(editor);

    // Draw wall 1; it auto-selects and mode returns to 選取.
    await editor.wallTool();
    await editor.drawWall({ x: 20, y: 20 }, { x: 25, y: 20 });
    const { walls: afterFirst } = await editor.objects();
    expect(afterFirst.length).toBe(1);
    const wall1 = afterFirst[0];

    // Re-enter 牆壁 mode without explicitly deselecting wall 1 — a normal
    // way to draw a connected second wall.
    await editor.wallTool();
    expect(await editor.mode()).toBe("wall");

    // Start the new drag on a point that lies on wall 1's body. Before the
    // fix, Konva would intercept this as a native drag of the still-
    // draggable, still-selected wall 1 instead of a Stage-level draw
    // gesture, corrupting wall 1 and leaving a garbage fragment behind.
    await editor.drawWall({ x: 22.5, y: 20 }, { x: 22.5, y: 27.5 });

    expect(await editor.wallCount()).toBe(2);
    const { walls: afterSecond } = await editor.objects();
    const stillWall1 = afterSecond.find((w) => w.id === wall1.id)!;
    expect(stillWall1.start.x).toBeCloseTo(wall1.start.x, 5);
    expect(stillWall1.start.y).toBeCloseTo(wall1.start.y, 5);
    expect(stillWall1.end.x).toBeCloseTo(wall1.end.x, 5);
    expect(stillWall1.end.y).toBeCloseTo(wall1.end.y, 5);

    const wall2 = afterSecond.find((w) => w.id !== wall1.id)!;
    expect(wall2.start.x).toBeCloseTo(22.5, 5);
    expect(wall2.start.y).toBeCloseTo(20, 5);
    expect(wall2.end.x).toBeCloseTo(22.5, 5);
    expect(wall2.end.y).toBeCloseTo(27.5, 5);
  });

  test("regression (QA bug 2): placing a new column on top of an existing one of the same type selects the new column, not the old one", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await openRoom(editor);

    // Place column A, then explicitly deselect.
    await editor.columnTool();
    await editor.placeColumn({ x: 25, y: 25 });
    const { columns: afterFirst } = await editor.objects();
    expect(afterFirst.length).toBe(1);
    const columnA = afterFirst[0];
    await editor.clickAt({ x: 16, y: 27 });
    expect(await editor.selectedId()).toBe("");

    // Place column B at the exact same point. Before the fix, column A's
    // (mode-unaware) onClick would fire after B's creation and overwrite
    // the selection back to A.
    await editor.columnTool();
    await editor.placeColumn({ x: 25, y: 25 });

    expect(await editor.columnCount()).toBe(2);
    const { columns: afterSecond } = await editor.objects();
    const columnB = afterSecond.find((c) => c.id !== columnA.id)!;
    expect(await editor.selectedType()).toBe("column");
    expect(await editor.selectedId()).toBe(columnB.id);
    expect(await editor.selectedId()).not.toBe(columnA.id);
  });

  test("regression: toolbar does not reintroduce the old grid-cell editor's DOM", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await expect(page.locator('[data-testid="venue-grid"]')).toHaveCount(0);
    await expect(page.getByText("面積統計")).toHaveCount(0);
  });
});
