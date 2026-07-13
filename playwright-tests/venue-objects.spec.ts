import { test, expect } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";

// Playwright acceptance gate for 場地白模產生器 (階段一) Task 2:
// 物件系統 — 牆壁線段工具與柱子矩形工具, 含選取/移動/刪除.
// Covers the acceptance criteria in .claude/pipeline/orchestrator-output.md
// (Task 2 spec). The canvas has no per-shape DOM, so every scenario reads
// state from the plan-editor wrapper's data-* attributes (see
// PlanEditorPage) rather than querying canvas internals directly.

function snapToGrid(v: number): number {
  return Math.round(v / 0.5) * 0.5;
}

function clampColumnCenter(v: number): number {
  return Math.min(49.75, Math.max(0.25, snapToGrid(v)));
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
    await editor.navigate();

    await editor.wallTool();
    expect(await editor.mode()).toBe("wall");

    await editor.drawWall({ x: 5.2, y: 5.3 }, { x: 10.1, y: 5.4 });

    expect(await editor.wallCount()).toBe(1);
    expect(await editor.mode()).toBe("select");
    expect(await editor.selectedType()).toBe("wall");

    const { walls } = await editor.objects();
    expect(walls.length).toBe(1);
    expect(walls[0].start.x).toBeCloseTo(snapToGrid(5.2), 5);
    expect(walls[0].start.y).toBeCloseTo(snapToGrid(5.3), 5);
    expect(walls[0].end.x).toBeCloseTo(snapToGrid(10.1), 5);
    expect(walls[0].end.y).toBeCloseTo(snapToGrid(5.4), 5);
    expect(await editor.selectedId()).toBe(walls[0].id);
  });

  test("wall mode: a sub-snap-unit drag (start==end after snap) creates no wall", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 5.1, y: 5.1 });

    expect(await editor.wallCount()).toBe(0);
    // Rejected draw does not switch mode away from 牆壁.
    expect(await editor.mode()).toBe("wall");
  });

  test("column mode: click places a snapped/clamped column, auto-selects it, returns to 選取", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.columnTool();
    expect(await editor.mode()).toBe("column");

    await editor.placeColumn({ x: 12.3, y: 12.4 });

    expect(await editor.columnCount()).toBe(1);
    expect(await editor.mode()).toBe("select");
    expect(await editor.selectedType()).toBe("column");

    const { columns } = await editor.objects();
    expect(columns.length).toBe(1);
    expect(columns[0].center.x).toBeCloseTo(clampColumnCenter(12.3), 5);
    expect(columns[0].center.y).toBeCloseTo(clampColumnCenter(12.4), 5);
    expect(await editor.selectedId()).toBe(columns[0].id);
  });

  test("column mode: center is clamped to [0.25, 49.75] near the canvas edge", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.columnTool();
    await editor.placeColumn({ x: 0, y: 49.9 });

    const { columns } = await editor.objects();
    expect(columns[0].center.x).toBeCloseTo(0.25, 5);
    expect(columns[0].center.y).toBeCloseTo(49.75, 5);
  });

  test("選取模式: clicking a wall/column selects it; clicking empty space clears selection", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });
    const { walls } = await editor.objects();
    const wallId = walls[0].id;

    // Clicking empty space clears the auto-selection from creation.
    await editor.clickAt({ x: 40, y: 40 });
    expect(await editor.selectedId()).toBe("");

    // Clicking the wall body re-selects it.
    await editor.clickAt({ x: 7.5, y: 5 });
    expect(await editor.selectedType()).toBe("wall");
    expect(await editor.selectedId()).toBe(wallId);

    await editor.clickAt({ x: 40, y: 40 });
    expect(await editor.selectedId()).toBe("");
  });

  test("dragging a selected wall's body translates the whole wall, snapped, in bounds", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });
    // Wall is auto-selected after creation.

    await editor.dragObjectBody({ x: 7.5, y: 5 }, { x: 9.5, y: 7 });

    const { walls } = await editor.objects();
    expect(walls.length).toBe(1);
    expect(walls[0].start.x).toBeCloseTo(7, 5);
    expect(walls[0].start.y).toBeCloseTo(7, 5);
    expect(walls[0].end.x).toBeCloseTo(12, 5);
    expect(walls[0].end.y).toBeCloseTo(7, 5);
  });

  test("dragging a selected column's body translates it, snapped, in bounds", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.columnTool();
    await editor.placeColumn({ x: 10, y: 10 });
    // Column is auto-selected after creation.

    await editor.dragObjectBody({ x: 10, y: 10 }, { x: 12, y: 8 });

    const { columns } = await editor.objects();
    expect(columns.length).toBe(1);
    expect(columns[0].center.x).toBeCloseTo(12, 5);
    expect(columns[0].center.y).toBeCloseTo(8, 5);
  });

  test("dragging a wall endpoint moves only that endpoint, snapped, other endpoint fixed", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });
    const { walls } = await editor.objects();
    const wallId = walls[0].id;

    await editor.dragWallEndpoint(wallId, "start", { x: 5, y: 12.3 });

    const { walls: after } = await editor.objects();
    const wall = after.find((w) => w.id === wallId)!;
    expect(wall.start.x).toBeCloseTo(5, 5);
    expect(wall.start.y).toBeCloseTo(snapToGrid(12.3), 5);
    // Other endpoint untouched.
    expect(wall.end.x).toBeCloseTo(10, 5);
    expect(wall.end.y).toBeCloseTo(5, 5);
  });

  test("dragging a wall endpoint onto the other endpoint is rejected and reverts", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });
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
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });
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
    await editor.placeColumn({ x: 10, y: 10 });
    expect(await editor.columnCount()).toBe(1);

    await editor.clickDelete();
    expect(await editor.columnCount()).toBe(0);
    expect(await editor.selectedId()).toBe("");
  });

  test("multiple walls/columns are each independently selectable, movable, deletable", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 2, y: 2 }, { x: 6, y: 2 });
    await editor.wallTool();
    await editor.drawWall({ x: 2, y: 8 }, { x: 6, y: 8 });
    await editor.columnTool();
    await editor.placeColumn({ x: 20, y: 20 });
    await editor.columnTool();
    await editor.placeColumn({ x: 30, y: 30 });

    expect(await editor.wallCount()).toBe(2);
    expect(await editor.columnCount()).toBe(2);

    const { walls, columns } = await editor.objects();
    const firstWall = walls[0];
    const secondWall = walls[1];
    const firstColumn = columns[0];

    // Select and move the first wall only; others stay put.
    await editor.clickAt({ x: 4, y: 2 });
    expect(await editor.selectedId()).toBe(firstWall.id);
    await editor.dragObjectBody({ x: 4, y: 2 }, { x: 4, y: 4 });

    const afterMove = await editor.objects();
    const movedWall = afterMove.walls.find((w) => w.id === firstWall.id)!;
    const untouchedWall = afterMove.walls.find((w) => w.id === secondWall.id)!;
    expect(movedWall.start.y).toBeCloseTo(4, 5);
    expect(untouchedWall.start.y).toBeCloseTo(secondWall.start.y, 5);

    // Delete the first column only; the second remains.
    await editor.clickAt({ x: 20, y: 20 });
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
    await editor.navigate();

    await editor.columnTool();
    await editor.placeColumn({ x: 5, y: 5 });
    // Column is auto-selected; drag far toward the top-left corner.
    await editor.dragObjectBody({ x: 5, y: 5 }, { x: -20, y: -20 });

    const { columns } = await editor.objects();
    expect(columns[0].center.x).toBeCloseTo(0.25, 5);
    expect(columns[0].center.y).toBeCloseTo(0.25, 5);
  });

  test("regression (QA bug 1): re-entering 牆壁 mode with a stale selection does not hijack a new draw gesture into dragging the old wall", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    // Draw wall 1; it auto-selects and mode returns to 選取.
    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });
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
    await editor.drawWall({ x: 7.5, y: 5 }, { x: 7.5, y: 15 });

    expect(await editor.wallCount()).toBe(2);
    const { walls: afterSecond } = await editor.objects();
    const stillWall1 = afterSecond.find((w) => w.id === wall1.id)!;
    expect(stillWall1.start.x).toBeCloseTo(wall1.start.x, 5);
    expect(stillWall1.start.y).toBeCloseTo(wall1.start.y, 5);
    expect(stillWall1.end.x).toBeCloseTo(wall1.end.x, 5);
    expect(stillWall1.end.y).toBeCloseTo(wall1.end.y, 5);

    const wall2 = afterSecond.find((w) => w.id !== wall1.id)!;
    expect(wall2.start.x).toBeCloseTo(7.5, 5);
    expect(wall2.start.y).toBeCloseTo(5, 5);
    expect(wall2.end.x).toBeCloseTo(7.5, 5);
    expect(wall2.end.y).toBeCloseTo(15, 5);
  });

  test("regression (QA bug 2): placing a new column on top of an existing one of the same type selects the new column, not the old one", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    // Place column A, then explicitly deselect.
    await editor.columnTool();
    await editor.placeColumn({ x: 10, y: 10 });
    const { columns: afterFirst } = await editor.objects();
    expect(afterFirst.length).toBe(1);
    const columnA = afterFirst[0];
    await editor.clickAt({ x: 40, y: 40 });
    expect(await editor.selectedId()).toBe("");

    // Place column B at the exact same point. Before the fix, column A's
    // (mode-unaware) onClick would fire after B's creation and overwrite
    // the selection back to A.
    await editor.columnTool();
    await editor.placeColumn({ x: 10, y: 10 });

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
