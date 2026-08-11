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

// task 3 (procedural PBR materials) — mirrors
// RefinedSceneProbe.tsx's MaterialProbeReport shape. Kept independent of
// the app source (same convention as PlanPoint/WallSegment/Column above)
// rather than imported, since page objects only know the DOM contract.
export interface TextureDiagnostics {
  present: boolean;
  width: number | null;
  wrapS: string | null;
  wrapT: string | null;
  minFilter: string | null;
  magFilter: string | null;
  anisotropy: number | null;
  // Renderer-reality anisotropy (`gl.properties.get(texture).__currentAnisotropy`,
  // review-report.md Issue 1) — distinct from `anisotropy` above, which is
  // only the JS property the app requested.
  anisotropyGpu: number | null;
  colorSpace: string | null;
  generateMipmaps: boolean | null;
  channel: number | null;
  repeatX: number | null;
}

export interface SurfaceTextureDiagnostics {
  map: TextureDiagnostics;
  normalMap: TextureDiagnostics;
  roughnessMap: TextureDiagnostics | null;
  aoMap: TextureDiagnostics | null;
  materialColorHex: string;
  normalScaleX: number;
}

// task 5 (imported furniture models) — mirrors furnitureModels.tsx's
// FurnitureModelReport shape. Kept independent of the app source (same
// convention as the material types below).
export interface FurnitureModelReport {
  kind: string;
  /**
   * 等比縮放倍率。**單一數字**這件事本身就是「三軸同倍率、沒有非等比拉伸」
   * 的證據 —— 非等比縮放無法用一個純量表示(AGENTS.md 的家具尺寸規則)。
   */
  scale: number;
  /** 縮放後的實際包圍盒尺寸(公尺,已套用模型方位修正 rotationY)。 */
  fittedM: [number, number, number];
  /** `FURNITURE_DEFAULTS` 的目標尺寸(公尺)。 */
  targetM: [number, number, number];
  /** 這個 kind 被拆成幾個 instanced mesh(GLB 內的 mesh 數)。 */
  partCount: number;
  /** 目前場上這個 kind 有幾件。 */
  instanceCount: number;
}

// task 6 (procedural exhibition furniture) — mirrors proceduralFurniture.tsx's
// ProceduralFurnitureReport shape.
export interface ProceduralFurnitureReport {
  kind: string;
  /** 程序化零件拼出來的實際外廓(公尺)。 */
  sizeM: [number, number, number];
  /** `FURNITURE_DEFAULTS` 的標稱尺寸(公尺)。 */
  targetM: [number, number, number];
  /** 這件家具由幾個零件組成。 */
  partCount: number;
  /** 目前場上這個 kind 有幾件。 */
  instanceCount: number;
}

/** task 6 — 程序化家具的存活資源計數(`data-procedural-furniture-stats`)。 */
export interface ProceduralFurnitureStats {
  liveGeometries: number;
  liveMaterials: number;
  totalBuilds: number;
}

/** Mirrors `src/components/venue/furnitureModelStats.ts`. */
export interface FurnitureModelStats {
  liveGeometries: number;
  totalBuilds: number;
  cachedKinds: number;
}

export interface AlbedoReadback {
  mean: number;
  max: number;
  variance: number;
  seamDelta: number;
  adjacentDelta: number;
}

export interface NormalReadback {
  meanZ: number;
  varianceXY: number;
}

export interface MaterialProbeReport {
  ready: boolean;
  maxAnisotropy: number | null;
  floor: SurfaceTextureDiagnostics | null;
  wall: SurfaceTextureDiagnostics | null;
  column: SurfaceTextureDiagnostics | null;
  floorAlbedo: AlbedoReadback | null;
  floorNormal: NormalReadback | null;
  wallAlbedo: AlbedoReadback | null;
  floorUvMeterError: number | null;
  wallUvMeterError: number | null;
  liveSurfaceTargets: number | null;
  totalSurfaceBakes: number | null;
}

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
// This page object owns the meter -> screen-pixel math and drives all
// interactions via page.mouse at the computed canvas coordinates. Note: a
// single <Stage> still renders as a single <canvas> — the toolbar
// (PlanToolbar.tsx) is plain DOM, addressed by its own data-testid
// attributes below.
//
// Two coordinate layers (architect-plan.md "兩層座標系職責分界"):
//   meters -> world px, via data-px-per-meter (unaffected by zoom/pan)
//   world px -> screen px, via the Stage's own scale/position transform
//   (data-stage-scale/data-stage-x/data-stage-y), driven by wheel/buttons/
//   drag pan. meterToScreen() below composes both layers; at the default
//   view (scale=1, x=0, y=0) it degenerates to the original formula, so all
//   existing call sites are transform-aware with zero changes.
//
// Task 5 (2-step wizard): the wrapper's children are now split into two
// mutually exclusive containers, [data-testid="step-edit"] (toolbar +
// next-step-button + the Konva <Stage>) and [data-testid="step-preview"]
// (back-to-edit-button + the 3D VenueSceneLoader/VenueScene), gated by
// data-step on the wrapper. Only one is ever mounted at a time. The
// existing containerBox()/canvas-based helpers (meterToScreen,
// dragVertexTo, drawWall, etc.) still work exactly as before since exactly
// one <canvas> exists whenever step-edit is mounted — but callers MUST
// ensure they're in step === "edit" before calling any of them, since the
// canvas does not exist at all while step === "preview". Bugfix (QA loop
// iteration 1): `tabIndex`/`onKeyDown` (the Delete/Backspace handler) now
// live on `step-edit` itself, not the outer `plan-editor` wrapper — this
// structurally prevents Delete/Backspace from ever reaching the 2D-object
// deletion logic while Step 2 is mounted (previously a stale
// selectedObject/selectedVertex from Step 1 could be deleted via a keypress
// while looking at the 3D preview). `pressDelete()` below focuses
// `stepEdit`, not `editor`, accordingly.
//
// venue-refined-3d task (3-step wizard): the wizard now has a third
// mutually exclusive container, [data-testid="step-refined"] (
// back-to-preview-button + the read-only RefinedSceneLoader/RefinedScene,
// [data-testid="refined-scene"]). Same "exactly one container mounted"
// rule applies. `refinedScene` is a distinct locator from `scene` —
// `scene` always addresses the step-02 `venue-scene`, `refinedScene`
// always addresses the step-03 `refined-scene`; they are never both
// mounted at once so this only matters for readability/intent. The AI
// panel now lives inside a permanently-mounted wrapper,
// [data-testid="ai-panel-slot"], whose class toggles between `contents`
// (steps 01/02, no layout impact) and `hidden` (step 03) — the panel
// itself is never unmounted across steps.
export class PlanEditorPage {
  readonly page: Page;
  readonly editor: Locator;
  readonly canvas: Locator;
  readonly nextStepButton: Locator;
  readonly backToEditButton: Locator;
  readonly stepEdit: Locator;
  readonly stepPreview: Locator;
  readonly scene: Locator;
  readonly toRefinedButton: Locator;
  readonly backToPreviewButton: Locator;
  readonly stepRefined: Locator;
  readonly refinedScene: Locator;
  readonly aiPanelSlot: Locator;

  constructor(page: Page) {
    this.page = page;
    this.editor = page.locator('[data-testid="plan-editor"]');
    this.canvas = this.editor.locator("canvas").first();
    this.nextStepButton = page.locator('[data-testid="next-step-button"]');
    this.backToEditButton = page.locator('[data-testid="back-to-edit-button"]');
    this.stepEdit = page.locator('[data-testid="step-edit"]');
    this.stepPreview = page.locator('[data-testid="step-preview"]');
    this.scene = page.locator('[data-testid="venue-scene"]');
    this.toRefinedButton = page.locator('[data-testid="to-refined-button"]');
    this.backToPreviewButton = page.locator(
      '[data-testid="back-to-preview-button"]',
    );
    this.stepRefined = page.locator('[data-testid="step-refined"]');
    this.refinedScene = page.locator('[data-testid="refined-scene"]');
    this.aiPanelSlot = page.locator('[data-testid="ai-panel-slot"]');
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

  /** Current Stage zoom scale (`data-stage-scale`), 1 = default view. */
  async stageScale(): Promise<number> {
    const raw = await this.editor.getAttribute("data-stage-scale");
    return Number(raw);
  }

  /** Current Stage pan position in world px (`data-stage-x`/`data-stage-y`). */
  async stagePosition(): Promise<PlanPoint> {
    const [x, y] = await Promise.all([
      this.editor.getAttribute("data-stage-x"),
      this.editor.getAttribute("data-stage-y"),
    ]);
    return { x: Number(x), y: Number(y) };
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
    const [box, ppm, scale, pos] = await Promise.all([
      this.containerBox(),
      this.pxPerMeter(),
      this.stageScale(),
      this.stagePosition(),
    ]);
    return {
      x: box.x + pos.x + meter.x * ppm * scale,
      y: box.y + pos.y + meter.y * ppm * scale,
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

  /** Number of furniture items on the plan (`data-furniture-count`). */
  async furnitureCount(): Promise<number> {
    const raw = await this.editor.getAttribute("data-furniture-count");
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

  /**
   * Press Delete/Backspace (focuses the Step 1 container first so the
   * keydown handler fires). Task 5 scoped `tabIndex`/`onKeyDown` to
   * `[data-testid="step-edit"]` (not the outer `plan-editor` wrapper), so
   * that Delete/Backspace can only ever fire while Step 1 is mounted. Only
   * call this while `step === "edit"` — `stepEdit` does not exist in Step 2.
   */
  async pressDelete() {
    await this.stepEdit.focus();
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

  // --- Task 4: 3D whitebox scene ---------------------------------------

  /** Whether a 3D scene has ever been generated (`data-scene-generated` on the wrapper). */
  async sceneGenerated(): Promise<boolean> {
    const raw = await this.editor.getAttribute("data-scene-generated");
    return raw === "true";
  }

  /** Generation counter (`data-generation` on the wrapper), increments every click. */
  async generationCount(): Promise<number> {
    const raw = await this.editor.getAttribute("data-generation");
    return Number(raw);
  }

  /** Wall mesh count of the currently mounted `[data-testid="venue-scene"]`. */
  async sceneWallMeshCount(): Promise<number> {
    const raw = await this.scene.getAttribute("data-wall-mesh-count");
    return Number(raw);
  }

  /** Column mesh count of the currently mounted `[data-testid="venue-scene"]`. */
  async sceneColumnMeshCount(): Promise<number> {
    const raw = await this.scene.getAttribute("data-column-mesh-count");
    return Number(raw);
  }

  /** Floor polygon vertex count of the currently mounted `[data-testid="venue-scene"]`. */
  async sceneFloorVertexCount(): Promise<number> {
    const raw = await this.scene.getAttribute("data-floor-vertex-count");
    return Number(raw);
  }

  // --- Task 5: 2-step wizard (edit <-> preview) + OrbitControls --------

  /** Click "下一步" — generates the 3D scene from current 2D state and advances to Step 2. */
  async clickNextStep() {
    await this.nextStepButton.click();
  }

  /** Click "返回編輯" — returns to Step 1 without touching 2D plan state. */
  async clickBackToEdit() {
    await this.backToEditButton.click();
  }

  /** Current wizard step (`data-step` on the wrapper). */
  async currentStep(): Promise<"edit" | "preview" | "refined"> {
    const raw = await this.editor.getAttribute("data-step");
    return (raw ?? "edit") as "edit" | "preview" | "refined";
  }

  /** Whether `data-orbit-controls="true"` is present on the mounted 3D scene. */
  async orbitControlsPresent(): Promise<boolean> {
    const raw = await this.scene.getAttribute("data-orbit-controls");
    return raw === "true";
  }

  // --- venue-refined-3d task: step 03 (read-only RefinedScene) ---------

  /** Click "下一步" on step-preview — advances from Step 2 to Step 3. */
  async clickToRefined() {
    await this.toRefinedButton.click();
  }

  /** Click "上一步" on step-refined — returns from Step 3 to Step 2. */
  async clickBackToPreview() {
    await this.backToPreviewButton.click();
  }

  async goToRefined() {
    await this.clickToRefined();
    await this.stepRefined.waitFor({ state: "visible" });
  }

  async backToPreview() {
    await this.clickBackToPreview();
    await this.stepPreview.waitFor({ state: "visible" });
  }

  /** Wall mesh count of the currently mounted `[data-testid="refined-scene"]`. */
  async refinedWallMeshCount(): Promise<number> {
    const raw = await this.refinedScene.getAttribute("data-wall-mesh-count");
    return Number(raw);
  }

  /** Column mesh count of the currently mounted `[data-testid="refined-scene"]`. */
  async refinedColumnMeshCount(): Promise<number> {
    const raw = await this.refinedScene.getAttribute("data-column-mesh-count");
    return Number(raw);
  }

  /** Furniture mesh count of the currently mounted `[data-testid="refined-scene"]`. */
  async refinedFurnitureMeshCount(): Promise<number> {
    const raw = await this.refinedScene.getAttribute(
      "data-furniture-mesh-count",
    );
    return Number(raw);
  }

  /** Floor polygon vertex count of the currently mounted `[data-testid="refined-scene"]`. */
  async refinedFloorVertexCount(): Promise<number> {
    const raw = await this.refinedScene.getAttribute("data-floor-vertex-count");
    return Number(raw);
  }

  // --- venue-refined-3d task 2: lighting/shadow diagnostics ------------
  //
  // All values below are read from `[data-testid="refined-scene"]`'s
  // `data-*` attributes, which are populated from the scene probe's
  // report of the *actual* renderer/scene state (architect-plan.md D8) —
  // not source-code literals. `refinedLightingReady()` gates the others:
  // wait for it to be `true` before reading any other diagnostic getter.

  /** Whether the scene probe has reported at least once (`data-lighting-ready`). */
  async refinedLightingReady(): Promise<boolean> {
    const raw = await this.refinedScene.getAttribute("data-lighting-ready");
    return raw === "true";
  }

  /** Total light count in the step-03 scene (`data-light-count`). */
  async refinedLightCount(): Promise<number> {
    const raw = await this.refinedScene.getAttribute("data-light-count");
    return Number(raw);
  }

  /** Count of lights with `castShadow=true` (`data-shadow-casting-light-count`). */
  async refinedShadowCastingLightCount(): Promise<number> {
    const raw = await this.refinedScene.getAttribute(
      "data-shadow-casting-light-count",
    );
    return Number(raw);
  }

  /** Count of meshes with `castShadow=true` (`data-shadow-caster-mesh-count`). */
  async refinedShadowCasterMeshCount(): Promise<number> {
    const raw = await this.refinedScene.getAttribute(
      "data-shadow-caster-mesh-count",
    );
    return Number(raw);
  }

  /**
   * Shadow-casting **item** counts by category (`data-shadow-caster-{wall,
   * column,furniture}-count`).
   *
   * Prefer these over `refinedShadowCasterMeshCount()` for AC2: since task 5
   * imports real GLBs, mesh count and item count diverge — N items of one
   * kind share a single `InstancedMesh`, and a multi-mesh GLB (cabinet: 5)
   * becomes that many `InstancedMesh`es.
   */
  async refinedShadowCasterWallCount(): Promise<number> {
    const raw = await this.refinedScene.getAttribute(
      "data-shadow-caster-wall-count",
    );
    return Number(raw);
  }

  async refinedShadowCasterColumnCount(): Promise<number> {
    const raw = await this.refinedScene.getAttribute(
      "data-shadow-caster-column-count",
    );
    return Number(raw);
  }

  async refinedShadowCasterFurnitureCount(): Promise<number> {
    const raw = await this.refinedScene.getAttribute(
      "data-shadow-caster-furniture-count",
    );
    return Number(raw);
  }

  /** Whether `gl.shadowMap.enabled` (`data-shadows-enabled`). */
  async refinedShadowsEnabled(): Promise<boolean> {
    const raw = await this.refinedScene.getAttribute("data-shadows-enabled");
    return raw === "true";
  }

  /** Shadow map mechanism label, e.g. `"VSM"` (`data-shadow-map-type`). */
  async refinedShadowMapType(): Promise<string> {
    return (await this.refinedScene.getAttribute("data-shadow-map-type")) ?? "";
  }

  /** Configured key-light shadow map size (`data-shadow-map-size`). */
  async refinedShadowMapSize(): Promise<number> {
    const raw = await this.refinedScene.getAttribute("data-shadow-map-size");
    return Number(raw);
  }

  /** Actual allocated `shadow.map` width — only set once a shadow pass has run (`data-shadow-map-allocated-width`). */
  async refinedShadowMapAllocatedWidth(): Promise<number> {
    const raw = await this.refinedScene.getAttribute(
      "data-shadow-map-allocated-width",
    );
    return Number(raw);
  }

  /** Key light's shadow camera frustum span in meters (`data-shadow-camera-span-m`). */
  async refinedShadowCameraSpanM(): Promise<number> {
    const raw = await this.refinedScene.getAttribute("data-shadow-camera-span-m");
    return Number(raw);
  }

  /** Key light's shadow camera near plane in meters (`data-shadow-camera-near-m`). */
  async refinedShadowCameraNearM(): Promise<number> {
    const raw = await this.refinedScene.getAttribute("data-shadow-camera-near-m");
    return Number(raw);
  }

  /** Key light's shadow camera far plane in meters (`data-shadow-camera-far-m`). */
  async refinedShadowCameraFarM(): Promise<number> {
    const raw = await this.refinedScene.getAttribute("data-shadow-camera-far-m");
    return Number(raw);
  }

  /** `gl.toneMapping` label, e.g. `"ACESFilmic"` (`data-tone-mapping`). */
  async refinedToneMapping(): Promise<string> {
    return (await this.refinedScene.getAttribute("data-tone-mapping")) ?? "";
  }

  /** `gl.toneMappingExposure`, formatted to 2 decimals (`data-tone-mapping-exposure`). */
  async refinedToneMappingExposure(): Promise<number> {
    const raw = await this.refinedScene.getAttribute("data-tone-mapping-exposure");
    return Number(raw);
  }

  /** `gl.outputColorSpace`, e.g. `"srgb"` (`data-output-color-space`). */
  async refinedOutputColorSpace(): Promise<string> {
    return (await this.refinedScene.getAttribute("data-output-color-space")) ?? "";
  }

  /** Whether `scene.environment` is set (`data-environment-set`). */
  async refinedEnvironmentSet(): Promise<boolean> {
    const raw = await this.refinedScene.getAttribute("data-environment-set");
    return raw === "true";
  }

  /** The floor mesh's actual `receiveShadow` flag, read off the scene (`data-floor-receives-shadow`). */
  async refinedFloorReceivesShadow(): Promise<boolean> {
    const raw = await this.refinedScene.getAttribute("data-floor-receives-shadow");
    return raw === "true";
  }

  /** The floor mesh's actual `castShadow` flag — must stay false (`data-floor-casts-shadow`). */
  async refinedFloorCastsShadow(): Promise<boolean> {
    const raw = await this.refinedScene.getAttribute("data-floor-casts-shadow");
    return raw === "true";
  }

  /** `gl.info.memory.textures` (`data-renderer-textures`) — for round-trip leak checks. */
  async refinedRendererTextures(): Promise<number> {
    const raw = await this.refinedScene.getAttribute("data-renderer-textures");
    return Number(raw);
  }

  /** `gl.info.memory.geometries` (`data-renderer-geometries`) — for round-trip leak checks. */
  async refinedRendererGeometries(): Promise<number> {
    const raw = await this.refinedScene.getAttribute("data-renderer-geometries");
    return Number(raw);
  }

  // --- venue-refined-3d task 3: procedural PBR material diagnostics ----
  //
  // `refinedMaterialsReady()` mirrors the `data-materials-ready` attribute
  // set directly by RefinedScene.tsx from SurfaceMaterials' `onReady`
  // callback (renderer-config state, not scene-probe-derived). The rest of
  // the fields come from the scene probe's `MaterialProbeReport` (real
  // material/texture instances + `gl.readRenderTargetPixels()` readback),
  // JSON-encoded onto `data-material-diagnostics` (same convention as
  // `data-objects`/`data-vertices` above).

  /** Whether SurfaceMaterials has committed its baked materials (`data-materials-ready`). */
  async refinedMaterialsReady(): Promise<boolean> {
    const raw = await this.refinedScene.getAttribute("data-materials-ready");
    return raw === "true";
  }

  /** Parsed `data-material-diagnostics` — see `MaterialProbeReport` above. */
  async refinedMaterialDiagnostics(): Promise<MaterialProbeReport> {
    const raw = await this.refinedScene.getAttribute("data-material-diagnostics");
    return JSON.parse(raw ?? "null") as MaterialProbeReport;
  }

  // --- venue-refined-3d task 5: imported furniture model diagnostics ----
  //
  // GLB 載入是非同步的(fetch + Draco worker 解碼),完成時間遠晚於
  // `data-lighting-ready`。任何會讀到家具的斷言都必須先等
  // `refinedFurnitureModelsLoaded()`,否則讀到的是「還沒有家具」的場景。

  /** Whether the eager furniture-model `<Suspense>` boundary has committed (`data-furniture-models-loaded`). */
  async refinedFurnitureModelsLoaded(): Promise<boolean> {
    const raw = await this.refinedScene.getAttribute(
      "data-furniture-models-loaded",
    );
    return raw === "true";
  }

  /** Parsed `data-furniture-model-reports` — one entry per kind currently on the plan. */
  async refinedFurnitureModelReports(): Promise<FurnitureModelReport[]> {
    const raw = await this.refinedScene.getAttribute(
      "data-furniture-model-reports",
    );
    return JSON.parse(raw ?? "[]") as FurnitureModelReport[];
  }

  /** The single report for `kind`, or `undefined` if that kind isn't drawn from a model. */
  async refinedFurnitureModelReport(
    kind: string,
  ): Promise<FurnitureModelReport | undefined> {
    const reports = await this.refinedFurnitureModelReports();
    return reports.find((report) => report.kind === kind);
  }

  /** Parsed `data-furniture-procedural-reports` — one entry per procedurally-drawn kind on the plan. */
  async refinedProceduralFurnitureReports(): Promise<ProceduralFurnitureReport[]> {
    const raw = await this.refinedScene.getAttribute(
      "data-furniture-procedural-reports",
    );
    return JSON.parse(raw ?? "[]") as ProceduralFurnitureReport[];
  }

  /**
   * Live GPU-resource counts for procedural furniture, driven by three's own
   * `dispose` events (`data-procedural-furniture-stats`).
   *
   * `refinedRendererGeometries()` / `refinedRendererTextures()` come from
   * `gl.info.memory`, which does **not** track materials — a leaked material
   * is invisible there. Use this for anything asserting procedural furniture
   * releases its resources.
   */
  async refinedProceduralFurnitureStats(): Promise<ProceduralFurnitureStats> {
    const raw = await this.refinedScene.getAttribute(
      "data-procedural-furniture-stats",
    );
    return JSON.parse(raw ?? "null") as ProceduralFurnitureStats;
  }

  /**
   * Cache/build counts for the imported-GLB path (`data-furniture-model-stats`).
   *
   * The counterpart to `refinedProceduralFurnitureStats()`. `totalBuilds` is
   * what proves the per-kind cache is actually being reused: a flat
   * `liveGeometries` across round-trips is also consistent with "nothing was
   * drawn at all", whereas `totalBuilds` staying put while models are visibly
   * on screen is not.
   */
  async refinedFurnitureModelStats(): Promise<FurnitureModelStats> {
    const raw = await this.refinedScene.getAttribute(
      "data-furniture-model-stats",
    );
    return JSON.parse(raw ?? "null") as FurnitureModelStats;
  }

  /** The single procedural report for `kind`, or `undefined`. */
  async refinedProceduralFurnitureReport(
    kind: string,
  ): Promise<ProceduralFurnitureReport | undefined> {
    const reports = await this.refinedProceduralFurnitureReports();
    return reports.find((report) => report.kind === kind);
  }

  // --- zoom/pan --------------------------------------------------------

  async clickZoomIn() {
    await this.page.locator('[data-testid="zoom-in-button"]').click();
  }

  async clickZoomOut() {
    await this.page.locator('[data-testid="zoom-out-button"]').click();
  }

  async clickZoomReset() {
    await this.page.locator('[data-testid="zoom-reset-button"]').click();
  }

  /** Current zoom-level display text (e.g. "100%"). */
  async zoomLevel(): Promise<string> {
    return (
      (await this.page.locator('[data-testid="zoom-level"]').textContent()) ??
      ""
    );
  }

  /** Scroll-wheel zoom, anchored at the given meter-space point. */
  async wheelZoomAt(meter: PlanPoint, deltaY: number) {
    const pt = await this.meterToScreen(meter);
    await this.page.mouse.move(pt.x, pt.y);
    await this.page.mouse.wheel(0, deltaY);
  }

  /** Press-drag pan the Stage from one meter-space point to another (blank canvas area). */
  async panByDrag(fromMeter: PlanPoint, toMeter: PlanPoint) {
    const start = await this.meterToScreen(fromMeter);
    const end = await this.meterToScreen(toMeter);

    await this.page.mouse.move(start.x, start.y);
    await this.page.mouse.down();
    await this.page.mouse.move(end.x, end.y, { steps: 8 });
    await this.page.mouse.up();
  }
}
