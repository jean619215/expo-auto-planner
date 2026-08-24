import { test, expect, type Route } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";
import { PlanSlotsPage } from "./pages/PlanSlotsPage";

// Playwright acceptance gate for 2D 畫布 zoom/pan(架構定案見
// .claude/pipeline/architect-plan.md)。涵蓋:預設視覺迴歸、場地尺寸編輯器
// 移除、滾輪錨點縮放、按鈕縮放與夾值、重置視圖、pan 區隔(空白處 vs
// 物件/地板)、縮放/平移狀態下互動座標正確性、擴大範圍(200x200)、存檔固定
// 200 + 舊檔相容。
//
// Default floor polygon (src/lib/venue/plan.ts DEFAULT_FLOOR): 預設 3×3m
// 攤位,錨在 (20,20)。Default view fit size = 50m (DEFAULT_VIEW_SIZE_M)。
//
// 第三輪 T1 之後,可編輯範圍不再是固定的 200m 見方,而是「攤位 + 5m 邊距」。
// 需要在攤位外一大片地方操作的案例,先開一塊夠大的攤位再 `clickZoomReset()`
// 把視圖收回預設 —— 換尺寸會觸發 fitViewTo,不重置的話畫面會停在攤位上,
// 低座標反而點不到。
async function openWideRoom(editor: PlanEditorPage) {
  await editor.applyCustomBoothSize(30, 30);
  await editor.clickZoomReset();
}

const PLAN_SLOT_RE = /\/api\/plans\/\d$/;

test.describe("Venue zoom/pan - 案1 預設視覺迴歸", () => {
  test("scale=1/x=y=0,zoom-level 100%,pxPerMeter 與地板位置與現行一致", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    expect(await editor.stageScale()).toBeCloseTo(1, 5);
    const pos = await editor.stagePosition();
    expect(pos.x).toBeCloseTo(0, 5);
    expect(pos.y).toBeCloseTo(0, 5);
    expect((await editor.zoomLevel()).trim()).toBe("100%");

    const stageSize = await editor.stageSize();
    const ppm = await editor.pxPerMeter();
    expect(stageSize / ppm).toBeCloseTo(50, 5);

    const verts = await editor.vertices();
    // 預設攤位 3×3m,錨在 BOOTH_ORIGIN (20,20)(feedback round 2, R1)。
    expect(verts).toEqual([
      { x: 20, y: 20 },
      { x: 23, y: 20 },
      { x: 23, y: 23 },
      { x: 20, y: 23 },
    ]);
  });
});

test.describe("Venue zoom/pan - 案2 場地尺寸編輯器已移除", () => {
  test("venue-size-button/editor/confirm-dialog 皆不存在", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    expect(
      await page.locator('[data-testid="venue-size-button"]').count(),
    ).toBe(0);
    expect(
      await page.locator('[data-testid="venue-size-editor"]').count(),
    ).toBe(0);
    expect(
      await page.locator('[data-testid="venue-size-confirm-dialog"]').count(),
    ).toBe(0);
  });
});

test.describe("Venue zoom/pan - 案3 滾輪錨點縮放", () => {
  test("縮放前後,錨點的公尺座標螢幕位置不變(誤差 <1px)", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    const anchorMeter = { x: 25, y: 25 };
    const before = await editor.meterToScreen(anchorMeter);

    await editor.wheelZoomAt(anchorMeter, -240); // 放大(deltaY < 0)

    expect(await editor.stageScale()).toBeGreaterThan(1);
    const after = await editor.meterToScreen(anchorMeter);
    expect(Math.abs(after.x - before.x)).toBeLessThan(1);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1);

    const level = (await editor.zoomLevel()).trim();
    expect(level).not.toBe("100%");
  });
});

test.describe("Venue zoom/pan - 案4 按鈕縮放與夾值", () => {
  test("單次點擊 ~1.25x;連點至上限 400%、下限 25%", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.clickZoomIn();
    expect(await editor.stageScale()).toBeCloseTo(1.25, 2);

    for (let i = 0; i < 20; i++) {
      await editor.clickZoomIn();
    }
    expect(await editor.stageScale()).toBeCloseTo(4, 2);
    expect((await editor.zoomLevel()).trim()).toBe("400%");

    for (let i = 0; i < 30; i++) {
      await editor.clickZoomOut();
    }
    const scale = await editor.stageScale();
    expect(scale).toBeCloseTo(0.25, 2);
    expect((await editor.zoomLevel()).trim()).toBe("25%");

    const ppm = await editor.pxPerMeter();
    const stageSize = await editor.stageSize();
    // min zoom 下,200x200 完整範圍恰好容納於可視區域內。
    expect(200 * ppm * scale).toBeCloseTo(stageSize, 0);
  });
});

test.describe("Venue zoom/pan - 案5 重置視圖", () => {
  test("縮放+平移後點擊重置,回到 scale=1/x=0/y=0", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    await editor.clickZoomIn();
    await editor.clickZoomIn();
    await editor.panByDrag({ x: 45, y: 5 }, { x: 5, y: 5 });

    expect(await editor.stageScale()).not.toBeCloseTo(1, 2);

    await editor.clickZoomReset();

    expect(await editor.stageScale()).toBeCloseTo(1, 5);
    const pos = await editor.stagePosition();
    expect(pos.x).toBeCloseTo(0, 5);
    expect(pos.y).toBeCloseTo(0, 5);
  });
});

test.describe("Venue zoom/pan - 案6 pan 區隔", () => {
  test("空白處拖曳平移;地板/物件上拖曳不平移", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await openWideRoom(editor);

    // 空白處(地板範圍外)拖曳 -> Stage 平移,vertices/objects 不變。
    const beforeVerts = await editor.vertices();
    await editor.panByDrag({ x: 45, y: 5 }, { x: 40, y: 10 });
    const posAfterPan = await editor.stagePosition();
    expect(posAfterPan.x !== 0 || posAfterPan.y !== 0).toBe(true);
    expect(await editor.vertices()).toEqual(beforeVerts);

    await editor.clickZoomReset();

    // 地板內部點拖曳(未命中頂點/邊,落在多邊形內部)-> stage 不變。
    await editor.panByDrag({ x: 21.5, y: 21.5 }, { x: 21.8, y: 21.8 });
    const posAfterFloorDrag = await editor.stagePosition();
    expect(posAfterFloorDrag.x).toBeCloseTo(0, 5);
    expect(posAfterFloorDrag.y).toBeCloseTo(0, 5);

    // 選取物件後在物件上拖曳 -> 物件公尺座標改變,stage x/y 不變。
    await editor.columnTool();
    await editor.placeColumn({ x: 18, y: 40 });
    await editor.selectTool();
    await editor.dragObjectBody({ x: 18, y: 40 }, { x: 20, y: 42 });

    const posAfterObjectDrag = await editor.stagePosition();
    expect(posAfterObjectDrag.x).toBeCloseTo(0, 5);
    expect(posAfterObjectDrag.y).toBeCloseTo(0, 5);
    const { columns } = await editor.objects();
    expect(columns[0].center.x).toBeCloseTo(20, 5);
    expect(columns[0].center.y).toBeCloseTo(42, 5);
  });
});

test.describe("Venue zoom/pan - 案7 縮放/平移狀態下互動正確性", () => {
  test("非預設 view 下,頂點/邊/牆/柱子/物件拖曳互動座標與 1x/(0,0) 一致", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await openWideRoom(editor);

    // 進入非預設 view:先在預設 scale(1x,全 50m 可視)下平移,再放大 —
    // 放大後的可視範圍縮小到約 [10,50]x[10,50](span = 50/1.25 = 40m),
    // 後續互動座標一律選在這個安全區間內(margin >=5m),避免落在 Stage
    // 畫布邊界外導致滑鼠事件命中不到 Stage。
    await editor.panByDrag({ x: 45, y: 45 }, { x: 40, y: 40 });
    await editor.clickZoomIn();

    // 拖曳頂點。
    await editor.dragVertexTo(0, { x: 18, y: 18 });
    const verts = await editor.vertices();
    expect(verts[0].x).toBeCloseTo(18, 5);
    expect(verts[0].y).toBeCloseTo(18, 5);

    // 雙擊邊上插入頂點。
    const midpoint = { x: (verts[0].x + verts[1].x) / 2, y: (verts[0].y + verts[1].y) / 2 };
    await editor.doubleClickAt(midpoint);
    expect(await editor.vertexCount()).toBe(5);

    // 右鍵刪除頂點(剛插入的那個)。
    await editor.rightClickVertex(1);
    expect(await editor.vertexCount()).toBe(4);

    // 畫牆。
    await editor.wallTool();
    await editor.drawWall({ x: 20, y: 35 }, { x: 30, y: 35 });
    const { walls: wallsAfterDraw } = await editor.objects();
    expect(wallsAfterDraw).toHaveLength(1);
    expect(wallsAfterDraw[0].start.x).toBeCloseTo(20, 5);
    expect(wallsAfterDraw[0].start.y).toBeCloseTo(35, 5);
    expect(wallsAfterDraw[0].end.x).toBeCloseTo(30, 5);
    expect(wallsAfterDraw[0].end.y).toBeCloseTo(35, 5);

    // 放柱子。
    await editor.columnTool();
    await editor.placeColumn({ x: 35, y: 20 });
    const { columns: columnsAfterPlace } = await editor.objects();
    expect(columnsAfterPlace).toHaveLength(1);
    expect(columnsAfterPlace[0].center.x).toBeCloseTo(35, 5);
    expect(columnsAfterPlace[0].center.y).toBeCloseTo(20, 5);

    // 拖曳家具/柱子/牆體移動(以柱子驗證 body-drag)。
    await editor.selectTool();
    await editor.dragObjectBody({ x: 35, y: 20 }, { x: 30, y: 25 });
    const { columns: columnsAfterDrag } = await editor.objects();
    expect(columnsAfterDrag[0].center.x).toBeCloseTo(30, 5);
    expect(columnsAfterDrag[0].center.y).toBeCloseTo(25, 5);

    // 拖曳牆端點 — 先點在牆身上重新選取該牆(端點把手僅於選取時渲染),
    // 取代先前的柱子選取。
    const { walls } = await editor.objects();
    const wallId = walls[0].id;
    const wallMidpoint = {
      x: (walls[0].start.x + walls[0].end.x) / 2,
      y: (walls[0].start.y + walls[0].end.y) / 2,
    };
    await editor.clickAt(wallMidpoint);
    await editor.dragWallEndpoint(wallId, "start", { x: 22, y: 37 });
    const { walls: wallsAfterEndpoint } = await editor.objects();
    const movedWall = wallsAfterEndpoint.find((w) => w.id === wallId)!;
    expect(movedWall.start.x).toBeCloseTo(22, 5);
    expect(movedWall.start.y).toBeCloseTo(37, 5);

    // 拖曳柱子縮放把手。
    const columnId = columnsAfterDrag[0].id;
    await editor.clickAt(columnsAfterDrag[0].center);
    const cornerTarget = {
      x: columnsAfterDrag[0].center.x + 1,
      y: columnsAfterDrag[0].center.y + 1,
    };
    await editor.dragColumnCorner(
      columnId,
      { x: 1, y: 1 },
      cornerTarget,
    );
    const { columns: columnsAfterResize } = await editor.objects();
    const resizedColumn = columnsAfterResize.find((c) => c.id === columnId)!;
    expect(resizedColumn.w).toBeGreaterThan(0.5);
    expect(resizedColumn.h).toBeGreaterThan(0.5);
  });
});

test.describe("Venue zoom/pan - 案8 可編輯範圍可以超出預設視窗", () => {
  test("大攤位 + zoom out 後,可於超出 50m 的座標放置柱子", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    // T1 之前這一項守的是固定的 200m 範圍。範圍改成跟著攤位走之後,守的東西
    // 變成「範圍確實會長,不是被預設視圖的 50m 綁死」:開一塊 80×80 的攤位,
    // 範圍是 [15,105],然後縮小到底(span = 50/0.25 = 200m 視窗)去點 100。
    await editor.applyCustomBoothSize(80, 80);
    await editor.clickZoomReset();
    for (let i = 0; i < 30; i++) {
      await editor.clickZoomOut();
    }
    expect(await editor.stageScale()).toBeCloseTo(0.25, 2);

    await editor.columnTool();
    await editor.placeColumn({ x: 100, y: 100 });

    const { columns } = await editor.objects();
    expect(columns).toHaveLength(1);
    expect(columns[0].center.x).toBeCloseTo(100, 3);
    expect(columns[0].center.y).toBeCloseTo(100, 3);
  });
});

test.describe("Venue zoom/pan - 案9 存檔的 venueSizeM 跟著攤位 + 舊檔相容", () => {
  test("讀入 10×10 舊檔後,PUT 送的 venueSizeM 是該攤位的可編輯範圍寬(20),不是舊檔的 40", async ({
    page,
  }) => {
    let capturedBody: Record<string, unknown> | null = null;
    await page.route(PLAN_SLOT_RE, async (route: Route) => {
      const method = route.request().method();
      if (method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            planId: "33333333-3333-3333-3333-333333333333",
            slot: 1,
            name: "舊存檔",
            plan: {
              polygon: [
                { x: 5, y: 5 },
                { x: 15, y: 5 },
                { x: 15, y: 15 },
                { x: 5, y: 15 },
              ],
              walls: [],
              columns: [],
              furniture: [],
              venueSizeM: 40,
            },
            updatedAt: "2026-07-21T00:00:00Z",
            conversation: [],
          }),
        });
        return;
      }
      if (method === "PUT") {
        capturedBody = route.request().postDataJSON() as Record<
          string,
          unknown
        >;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            slot: 1,
            name: "舊存檔",
            updatedAt: "2026-07-22T00:00:00Z",
          }),
        });
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "unhandled in test" }),
      });
    });
    await page.route(/\/api\/plans$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          slots: [
            { slot: 1, occupied: true, name: "舊存檔", updatedAt: "2026-07-21T00:00:00Z" },
            { slot: 2, occupied: false, name: null, updatedAt: null },
            { slot: 3, occupied: false, name: null, updatedAt: null },
          ],
        }),
      });
    });
    await page.route(/\/api\/plans\/\d\/conversation$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    const editor = new PlanEditorPage(page);
    const slots = new PlanSlotsPage(page);
    await editor.navigate();

    await slots.open();
    await slots.loadSlot(1);

    // 讀入正常顯示與編輯(4 頂點地板)。
    await expect
      .poll(async () => editor.vertexCount())
      .toBe(4);

    // 隨後存檔。讀進來的地板是 10×10(從 (5,5) 起算),攤位因此重新錨定在
    // 那裡,可編輯範圍是 [0,20] —— 寬 20。舊檔寫的 40 一律忽略。
    await slots.open();
    await slots.saveToSlot(1);
    await slots.confirmOverwrite();

    await expect.poll(() => capturedBody !== null).toBe(true);
    const plan = (capturedBody as unknown as { plan: Record<string, unknown> })
      .plan;
    expect(plan.venueSizeM).toBe(20);
  });
});
