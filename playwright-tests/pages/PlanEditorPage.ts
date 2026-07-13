import type { Page, Locator } from "@playwright/test";

export interface PlanPoint {
  x: number;
  y: number;
}

export interface WallSegment {
  id: string;
  start: PlanPoint;
  end: PlanPoint;
}

export interface Column {
  id: string;
  center: PlanPoint;
  w: number;
  h: number;
}

export interface PlanObjects {
  walls: WallSegment[];
  columns: Column[];
}

export type EditorMode = "select" | "wall" | "column";

// Page object for the Konva-based floor-plan editor at /venue.
//
// The canvas itself has no per-shape DOM, so the wrapper div
// (data-testid="plan-editor") exposes live state as data attributes:
//   data-vertex-count, data-vertices (JSON, meter coordinates),
//   data-px-per-meter, data-stage-size, data-mode, data-wall-count,
//   data-column-count, data-selected-id, data-selected-type,
//   data-objects (JSON, meter coordinates: { walls, columns }).
//   data-column-label (Task 3, current selected/dragging column "W x H m"
//   label text or ""), data-wall-label (Task 3, current selected/dragging
//   wall "L m" label text or ""), data-edge-labels (Task 3, JSON array of
//   always-on floor edge-length label strings, in polygon edge order).
// This page object owns the meter -> screen-pixel math (see
// src/components/venue/PlanEditor.tsx: the Stage has no margin/offset —
// meter (0,0) maps directly to the wrapper div's top-left corner, scaled
// by data-px-per-meter) and drives all interactions via page.mouse at the
// computed canvas coordinates. Note: a single <Stage> still renders as a
// single <canvas> — the new toolbar (PlanToolbar.tsx) is plain DOM,
// addressed by its own data-testid attributes below.
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

  /**
   * Bounding box of the <canvas> (the Stage's origin, no extra offset/margin).
   * Anchored on the canvas rather than the wrapper div because the Task 2
   * toolbar (PlanToolbar.tsx) renders above the Stage inside the same
   * wrapper — the wrapper's top-left no longer coincides with meter (0,0).
   */
  private async containerBox() {
    const box = await this.canvas.boundingBox();
    if (!box) throw new Error("plan-editor canvas not visible");
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

  // --- Task 2: object system (walls / columns) -----------------------------

  async mode(): Promise<EditorMode> {
    const raw = await this.editor.getAttribute("data-mode");
    return (raw ?? "select") as EditorMode;
  }

  async wallCount(): Promise<number> {
    const raw = await this.editor.getAttribute("data-wall-count");
    return Number(raw);
  }

  async columnCount(): Promise<number> {
    const raw = await this.editor.getAttribute("data-column-count");
    return Number(raw);
  }

  async selectedId(): Promise<string> {
    return (await this.editor.getAttribute("data-selected-id")) ?? "";
  }

  async selectedType(): Promise<string> {
    return (await this.editor.getAttribute("data-selected-type")) ?? "";
  }

  async objects(): Promise<PlanObjects> {
    const raw = await this.editor.getAttribute("data-objects");
    return JSON.parse(raw ?? '{"walls":[],"columns":[]}');
  }

  async selectTool() {
    await this.page.locator('[data-testid="tool-select"]').click();
  }

  async wallTool() {
    await this.page.locator('[data-testid="tool-wall"]').click();
  }

  async columnTool() {
    await this.page.locator('[data-testid="tool-column"]').click();
  }

  async clickDelete() {
    await this.page.locator('[data-testid="tool-delete"]').click();
  }

  /** Draw a wall via click-drag from `startMeter` to `endMeter` (must be in 牆壁 mode). */
  async drawWall(startMeter: PlanPoint, endMeter: PlanPoint) {
    const start = await this.meterToScreen(startMeter);
    const end = await this.meterToScreen(endMeter);

    await this.page.mouse.move(start.x, start.y);
    await this.page.mouse.down();
    await this.page.mouse.move(end.x, end.y, { steps: 8 });
    await this.page.mouse.up();
  }

  /** Place a column (or select/deselect) via a single click at a meter-space point. */
  async clickAt(meter: PlanPoint) {
    const pt = await this.meterToScreen(meter);
    await this.page.mouse.click(pt.x, pt.y);
  }

  /** Place a column via a single click at a meter-space point (must be in 柱子 mode). */
  async placeColumn(meter: PlanPoint) {
    await this.clickAt(meter);
  }

  /** Press-drag a selected object's body from one meter-space point to another. */
  async dragObjectBody(fromMeter: PlanPoint, toMeter: PlanPoint) {
    const start = await this.meterToScreen(fromMeter);
    const end = await this.meterToScreen(toMeter);

    await this.page.mouse.move(start.x, start.y);
    await this.page.mouse.down();
    await this.page.mouse.move(end.x, end.y, { steps: 8 });
    await this.page.mouse.up();
  }

  /**
   * Drag one endpoint of the given wall (by id) to a new meter-space point.
   * `steps` controls interpolation granularity of the intermediate mouse
   * moves (default 8); pass 1 for a direct single-jump drag, useful when a
   * test wants the final drop point to be the only position evaluated
   * (e.g. asserting revert-on-reject behavior against a known prior point).
   */
  async dragWallEndpoint(
    wallId: string,
    which: "start" | "end",
    toMeter: PlanPoint,
    steps = 8,
  ) {
    const { walls } = await this.objects();
    const wall = walls.find((w) => w.id === wallId);
    if (!wall) throw new Error(`wall ${wallId} not found`);
    const start = await this.meterToScreen(wall[which]);
    const end = await this.meterToScreen(toMeter);

    await this.page.mouse.move(start.x, start.y);
    await this.page.mouse.down();
    await this.page.mouse.move(end.x, end.y, { steps });
    await this.page.mouse.up();
  }

  /** Press Delete/Backspace (focuses the editor first so the keydown handler fires). */
  async pressDelete() {
    await this.editor.focus();
    await this.page.keyboard.press("Delete");
  }

  // --- Task 3: resize handles / dimension labels ----------------------------

  /** Current column dimension label text ("W x H m"), or "" if none visible. */
  async columnLabel(): Promise<string> {
    return (await this.editor.getAttribute("data-column-label")) ?? "";
  }

  /** Current wall dimension label text ("L m"), or "" if none visible. */
  async wallLabel(): Promise<string> {
    return (await this.editor.getAttribute("data-wall-label")) ?? "";
  }

  /** Always-on floor edge-length label strings, in polygon edge order. */
  async edgeLabels(): Promise<string[]> {
    const raw = await this.editor.getAttribute("data-edge-labels");
    return JSON.parse(raw ?? "[]");
  }

  /**
   * Drag one corner handle of the given column (by id) to a new meter-space
   * point. `corner` identifies the bounding-box corner being dragged, same
   * sign-pair convention as `resizeColumnCorner` in plan.ts
   * (x: -1 = left, +1 = right; y: -1 = top, +1 = bottom). `steps` controls
   * interpolation granularity (default 8); pass 1 for a direct single-jump
   * drag when only the final drop point should be evaluated.
   */
  async dragColumnCorner(
    columnId: string,
    corner: { x: -1 | 1; y: -1 | 1 },
    toMeter: PlanPoint,
    steps = 8,
  ) {
    const { columns } = await this.objects();
    const column = columns.find((c) => c.id === columnId);
    if (!column) throw new Error(`column ${columnId} not found`);
    const fromMeter = {
      x: column.center.x + (corner.x * column.w) / 2,
      y: column.center.y + (corner.y * column.h) / 2,
    };
    const start = await this.meterToScreen(fromMeter);
    const end = await this.meterToScreen(toMeter);

    await this.page.mouse.move(start.x, start.y);
    await this.page.mouse.down();
    await this.page.mouse.move(end.x, end.y, { steps });
    await this.page.mouse.up();
  }
}
