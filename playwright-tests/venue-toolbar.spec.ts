import { test, expect } from "@playwright/test";
import { VenuePage } from "./pages/VenuePage";

// 場地白模產生器 (階段一) Task 2: 工具列擴充 — 畫地板/畫牆壁/畫柱子/擦除.
// See .claude/pipeline/orchestrator-output.md for the source ACs this
// automates. Builds on Task 1's grid interaction model
// (playwright-tests/venue-grid-editor.spec.ts / pages/VenuePage.ts).

test.describe("Venue grid editor — Task 2 toolbar", () => {
  let venue: VenuePage;

  test.beforeEach(async ({ page }) => {
    venue = new VenuePage(page);
    await venue.navigate();
  });

  test("AC1: 畫地板 is the default active tool on load", async () => {
    expect(await venue.toolPressed("tool-floor")).toBe("true");
    expect(await venue.toolPressed("tool-wall")).toBe("false");
    expect(await venue.toolPressed("tool-column")).toBe("false");
    expect(await venue.toolPressed("tool-eraser")).toBe("false");
  });

  test("AC2: selecting 畫牆壁 makes it the sole active tool and paints wall on an empty cell", async () => {
    await venue.selectTool("tool-wall");
    expect(await venue.toolPressed("tool-wall")).toBe("true");
    expect(await venue.toolPressed("tool-floor")).toBe("false");
    expect(await venue.toolPressed("tool-column")).toBe("false");
    expect(await venue.toolPressed("tool-eraser")).toBe("false");

    expect(await venue.cellState(1, 1)).toBe("empty");
    await venue.clickCell(1, 1);
    expect(await venue.cellState(1, 1)).toBe("wall");
    await expect(venue.cell(1, 1)).toHaveClass(/bg-amber-700/);
  });

  test("AC3: wall tool clicking an existing wall cell toggles it back to empty", async () => {
    await venue.selectTool("tool-wall");
    await venue.clickCell(2, 2);
    expect(await venue.cellState(2, 2)).toBe("wall");

    await venue.clickCell(2, 2);
    expect(await venue.cellState(2, 2)).toBe("empty");
    await expect(venue.cell(2, 2)).toHaveClass(/bg-white/);
  });

  test("AC3b: wall tool clicking a floor cell overwrites directly to wall (no forced erase)", async () => {
    await venue.selectTool("tool-floor");
    await venue.clickCell(3, 3);
    expect(await venue.cellState(3, 3)).toBe("floor");

    await venue.selectTool("tool-wall");
    await venue.clickCell(3, 3);
    expect(await venue.cellState(3, 3)).toBe("wall");
    await expect(venue.cell(3, 3)).toHaveClass(/bg-amber-700/);
  });

  test("AC4: 畫柱子 paints column cells", async () => {
    await venue.selectTool("tool-column");
    expect(await venue.toolPressed("tool-column")).toBe("true");

    await venue.clickCell(4, 4);
    expect(await venue.cellState(4, 4)).toBe("column");
    await expect(venue.cell(4, 4)).toHaveClass(/bg-gray-500/);

    // Toggle back off.
    await venue.clickCell(4, 4);
    expect(await venue.cellState(4, 4)).toBe("empty");
  });

  test("AC5: 擦除 clears occupied cells and is a no-op on empty cells", async () => {
    // Paint a floor and a wall cell first.
    await venue.selectTool("tool-floor");
    await venue.clickCell(5, 5);
    expect(await venue.cellState(5, 5)).toBe("floor");

    await venue.selectTool("tool-wall");
    await venue.clickCell(6, 6);
    expect(await venue.cellState(6, 6)).toBe("wall");

    await venue.selectTool("tool-eraser");
    expect(await venue.toolPressed("tool-eraser")).toBe("true");

    await venue.clickCell(5, 5);
    expect(await venue.cellState(5, 5)).toBe("empty");

    await venue.clickCell(6, 6);
    expect(await venue.cellState(6, 6)).toBe("empty");

    // No-op on an already-empty cell.
    expect(await venue.cellState(7, 7)).toBe("empty");
    await venue.clickCell(7, 7);
    expect(await venue.cellState(7, 7)).toBe("empty");
  });

  test("AC7: dragging with wall tool from an empty cell paints every cell in the stroke as wall", async () => {
    await venue.selectTool("tool-wall");
    await venue.dragPaint(1, 8, 5, 8);

    for (let x = 1; x <= 5; x++) {
      expect(await venue.cellState(x, 8)).toBe("wall");
    }
    expect(await venue.cellState(0, 8)).toBe("empty");
    expect(await venue.cellState(6, 8)).toBe("empty");
  });

  test("AC8: dragging with eraser across mixed floor/wall/column cells clears all of them", async () => {
    // Paint a mixed run: floor, wall, column, empty, floor.
    await venue.selectTool("tool-floor");
    await venue.clickCell(1, 9);
    await venue.clickCell(4, 9);

    await venue.selectTool("tool-wall");
    await venue.clickCell(2, 9);

    await venue.selectTool("tool-column");
    await venue.clickCell(3, 9);

    expect(await venue.cellState(1, 9)).toBe("floor");
    expect(await venue.cellState(2, 9)).toBe("wall");
    expect(await venue.cellState(3, 9)).toBe("column");
    expect(await venue.cellState(4, 9)).toBe("floor");

    await venue.selectTool("tool-eraser");
    await venue.dragPaint(1, 9, 4, 9);

    for (let x = 1; x <= 4; x++) {
      expect(await venue.cellState(x, 9)).toBe("empty");
    }
  });

  test("AC9/AC11: resize clears cells but keeps the previously-selected tool active", async () => {
    await venue.selectTool("tool-wall");
    await venue.clickCell(0, 0);
    expect(await venue.cellState(0, 0)).toBe("wall");

    await venue.resize("12", "6");

    expect(await venue.allCellsCount()).toBe(72);
    // Tool selection persists across resize.
    expect(await venue.toolPressed("tool-wall")).toBe("true");
    expect(await venue.toolPressed("tool-floor")).toBe("false");

    // New grid cells are all empty (cleared).
    expect(await venue.cellState(0, 0)).toBe("empty");

    // Confirm the persisted wall tool still paints wall after resize.
    await venue.clickCell(0, 0);
    expect(await venue.cellState(0, 0)).toBe("wall");
  });

  test("AC10: floor/wall/column/empty cells each render with a distinct color class", async () => {
    await venue.selectTool("tool-floor");
    await venue.clickCell(0, 1);
    await venue.selectTool("tool-wall");
    await venue.clickCell(1, 1);
    await venue.selectTool("tool-column");
    await venue.clickCell(2, 1);
    // (3, 1) stays empty.

    const floorClass = await venue.cell(0, 1).getAttribute("class");
    const wallClass = await venue.cell(1, 1).getAttribute("class");
    const columnClass = await venue.cell(2, 1).getAttribute("class");
    const emptyClass = await venue.cell(3, 1).getAttribute("class");

    expect(floorClass).toContain("bg-sky-300");
    expect(wallClass).toContain("bg-amber-700");
    expect(columnClass).toContain("bg-gray-500");
    expect(emptyClass).toContain("bg-white");

    const classes = new Set([floorClass, wallClass, columnClass, emptyClass]);
    expect(classes.size).toBe(4);
  });
});
