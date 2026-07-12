import { test, expect } from "@playwright/test";
import { VenuePage } from "./pages/VenuePage";

// 場地白模產生器 (階段一) Task 3: 網格真實尺寸標示（座標軸公尺標籤 /
// 比例尺圖例 / 面積統計）+ 不規則形狀驗證（非連續、凹形、中空）。
// See .claude/pipeline/orchestrator-output.md for the source ACs this
// automates, and .claude/pipeline/architect-plan.md (Task 3) for the
// ruler/legend/stats design (grid.ts: axisLabels / countCellTypes,
// CELL_SIZE_PX = 24).

// Kept in sync with src/lib/venue/grid.ts (not imported directly — Playwright
// specs in this project use relative-only imports; see pages/VenuePage.ts).
const CELL_SIZE_PX = 24;

test.describe("Venue grid editor — Task 3 scale & stats", () => {
  let venue: VenuePage;

  test.beforeEach(async ({ page }) => {
    venue = new VenuePage(page);
    await venue.navigate();
  });

  test("AC1: default 10x10 — rulers show 0..10 edge labels aligned to gridlines", async () => {
    await expect(venue.rulerTop).toBeVisible();
    await expect(venue.rulerLeft).toBeVisible();

    const topValues = await venue.rulerValues(venue.rulerTop);
    const leftValues = await venue.rulerValues(venue.rulerLeft);
    expect(topValues).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(leftValues).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // Alignment: label "v" should sit at v * CELL_SIZE_PX relative to the
    // grid's own top-left edge (rulers are laid out in the same 2x2 frame,
    // sized exactly to the grid's width/height in px).
    const gridBox = await venue.grid.boundingBox();
    if (!gridBox) throw new Error("grid not visible");

    for (const v of [0, 5, 10]) {
      const topLabelBox = await venue.rulerLabel(venue.rulerTop, v).boundingBox();
      const leftLabelBox = await venue.rulerLabel(venue.rulerLeft, v).boundingBox();
      if (!topLabelBox || !leftLabelBox) throw new Error(`label ${v} not found`);

      const topLabelCenterX = topLabelBox.x + topLabelBox.width / 2;
      const leftLabelCenterY = leftLabelBox.y + leftLabelBox.height / 2;

      expect(topLabelCenterX).toBeGreaterThan(gridBox.x + v * CELL_SIZE_PX - 3);
      expect(topLabelCenterX).toBeLessThan(gridBox.x + v * CELL_SIZE_PX + 3);
      expect(leftLabelCenterY).toBeGreaterThan(gridBox.y + v * CELL_SIZE_PX - 3);
      expect(leftLabelCenterY).toBeLessThan(gridBox.y + v * CELL_SIZE_PX + 3);
    }
  });

  test("AC2: legend text '每格 = 1 公尺' is visible", async () => {
    await expect(venue.legend).toBeVisible();
    expect(await venue.legend.textContent()).toContain("每格 = 1 公尺");
  });

  test("AC3: stats start at 0/0/0, then track paint/erase live", async () => {
    let stats = await venue.statsCounts();
    expect(stats).toEqual({ floor: 0, wall: 0, column: 0 });

    // Paint 3 floor cells.
    await venue.selectTool("tool-floor");
    await venue.clickCell(0, 0);
    await venue.clickCell(1, 0);
    await venue.clickCell(2, 0);
    stats = await venue.statsCounts();
    expect(stats.floor).toBe(3);

    // Paint 2 wall cells.
    await venue.selectTool("tool-wall");
    await venue.clickCell(0, 1);
    await venue.clickCell(1, 1);
    stats = await venue.statsCounts();
    expect(stats).toEqual({ floor: 3, wall: 2, column: 0 });

    // Erase 1 floor cell.
    await venue.selectTool("tool-eraser");
    await venue.clickCell(0, 0);
    stats = await venue.statsCounts();
    expect(stats).toEqual({ floor: 2, wall: 2, column: 0 });
  });

  test("AC4: overwrite — painting wall on a floor cell moves it from floor to wall count", async () => {
    await venue.selectTool("tool-floor");
    await venue.clickCell(4, 4);
    expect(await venue.cellState(4, 4)).toBe("floor");
    expect((await venue.statsCounts()).floor).toBe(1);

    await venue.selectTool("tool-wall");
    await venue.clickCell(4, 4);
    expect(await venue.cellState(4, 4)).toBe("wall");

    const stats = await venue.statsCounts();
    expect(stats.floor).toBe(0);
    expect(stats.wall).toBe(1);
  });

  test("AC5: resize to 25x8 — top ruler sparse (step 5), left ruler dense (every meter), stats reset", async () => {
    await venue.selectTool("tool-floor");
    await venue.clickCell(0, 0);
    expect((await venue.statsCounts()).floor).toBe(1);

    await venue.resize("25", "8");

    const topValues = await venue.rulerValues(venue.rulerTop);
    const leftValues = await venue.rulerValues(venue.rulerLeft);
    expect(topValues).toEqual([0, 5, 10, 15, 20, 25]);
    expect(leftValues).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);

    expect(await venue.statsCounts()).toEqual({ floor: 0, wall: 0, column: 0 });
  });

  test("AC6: resize to 50x50 (max) — both rulers sparse, ending at 50", async () => {
    await venue.resize("50", "50");

    const topValues = await venue.rulerValues(venue.rulerTop);
    const leftValues = await venue.rulerValues(venue.rulerLeft);
    expect(topValues).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
    expect(leftValues).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
  });

  test("AC5b: non-multiple-of-5 tail (23x23) appends the final edge label", async () => {
    await venue.resize("23", "23");

    const topValues = await venue.rulerValues(venue.rulerTop);
    const leftValues = await venue.rulerValues(venue.rulerLeft);
    expect(topValues).toEqual([0, 5, 10, 15, 20, 23]);
    expect(leftValues).toEqual([0, 5, 10, 15, 20, 23]);
  });

  test("AC7: non-contiguous floor regions both preserved, stats sum both", async () => {
    await venue.selectTool("tool-floor");

    // 2x2 region top-left (0,0)-(1,1).
    await venue.dragPaint(0, 0, 1, 0);
    await venue.dragPaint(0, 1, 1, 1);

    // 2x2 region bottom-right (8,8)-(9,9).
    await venue.dragPaint(8, 8, 9, 8);
    await venue.dragPaint(8, 9, 9, 9);

    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [8, 8],
      [9, 8],
      [8, 9],
      [9, 9],
    ]) {
      expect(await venue.cellState(x, y)).toBe("floor");
    }
    // Gap between the two regions stays empty — no auto-connect.
    expect(await venue.cellState(5, 5)).toBe("empty");
    expect((await venue.statsCounts()).floor).toBe(8);
  });

  test("AC8a: concave (L-shape) floor paints correctly, corner outside the L stays empty", async () => {
    await venue.selectTool("tool-floor");

    // L-shape: vertical arm (2,2)-(2,4), then horizontal arm (2,5)-(5,5).
    // The two drags must not share a start cell that the other already
    // painted floor — dragPaint's start cell toggles to erase when it
    // already matches the active tool (same rule as the toolbar AC3 tests),
    // so the arms are split at the corner instead of overlapping on (2,5).
    await venue.dragPaint(2, 2, 2, 4);
    await venue.dragPaint(2, 5, 5, 5);

    const lCells: Array<[number, number]> = [
      [2, 2],
      [2, 3],
      [2, 4],
      [2, 5],
      [3, 5],
      [4, 5],
      [5, 5],
    ];
    for (const [x, y] of lCells) {
      expect(await venue.cellState(x, y)).toBe("floor");
    }
    // The concave corner outside the L (top-right of the bounding box) stays empty.
    expect(await venue.cellState(5, 2)).toBe("empty");
    expect((await venue.statsCounts()).floor).toBe(lCells.length);
  });

  test("AC8b: hollow wall ring — interior stays empty, wall count matches ring size only", async () => {
    await venue.selectTool("tool-wall");

    // 4x4 ring from (1,1) to (4,4): top/bottom edges (incl. corners) + the
    // remaining left/right interior cells. Each drag starts on a cell no
    // prior drag touched, so none of them accidentally starts on an
    // already-wall cell (which would toggle to erase — same rule exercised
    // by the toolbar AC3 tests).
    await venue.dragPaint(1, 1, 4, 1); // top edge incl. corners
    await venue.dragPaint(1, 4, 4, 4); // bottom edge incl. corners
    await venue.dragPaint(1, 2, 1, 3); // left edge, interior only
    await venue.dragPaint(4, 2, 4, 3); // right edge, interior only

    const ring: Array<[number, number]> = [
      [1, 1], [2, 1], [3, 1], [4, 1],
      [1, 4], [2, 4], [3, 4], [4, 4],
      [1, 2], [1, 3],
      [4, 2], [4, 3],
    ];
    for (const [x, y] of ring) {
      expect(await venue.cellState(x, y)).toBe("wall");
    }
    // Interior stays empty.
    expect(await venue.cellState(2, 2)).toBe("empty");
    expect(await venue.cellState(3, 2)).toBe("empty");
    expect(await venue.cellState(2, 3)).toBe("empty");
    expect(await venue.cellState(3, 3)).toBe("empty");

    const stats = await venue.statsCounts();
    expect(stats.wall).toBe(ring.length);
    expect(stats.floor).toBe(0);
  });
});
