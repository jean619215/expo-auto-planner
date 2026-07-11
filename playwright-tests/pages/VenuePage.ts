import type { Page, Locator } from "@playwright/test";

/**
 * Page object for src/app/venue/page.tsx (GridEditor).
 *
 * The grid has no per-cell data-testid (100-2500 cells would make that
 * unwieldy) — cells are addressed via data-x / data-y attributes on
 * children of the `venue-grid` container instead, which the developer
 * added specifically as Playwright hooks.
 */
export class VenuePage {
  readonly page: Page;
  readonly grid: Locator;
  readonly widthInput: Locator;
  readonly heightInput: Locator;
  readonly applyButton: Locator;
  readonly sizeError: Locator;
  readonly toolbar: Locator;
  readonly toolFloor: Locator;
  readonly toolWall: Locator;
  readonly toolColumn: Locator;
  readonly toolEraser: Locator;

  constructor(page: Page) {
    this.page = page;
    this.grid = page.getByTestId("venue-grid");
    this.widthInput = page.getByTestId("grid-width-input");
    this.heightInput = page.getByTestId("grid-height-input");
    this.applyButton = page.getByTestId("grid-resize-apply");
    this.sizeError = page.getByTestId("grid-size-error");
    this.toolbar = page.getByTestId("venue-toolbar");
    this.toolFloor = page.getByTestId("tool-floor");
    this.toolWall = page.getByTestId("tool-wall");
    this.toolColumn = page.getByTestId("tool-column");
    this.toolEraser = page.getByTestId("tool-eraser");
  }

  /** Select a tool from the toolbar by its data-testid ("tool-wall" etc). */
  async selectTool(testId: "tool-floor" | "tool-wall" | "tool-column" | "tool-eraser") {
    await this.page.getByTestId(testId).click();
  }

  /** aria-pressed value ("true"/"false") for a given toolbar button. */
  async toolPressed(testId: "tool-floor" | "tool-wall" | "tool-column" | "tool-eraser") {
    return this.page.getByTestId(testId).getAttribute("aria-pressed");
  }

  async navigate() {
    await this.page.goto("/venue");
    await this.page.waitForLoadState("networkidle");
  }

  cell(x: number, y: number): Locator {
    return this.grid.locator(`[data-x="${x}"][data-y="${y}"]`);
  }

  async cellState(x: number, y: number): Promise<string | null> {
    return this.cell(x, y).getAttribute("data-cell-state");
  }

  async allCellsCount(): Promise<number> {
    return this.grid.locator("[data-cell-state]").count();
  }

  async floorCellsCount(): Promise<number> {
    return this.grid.locator('[data-cell-state="floor"]').count();
  }

  async clickCell(x: number, y: number) {
    await this.cell(x, y).click();
  }

  async resize(width: string, height: string) {
    await this.widthInput.fill(width);
    await this.heightInput.fill(height);
    await this.applyButton.click();
  }

  /** Bounding box (page coords) for a given cell, for raw mouse drag sequences. */
  async cellCenter(x: number, y: number): Promise<{ x: number; y: number }> {
    const box = await this.cell(x, y).boundingBox();
    if (!box) throw new Error(`cell (${x},${y}) not found / not visible`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  /**
   * Drag-paint from (x1,y1) to (x2,y2) along a straight line (same row or
   * same column) using raw mouse events — the implementation releases
   * pointer capture on pointerdown specifically so pointerenter fires on
   * cells during a real drag, but Playwright's `dragTo`/locator APIs don't
   * produce that pointer sequence faithfully, so we drive page.mouse
   * directly instead.
   */
  async dragPaint(x1: number, y1: number, x2: number, y2: number) {
    const start = await this.cellCenter(x1, y1);
    await this.page.mouse.move(start.x, start.y);
    await this.page.mouse.down();

    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let i = 1; i <= steps; i++) {
      const x = x1 + Math.round(((x2 - x1) * i) / steps);
      const y = y1 + Math.round(((y2 - y1) * i) / steps);
      const p = await this.cellCenter(x, y);
      await this.page.mouse.move(p.x, p.y);
    }
    await this.page.mouse.up();
  }
}
