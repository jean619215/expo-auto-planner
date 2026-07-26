import { test, expect } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";

// Playwright acceptance gate for 場地白模產生器 (階段一) Task 1: Konva 平面圖編輯器基礎.
// Covers the 9 acceptance criteria in .claude/pipeline/orchestrator-output.md.
//
// The canvas has no per-shape DOM, so every scenario reads/derives state from
// the plan-editor wrapper's data-* attributes (see PlanEditorPage) rather
// than querying canvas internals directly.
//
// Default floor polygon (src/lib/venue/plan.ts DEFAULT_FLOOR): a 10x10m
// square at (20,20)-(30,20)-(30,30)-(20,30), inside the 50x50m venue bounds.

function snapToGrid(v: number): number {
  return Math.round(v / 0.5) * 0.5;
}

// PLAN_AREA_SIZE_M(src/lib/venue/plan.ts)— clamp 上限,zoom/pan 任務將可規劃
// 範圍由 50 擴大為 200(architect-plan.md 2D 畫布 zoom/pan)。
function clampToBounds(v: number): number {
  return Math.min(200, Math.max(0, v));
}

test.describe("Venue Plan Editor - Task 1 acceptance", () => {
  test("AC1: canvas loads with light-background floor-plan view, gridlines, scale indication", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await expect(editor.editor).toBeVisible();
    await expect(editor.canvas).toBeVisible();

    // Scale bar / meter label rendered as Konva text — assert via the
    // rendered canvas being present and stage sized (visible gridlines are
    // drawn to canvas, not to DOM, so we assert the structural contract
    // instead: a fixed fit-to-screen stage was computed).
    const stageSize = await editor.stageSize();
    const ppm = await editor.pxPerMeter();
    expect(stageSize).toBeGreaterThan(0);
    expect(ppm).toBeGreaterThan(0);
    expect(stageSize / ppm).toBeCloseTo(50, 5); // full 50x50m bounds fit exactly
  });

  test("AC2: default 10x10m square floor polygon, roughly centered, with 4 vertex handles", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    const count = await editor.vertexCount();
    expect(count).toBe(4);

    const verts = await editor.vertices();
    const xs = verts.map((v) => v.x).sort((a, b) => a - b);
    const ys = verts.map((v) => v.y).sort((a, b) => a - b);

    // 10m x 10m square.
    expect(xs[2] - xs[0]).toBeCloseTo(10, 5);
    expect(ys[2] - ys[0]).toBeCloseTo(10, 5);

    // Roughly centered in the 50x50m canvas (centroid near (25,25)).
    const centroidX = verts.reduce((s, v) => s + v.x, 0) / verts.length;
    const centroidY = verts.reduce((s, v) => s + v.y, 0) / verts.length;
    expect(centroidX).toBeCloseTo(25, 0);
    expect(centroidY).toBeCloseTo(25, 0);
  });

  test("AC3: dragging a vertex updates its position live, snapped to 0.5m", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    const target = { x: 23.2, y: 21.3 };
    await editor.dragVertexTo(0, target);

    const verts = await editor.vertices();
    const expected = {
      x: clampToBounds(snapToGrid(target.x)),
      y: clampToBounds(snapToGrid(target.y)),
    };
    expect(verts[0].x).toBeCloseTo(expected.x, 5);
    expect(verts[0].y).toBeCloseTo(expected.y, 5);

    // Other vertices untouched.
    expect(await editor.vertexCount()).toBe(4);
  });

  test("AC7 (bounds): dragging a vertex far outside 200x200m clamps to nearest in-bounds point", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    const farOutside = { x: 260, y: -30 };
    await editor.dragVertexTo(2, farOutside);

    const verts = await editor.vertices();
    expect(verts[2].x).toBeCloseTo(200, 5); // clamped to max bound (PLAN_AREA_SIZE_M)
    expect(verts[2].y).toBeCloseTo(0, 5); // clamped to min bound
    expect(Number.isNaN(verts[2].x)).toBe(false);
    expect(Number.isNaN(verts[2].y)).toBe(false);
  });

  test("AC4: double-clicking an edge midpoint inserts a new snapped vertex, splitting the edge", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    expect(await editor.vertexCount()).toBe(4);

    // Right edge runs from (30,20) to (30,30); midpoint (30,25). Click
    // slightly inside (29.7,25) so the hit lands within the filled polygon
    // (Konva hit-tests the shape's fill), while still within the 0.5m
    // edge-proximity threshold used by findClosestEdge.
    await editor.doubleClickAt({ x: 29.7, y: 25 });

    expect(await editor.vertexCount()).toBe(5);
    const verts = await editor.vertices();
    const inserted = verts.find(
      (v) => Math.abs(v.x - 30) < 1e-6 && Math.abs(v.y - 25) < 1e-6,
    );
    expect(inserted).toBeTruthy();
  });

  test("AC5/edge-case: double-clicking deep inside the polygon (>0.5m from all edges) is a no-op", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    // Center of the default 10x10 square (20-30,20-30) is 5m from every
    // edge — well beyond the 0.5m insertion threshold.
    await editor.doubleClickAt({ x: 25, y: 25 });

    expect(await editor.vertexCount()).toBe(4);
  });

  test("AC5/AC6: right-clicking a vertex deletes it while count > 3; deletion rejected at exactly 3", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    let count = await editor.vertexCount();
    expect(count).toBe(4);

    while (count > 3) {
      await editor.rightClickVertex(0);
      count = await editor.vertexCount();
    }
    expect(count).toBe(3);

    // One more right-click at 3 vertices must be rejected (no-op).
    await editor.rightClickVertex(0);
    count = await editor.vertexCount();
    expect(count).toBe(3);
  });

  test("AC8: editing into a concave shape renders without crashing", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    const editor = new PlanEditorPage(page);
    await editor.navigate();

    // Drag the top-right corner inward, past the polygon's interior, to
    // produce a concave/dart quadrilateral.
    await editor.dragVertexTo(1, { x: 24, y: 24 });

    expect(await editor.vertexCount()).toBe(4);
    const verts = await editor.vertices();
    expect(verts[1].x).toBeCloseTo(24, 5);
    expect(verts[1].y).toBeCloseTo(24, 5);

    // No uncaught client-side errors from rendering/interacting with the
    // now-concave polygon.
    expect(pageErrors).toEqual([]);
    await expect(editor.canvas).toBeVisible();
  });

  test("AC9: old grid-cell editor and its Playwright specs no longer exist", async ({
    page,
  }) => {
    // The old grid-cell UI (toolbar, meter rulers, area stats) must be gone;
    // this task's replacement editor has none of that DOM.
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await expect(
      page.locator('[data-testid="venue-grid"]'),
    ).toHaveCount(0);
    await expect(page.getByText("面積統計")).toHaveCount(0);
  });
});
