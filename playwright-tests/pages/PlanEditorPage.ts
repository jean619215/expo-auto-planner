import type { Page, Locator } from "@playwright/test";

export interface PlanPoint {
  x: number;
  y: number;
}

// Page object for the Konva-based floor-plan editor at /venue.
//
// The canvas itself has no per-shape DOM, so the wrapper div
// (data-testid="plan-editor") exposes live state as data attributes:
//   data-vertex-count, data-vertices (JSON, meter coordinates),
//   data-px-per-meter, data-stage-size.
// This page object owns the meter -> screen-pixel math (see
// src/components/venue/PlanEditor.tsx: the Stage has no margin/offset —
// meter (0,0) maps directly to the wrapper div's top-left corner, scaled
// by data-px-per-meter) and drives all interactions via page.mouse at the
// computed canvas coordinates.
export class PlanEditorPage {
  readonly page: Page;
  readonly editor: Locator;
  readonly canvas: Locator;

  constructor(page: Page) {
    this.page = page;
    this.editor = page.locator('[data-testid="plan-editor"]');
    this.canvas = this.editor.locator("canvas").first();
  }

  async navigate() {
    await this.page.goto("/venue");
    await this.page.waitForLoadState("networkidle");
    await this.editor.waitFor({ state: "visible" });
  }

  async vertexCount(): Promise<number> {
    const raw = await this.editor.getAttribute("data-vertex-count");
    return Number(raw);
  }

  async vertices(): Promise<PlanPoint[]> {
    const raw = await this.editor.getAttribute("data-vertices");
    return JSON.parse(raw ?? "[]");
  }

  async pxPerMeter(): Promise<number> {
    const raw = await this.editor.getAttribute("data-px-per-meter");
    return Number(raw);
  }

  async stageSize(): Promise<number> {
    const raw = await this.editor.getAttribute("data-stage-size");
    return Number(raw);
  }

  /** Bounding box of the wrapper div, which is also the Stage's origin (no extra offset/margin). */
  private async containerBox() {
    const box = await this.editor.boundingBox();
    if (!box) throw new Error("plan-editor container not visible");
    return box;
  }

  /** Convert a meter-space point to absolute screen coordinates for page.mouse.* calls. */
  async meterToScreen(meter: PlanPoint): Promise<PlanPoint> {
    const [box, ppm] = await Promise.all([
      this.containerBox(),
      this.pxPerMeter(),
    ]);
    return {
      x: box.x + meter.x * ppm,
      y: box.y + meter.y * ppm,
    };
  }

  /** Drag the vertex currently at `index` to the given meter-space target. */
  async dragVertexTo(index: number, targetMeter: PlanPoint) {
    const verts = await this.vertices();
    const start = await this.meterToScreen(verts[index]);
    const end = await this.meterToScreen(targetMeter);

    await this.page.mouse.move(start.x, start.y);
    await this.page.mouse.down();
    await this.page.mouse.move(end.x, end.y, { steps: 8 });
    await this.page.mouse.up();
  }

  /** Double-click at a meter-space point (used for edge-insertion / interior no-op checks). */
  async doubleClickAt(meter: PlanPoint) {
    const pt = await this.meterToScreen(meter);
    await this.page.mouse.dblclick(pt.x, pt.y);
  }

  /** Right-click the vertex currently at `index` (deletion gesture). */
  async rightClickVertex(index: number) {
    const verts = await this.vertices();
    const pt = await this.meterToScreen(verts[index]);
    await this.page.mouse.click(pt.x, pt.y, { button: "right" });
  }
}
