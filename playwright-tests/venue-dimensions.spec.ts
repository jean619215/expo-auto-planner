import { test, expect } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";

// Playwright acceptance gate for 場地白模產生器 (階段一) Task 3:
// 縮放與尺寸標註 — 物件縮放把手、縮放/選取時即時顯示公尺尺寸、地板多邊形邊長標註.
// Covers the acceptance criteria in .claude/pipeline/orchestrator-output.md
// (Task 3 spec). Kept separate from venue-objects.spec.ts (Task 2) since this
// task introduces a distinct concern (resize + labels) with its own fixture
// patterns (label text assertions).

function snapToGrid(v: number): number {
  return Math.round(v / 0.5) * 0.5;
}

test.describe("Venue Plan Editor - Task 3 dimensions", () => {
  test("column corner handles resize width/height independently, snapped, opposite corner fixed (top-left corner)", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.columnTool();
    await editor.placeColumn({ x: 20, y: 20 });
    const { columns } = await editor.objects();
    const columnId = columns[0].id;
    const original = columns[0];
    const originalRight = original.center.x + original.w / 2;
    const originalBottom = original.center.y + original.h / 2;

    // Drag the top-left corner outward (up-left) to grow the column.
    await editor.dragColumnCorner(columnId, { x: -1, y: -1 }, { x: 18, y: 17.4 });

    const { columns: after } = await editor.objects();
    const updated = after.find((c) => c.id === columnId)!;

    expect(updated.w).toBeCloseTo(originalRight - snapToGrid(18), 5);
    expect(updated.h).toBeCloseTo(originalBottom - snapToGrid(17.4), 5);
    // Anchor (bottom-right) corner unchanged.
    expect(updated.center.x + updated.w / 2).toBeCloseTo(originalRight, 5);
    expect(updated.center.y + updated.h / 2).toBeCloseTo(originalBottom, 5);
  });

  test("column corner handles resize independently (top-right corner)", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.columnTool();
    await editor.placeColumn({ x: 20, y: 20 });
    const { columns } = await editor.objects();
    const columnId = columns[0].id;
    const original = columns[0];
    const originalLeft = original.center.x - original.w / 2;
    const originalBottom = original.center.y + original.h / 2;

    await editor.dragColumnCorner(columnId, { x: 1, y: -1 }, { x: 22, y: 17.6 });

    const { columns: after } = await editor.objects();
    const updated = after.find((c) => c.id === columnId)!;

    expect(updated.center.x - updated.w / 2).toBeCloseTo(originalLeft, 5);
    expect(updated.center.y + updated.h / 2).toBeCloseTo(originalBottom, 5);
    expect(updated.w).toBeCloseTo(snapToGrid(22) - originalLeft, 5);
  });

  test("column corner handles resize independently (bottom-left corner)", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.columnTool();
    await editor.placeColumn({ x: 20, y: 20 });
    const { columns } = await editor.objects();
    const columnId = columns[0].id;
    const original = columns[0];
    const originalRight = original.center.x + original.w / 2;
    const originalTop = original.center.y - original.h / 2;

    await editor.dragColumnCorner(columnId, { x: -1, y: 1 }, { x: 18, y: 22.4 });

    const { columns: after } = await editor.objects();
    const updated = after.find((c) => c.id === columnId)!;

    expect(updated.center.x + updated.w / 2).toBeCloseTo(originalRight, 5);
    expect(updated.center.y - updated.h / 2).toBeCloseTo(originalTop, 5);
    expect(updated.h).toBeCloseTo(snapToGrid(22.4) - originalTop, 5);
  });

  test("column corner handles resize independently (bottom-right corner)", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.columnTool();
    await editor.placeColumn({ x: 20, y: 20 });
    const { columns } = await editor.objects();
    const columnId = columns[0].id;
    const original = columns[0];
    const originalLeft = original.center.x - original.w / 2;
    const originalTop = original.center.y - original.h / 2;

    await editor.dragColumnCorner(columnId, { x: 1, y: 1 }, { x: 22.5, y: 22.5 });

    const { columns: after } = await editor.objects();
    const updated = after.find((c) => c.id === columnId)!;

    expect(updated.center.x - updated.w / 2).toBeCloseTo(originalLeft, 5);
    expect(updated.center.y - updated.h / 2).toBeCloseTo(originalTop, 5);
    expect(updated.w).toBeCloseTo(snapToGrid(22.5) - originalLeft, 5);
    expect(updated.h).toBeCloseTo(snapToGrid(22.5) - originalTop, 5);
  });

  test("shrinking a corner below 0.5m clamps that axis to exactly 0.5m, anchor unchanged", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.columnTool();
    await editor.placeColumn({ x: 20, y: 20 });
    const { columns } = await editor.objects();
    const columnId = columns[0].id;
    const original = columns[0];
    const originalLeft = original.center.x - original.w / 2;
    const originalTop = original.center.y - original.h / 2;

    // Single-jump drag (steps: 1) directly onto the anchor (top-left, at
    // 19.75,19.75), attempting to shrink to zero (well below the 0.5m
    // minimum). Single-jump avoids intermediate interpolated positions so
    // only the final drop point is evaluated (mirrors the pattern used for
    // the wall-endpoint-coincidence regression test).
    await editor.dragColumnCorner(
      columnId,
      { x: 1, y: 1 },
      { x: originalLeft, y: originalTop },
      1,
    );

    const { columns: after } = await editor.objects();
    const updated = after.find((c) => c.id === columnId)!;

    expect(updated.w).toBeCloseTo(0.5, 5);
    expect(updated.h).toBeCloseTo(0.5, 5);
    expect(updated.center.x - updated.w / 2).toBeCloseTo(originalLeft, 5);
    expect(updated.center.y - updated.h / 2).toBeCloseTo(originalTop, 5);
  });

  test("resizing near the 200x200m boundary clamps growth without moving the anchor/center beyond bounds", async ({
    page,
  }) => {
    // Plannable range is PLAN_AREA_SIZE_M = 200 (2D 畫布 zoom/pan 任務),
    // not the default 50m view-fit. The corner-drag itself is a native
    // Konva node drag (tracked via document-level listeners once started),
    // so it can be dragged past the visible canvas's physical pixel bounds
    // same as vertex dragging — only the placeColumn() start point needs to
    // stay within the default-view clickable area.
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.columnTool();
    await editor.placeColumn({ x: 49, y: 49 });
    const { columns } = await editor.objects();
    const columnId = columns[0].id;
    const original = columns[0];
    const originalLeft = original.center.x - original.w / 2;
    const originalTop = original.center.y - original.h / 2;

    // Drag the bottom-right corner far past the plannable-area boundary.
    await editor.dragColumnCorner(columnId, { x: 1, y: 1 }, { x: 260, y: 260 });

    const { columns: after } = await editor.objects();
    const updated = after.find((c) => c.id === columnId)!;

    expect(updated.center.x + updated.w / 2).toBeCloseTo(200, 5);
    expect(updated.center.y + updated.h / 2).toBeCloseTo(200, 5);
    expect(updated.center.x - updated.w / 2).toBeCloseTo(originalLeft, 5);
    expect(updated.center.y - updated.h / 2).toBeCloseTo(originalTop, 5);
  });

  test("column dimension label shows W x H m when selected, hidden when deselected", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.columnTool();
    await editor.placeColumn({ x: 20, y: 20 });
    // Column auto-selected after creation.
    const { columns } = await editor.objects();
    const column = columns[0];

    expect(await editor.columnLabel()).toBe(
      `${column.w.toFixed(1)} x ${column.h.toFixed(1)} m`,
    );

    await editor.clickAt({ x: 40, y: 40 });
    expect(await editor.selectedId()).toBe("");
    expect(await editor.columnLabel()).toBe("");
  });

  test("wall dimension label shows L m when selected, hidden when deselected", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 8.2, y: 5 });
    // Wall auto-selected after creation.
    const { walls } = await editor.objects();
    const wall = walls[0];
    const expectedLength = Math.hypot(
      wall.end.x - wall.start.x,
      wall.end.y - wall.start.y,
    );

    expect(await editor.wallLabel()).toBe(`${expectedLength.toFixed(1)} m`);

    await editor.clickAt({ x: 40, y: 40 });
    expect(await editor.selectedId()).toBe("");
    expect(await editor.wallLabel()).toBe("");
  });

  test("wall dimension label updates live after an endpoint drag", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });
    const { walls } = await editor.objects();
    const wallId = walls[0].id;

    await editor.dragWallEndpoint(wallId, "end", { x: 13, y: 5 });

    const { walls: after } = await editor.objects();
    const updated = after.find((w) => w.id === wallId)!;
    const expectedLength = Math.hypot(
      updated.end.x - updated.start.x,
      updated.end.y - updated.start.y,
    );
    expect(await editor.wallLabel()).toBe(`${expectedLength.toFixed(1)} m`);
  });

  test("floor edge labels are always-on with one entry per edge, matching DEFAULT_FLOOR's 10.0 m sides", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    const labels = await editor.edgeLabels();
    expect(labels.length).toBe(4);
    for (const label of labels) {
      expect(label).toBe("10.0 m");
    }
  });

  test("floor edge labels update live when a vertex is dragged", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    // Move vertex 0 (20,20) to (20,26), lengthening the two adjacent edges.
    await editor.dragVertexTo(0, { x: 20, y: 26 });

    const verts = await editor.vertices();
    const labels = await editor.edgeLabels();
    expect(labels.length).toBe(4);

    for (let i = 0; i < verts.length; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      const expected = Math.hypot(b.x - a.x, b.y - a.y);
      expect(labels[i]).toBe(`${expected.toFixed(1)} m`);
    }
  });

  test("floor edge labels array length tracks vertex insertion/removal", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    expect((await editor.edgeLabels()).length).toBe(4);

    // Insert a vertex on the right edge midpoint.
    await editor.doubleClickAt({ x: 29.7, y: 25 });
    expect(await editor.vertexCount()).toBe(5);
    expect((await editor.edgeLabels()).length).toBe(5);

    // Remove a vertex back down.
    await editor.rightClickVertex(0);
    expect(await editor.vertexCount()).toBe(4);
    expect((await editor.edgeLabels()).length).toBe(4);
  });

  test("backward-compat: columns created via the 柱子 tool default to w=0.5, h=0.5", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.columnTool();
    await editor.placeColumn({ x: 12, y: 12 });

    const { columns } = await editor.objects();
    expect(columns[0].w).toBeCloseTo(0.5, 5);
    expect(columns[0].h).toBeCloseTo(0.5, 5);
  });

  test("regression: column translate preserves w/h and still clamps center", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.columnTool();
    await editor.placeColumn({ x: 20, y: 20 });
    const { columns } = await editor.objects();
    const columnId = columns[0].id;

    await editor.dragObjectBody({ x: 20, y: 20 }, { x: 15, y: 25 });

    const { columns: after } = await editor.objects();
    const updated = after.find((c) => c.id === columnId)!;
    expect(updated.center.x).toBeCloseTo(15, 5);
    expect(updated.center.y).toBeCloseTo(25, 5);
    expect(updated.w).toBeCloseTo(0.5, 5);
    expect(updated.h).toBeCloseTo(0.5, 5);
    expect(Number.isNaN(updated.center.x)).toBe(false);
    expect(Number.isNaN(updated.center.y)).toBe(false);
  });

  test("regression: corner-resize drag overshooting past the opposite anchor clamps to minimum size instead of flipping to the wrong side (QA bug 1)", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.columnTool();
    await editor.placeColumn({ x: 20, y: 20 });
    const { columns } = await editor.objects();
    const columnId = columns[0].id;

    // Grow the bottom-right corner out to (21.5, 21.5) — anchor (top-left)
    // fixed at (19.75, 19.75).
    await editor.dragColumnCorner(columnId, { x: 1, y: 1 }, { x: 21.5, y: 21.5 });

    const { columns: grown } = await editor.objects();
    const afterGrow = grown.find((c) => c.id === columnId)!;
    const anchorX = afterGrow.center.x - afterGrow.w / 2;
    const anchorY = afterGrow.center.y - afterGrow.h / 2;
    expect(anchorX).toBeCloseTo(19.75, 5);
    expect(anchorY).toBeCloseTo(19.75, 5);

    // Drag the SAME bottom-right corner well past the anchor, up and to the
    // left of it. Expected: the corner clamps to the minimum size (0.5m) on
    // the overshoot side, anchor stays fixed — not a jump to (24.5, 24.5) or
    // any growth in the wrong direction.
    await editor.dragColumnCorner(columnId, { x: 1, y: 1 }, { x: 14.75, y: 14.75 });

    const { columns: after } = await editor.objects();
    const updated = after.find((c) => c.id === columnId)!;

    expect(updated.w).toBeCloseTo(0.5, 5);
    expect(updated.h).toBeCloseTo(0.5, 5);
    expect(updated.center.x - updated.w / 2).toBeCloseTo(anchorX, 5);
    expect(updated.center.y - updated.h / 2).toBeCloseTo(anchorY, 5);
    // Explicitly guard against the old buggy result (wrong-direction growth).
    expect(updated.center.x + updated.w / 2).not.toBeCloseTo(24.5, 1);
    expect(updated.center.y + updated.h / 2).not.toBeCloseTo(24.5, 1);
  });

  test("very short wall (exactly one 0.5m snap step) renders a 0.5 m label with no NaN", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 5.5, y: 5 });

    const { walls } = await editor.objects();
    expect(walls.length).toBe(1);
    expect(await editor.wallLabel()).toBe("0.5 m");
    expect(await editor.wallLabel()).not.toContain("NaN");
  });
});
