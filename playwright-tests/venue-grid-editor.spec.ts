import { test, expect } from "@playwright/test";
import { VenuePage } from "./pages/VenuePage";

// 場地白模產生器 (階段一) Task 1: 2D 網格編輯器基礎.
// Public page, no auth, no persistence — see
// .claude/pipeline/orchestrator-output.md and
// manual-tests/venue-grid-editor.md for the source ACs/checklist this
// automates.

test.describe("Venue grid editor — Task 1", () => {
  let venue: VenuePage;

  test.beforeEach(async ({ page }) => {
    venue = new VenuePage(page);
    await venue.navigate();
  });

  test("AC1: /venue loads with default 10x10 grid, all cells empty", async () => {
    await expect(venue.grid).toBeVisible();
    expect(await venue.allCellsCount()).toBe(100);
    expect(await venue.floorCellsCount()).toBe(0);
    expect(await venue.cellState(0, 0)).toBe("empty");
    expect(await venue.cellState(9, 9)).toBe("empty");
  });

  test("AC2: single click toggles a cell floor <-> empty", async () => {
    expect(await venue.cellState(2, 3)).toBe("empty");
    await venue.clickCell(2, 3);
    expect(await venue.cellState(2, 3)).toBe("floor");
    await expect(venue.cell(2, 3)).toHaveClass(/bg-sky-300/);

    await venue.clickCell(2, 3);
    expect(await venue.cellState(2, 3)).toBe("empty");
    await expect(venue.cell(2, 3)).toHaveClass(/bg-white/);
  });

  test("AC3: drag from an empty cell paints every cell it passes over as floor", async () => {
    await venue.dragPaint(1, 1, 5, 1);

    for (let x = 1; x <= 5; x++) {
      expect(await venue.cellState(x, 1)).toBe("floor");
    }
    // Cells outside the stroke are untouched.
    expect(await venue.cellState(0, 1)).toBe("empty");
    expect(await venue.cellState(6, 1)).toBe("empty");
  });

  test("AC4: drag starting on a floor cell erases every cell it passes over", async () => {
    // Paint a run first.
    await venue.dragPaint(1, 2, 6, 2);
    for (let x = 1; x <= 6; x++) {
      expect(await venue.cellState(x, 2)).toBe("floor");
    }

    // Now drag starting on one of those floor cells across the run — should erase.
    await venue.dragPaint(1, 2, 6, 2);
    for (let x = 1; x <= 6; x++) {
      expect(await venue.cellState(x, 2)).toBe("empty");
    }
  });

  test("AC5: valid resize (15x8) rebuilds grid at new size and clears painted cells", async () => {
    await venue.clickCell(1, 1);
    await venue.clickCell(2, 2);
    expect(await venue.floorCellsCount()).toBe(2);

    await venue.resize("15", "8");

    expect(await venue.allCellsCount()).toBe(120);
    expect(await venue.floorCellsCount()).toBe(0);
    await expect(venue.sizeError).toHaveCount(0);
  });

  test("AC6: invalid resize input shows Traditional Chinese error and leaves grid untouched", async () => {
    await venue.clickCell(0, 0);

    // Zero.
    await venue.resize("0", "10");
    await expect(venue.sizeError).toBeVisible();
    expect(await venue.sizeError.textContent()).toContain("公尺");
    expect(await venue.allCellsCount()).toBe(100);
    expect(await venue.cellState(0, 0)).toBe("floor"); // untouched by rejected resize

    // Non-numeric.
    await venue.resize("abc", "10");
    await expect(venue.sizeError).toBeVisible();
    expect(await venue.allCellsCount()).toBe(100);

    // Exceeds per-dimension max (51).
    await venue.resize("51", "10");
    await expect(venue.sizeError).toBeVisible();
    expect(await venue.sizeError.textContent()).toMatch(/50/);
    expect(await venue.allCellsCount()).toBe(100);

    // Still floor cell preserved since none of the above resizes applied.
    expect(await venue.cellState(0, 0)).toBe("floor");
  });

  test("AC7: 2500-cell cap — 50x50 accepted, exceeding total cap rejected", async () => {
    await venue.resize("50", "50");
    await expect(venue.sizeError).toHaveCount(0);
    expect(await venue.allCellsCount()).toBe(2500);

    // 50x51 exceeds both the per-dimension (50) and total (2500) cap.
    await venue.resize("50", "51");
    await expect(venue.sizeError).toBeVisible();
    expect(await venue.sizeError.textContent()).toMatch(/50|2,?500/);
    // Grid remains at the last valid size (50x50), not reduced/changed.
    expect(await venue.allCellsCount()).toBe(2500);
  });

  test("AC8: non-contiguous painting — two separate areas both preserved independently", async () => {
    await venue.dragPaint(0, 0, 2, 0);
    await venue.dragPaint(7, 7, 9, 7);

    for (let x = 0; x <= 2; x++) {
      expect(await venue.cellState(x, 0)).toBe("floor");
    }
    for (let x = 7; x <= 9; x++) {
      expect(await venue.cellState(x, 7)).toBe("floor");
    }
    // The gap between the two strokes remains empty (no auto-fill/connect).
    expect(await venue.cellState(4, 4)).toBe("empty");
    expect(await venue.floorCellsCount()).toBe(6);
  });

  test("AC9: reload does not persist prior grid state", async ({ page }) => {
    await venue.clickCell(3, 3);
    expect(await venue.floorCellsCount()).toBe(1);

    await page.reload();
    await page.waitForLoadState("networkidle");

    expect(await venue.allCellsCount()).toBe(100);
    expect(await venue.floorCellsCount()).toBe(0);
  });
});
