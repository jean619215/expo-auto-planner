import { test, expect, type Page } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";
import { AiPanelPage } from "./pages/AiPanelPage";
import { PlanSlotsPage } from "./pages/PlanSlotsPage";

// Playwright acceptance gate for「AiPanel 跨步驟常駐」(架構決策見
// .claude/pipeline/architect-plan.md)。涵蓋 orchestrator-output.md 的 9 條
// Clarified Acceptance Criteria + Edge Cases。沿用 ai-panel.spec.ts /
// plan-slots.spec.ts 的 page.route mock 慣例(mock /api/ai/chat +
// /api/ai/config,不打真 Anthropic API,不花錢)。
//
// 3D <canvas> 對 Playwright 不透明(同 venue-3d-scene.spec.ts 開頭註解)—
// 手動 3D 編輯一律透過 [data-testid="venue-scene"] 內的 <canvas> 中心點
// 模擬滑鼠點擊(架設方式見 canvasCenter()):OrbitControls 的
// target = (viewFitSizeM/2, 0, viewFitSizeM/2) 恰為預設地板
// (DEFAULT_FLOOR,置中於 20-30 帶)的形心,相機必然朝該點看,螢幕中心的
// raycast 命中點落於地板範圍內,可穩定觸發 handleFloorClick 放置家具。

interface MockResponse {
  status: number;
  body: unknown;
  delayMs?: number;
}

/** Queues fixture responses for consecutive POST /api/ai/chat calls (last one repeats). */
async function mockAiChat(page: Page, responses: MockResponse[]) {
  let callIndex = 0;
  await page.route("**/api/ai/chat", async (route) => {
    const resp = responses[Math.min(callIndex, responses.length - 1)];
    callIndex += 1;
    if (resp.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, resp.delayMs));
    }
    await route.fulfill({
      status: resp.status,
      contentType: "application/json",
      body: JSON.stringify(resp.body),
    });
  });
}

async function mockAiConfig(
  page: Page,
  { chatCost = 10, balance = 100 }: { chatCost?: number; balance?: number } = {},
) {
  await page.route("**/api/ai/config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ chatCost, balance }),
    });
  });
}

/** Center point of the 3D <canvas> inside [data-testid="venue-scene"] — see file-header comment. */
async function canvasCenter(page: Page) {
  const canvas = page.locator('[data-testid="venue-scene"] canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error("venue-scene canvas not visible");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Clicks the floor at the given screen point to trigger R3F's raycast-based
 * onClick. A bare `page.mouse.click()` (move+down+up with no delay) fires
 * before OrbitControls' first update loop has settled the camera's initial
 * lookAt(target) on some runs, missing the floor mesh — a small pause
 * between move and down/up makes this reliable.
 */
async function clickFloor(page: Page, point: { x: number; y: number }) {
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.waitForTimeout(50);
  await page.mouse.up();
}

const TEXT_REPLY_FIXTURE: MockResponse = {
  status: 200,
  body: {
    content: [{ type: "text", text: "收到,已記錄你的需求。" }],
    stopReason: "end_turn",
    usage: { inputTokens: 20, outputTokens: 12, cacheReadTokens: 0 },
    balance: 90,
  },
};

const ADD_CHAIR_FIXTURE: MockResponse = {
  status: 200,
  body: {
    content: [
      { type: "text", text: "已幫你加上一張椅子。" },
      {
        type: "tool_use",
        id: "toolu_add_chair_1",
        name: "add_furniture",
        input: { kind: "chair", center: { x: 24, y: 24 }, rotationDeg: 0 },
      },
    ],
    stopReason: "tool_use",
    usage: { inputTokens: 40, outputTokens: 30, cacheReadTokens: 0 },
    balance: 80,
  },
};

const MOVE_ITEM_OUT_OF_BOUNDS_FIXTURE: MockResponse = {
  status: 200,
  body: {
    content: [
      { type: "text", text: "幫你移動第 6 件家具。" },
      {
        type: "tool_use",
        id: "toolu_move_1",
        name: "move_item",
        input: { itemType: "furniture", index: 5, center: { x: 22, y: 22 } },
      },
    ],
    stopReason: "tool_use",
    usage: { inputTokens: 30, outputTokens: 20, cacheReadTokens: 0 },
    balance: 80,
  },
};

test.describe("AiPanel 跨步驟常駐 - AC1/AC2 對話歷史往返保留", () => {
  test("edit 對話一輪 → 下一步 → 對話仍在 → 上一步 → 仍在(往返兩次)", async ({
    page,
  }) => {
    await mockAiConfig(page);
    await mockAiChat(page, [TEXT_REPLY_FIXTURE]);

    const editor = new PlanEditorPage(page);
    const ai = new AiPanelPage(page);
    await editor.navigate();
    await ai.open();
    await ai.sendMessage("幫我規劃一個小型攤位");
    await expect(ai.lastAssistantText).toContainText("收到,已記錄你的需求");

    await editor.clickNextStep();
    await expect(editor.stepPreview).toBeVisible();
    await expect(ai.lastAssistantText).toContainText("收到,已記錄你的需求");

    await editor.clickBackToEdit();
    await expect(editor.stepEdit).toBeVisible();
    await expect(ai.lastAssistantText).toContainText("收到,已記錄你的需求");

    // 第二次往返 — 確認非一次性巧合。
    await editor.clickNextStep();
    await expect(ai.lastAssistantText).toContainText("收到,已記錄你的需求");
    await editor.clickBackToEdit();
    await expect(ai.lastAssistantText).toContainText("收到,已記錄你的需求");
  });
});

test.describe("AiPanel 跨步驟常駐 - AC3 輸入草稿保留", () => {
  test("edit 輸入框打字未送出 → 下一步 → 上一步 → 內容原樣保留", async ({
    page,
  }) => {
    await mockAiConfig(page);

    const editor = new PlanEditorPage(page);
    const ai = new AiPanelPage(page);
    await editor.navigate();
    await ai.open();
    await ai.input.fill("這是尚未送出的草稿");

    await editor.clickNextStep();
    await editor.clickBackToEdit();

    await expect(ai.input).toHaveValue("這是尚未送出的草稿");
  });
});

test.describe("AiPanel 跨步驟常駐 - AC4 preview 收合狀態", () => {
  test("preview 未展開僅 toggle 可見,點擊後展開", async ({ page }) => {
    await mockAiConfig(page);

    const editor = new PlanEditorPage(page);
    const ai = new AiPanelPage(page);
    await editor.navigate();
    await editor.clickNextStep();
    await expect(editor.stepPreview).toBeVisible();

    await expect(ai.toggle).toBeVisible();
    await expect(ai.panel).toBeHidden();
    await expect(ai.panel).toHaveCount(0);

    await ai.toggle.click();
    await expect(ai.panel).toBeVisible();
  });
});

test.describe("AiPanel 跨步驟常駐 - AC5 preview 下指令即時反映 3D", () => {
  test("送出觸發 add_furniture 的指令後,家具 mesh 數立即從 0 變 1,不離開 preview", async ({
    page,
  }) => {
    await mockAiConfig(page);
    await mockAiChat(page, [ADD_CHAIR_FIXTURE]);

    const editor = new PlanEditorPage(page);
    const ai = new AiPanelPage(page);
    await editor.navigate();
    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });
    await editor.clickNextStep();
    await expect(editor.stepPreview).toBeVisible();
    await ai.open();

    expect(await editor.scene.getAttribute("data-furniture-mesh-count")).toBe(
      "0",
    );

    await ai.sendMessage("幫我加一張椅子");

    await expect(ai.actionSummary).toContainText("已新增椅子");
    await expect(editor.stepPreview).toBeVisible();
    await expect(editor.scene).toHaveAttribute(
      "data-furniture-mesh-count",
      "1",
    );
  });
});

test.describe("AiPanel 跨步驟常駐 - AC7/AC6 手動 3D + AI 互不覆蓋、config JSON 最新、回 edit 同步", () => {
  test("preview 手動放置家具後對 AI 下指令,config JSON 反映最新配置;AI 套用後兩件都在;回 edit 同步", async ({
    page,
  }) => {
    await mockAiConfig(page);

    let lastChatBody: Record<string, unknown> | null = null;
    await page.route("**/api/ai/chat", async (route) => {
      lastChatBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ADD_CHAIR_FIXTURE.body),
      });
    });

    const editor = new PlanEditorPage(page);
    const ai = new AiPanelPage(page);
    await editor.navigate();
    await editor.clickNextStep();
    await expect(editor.stepPreview).toBeVisible();

    // 手動在 3D 內放置一件家具(桌子)。
    await page.getByTestId("furniture-place-table").click();
    const center = await canvasCenter(page);
    await clickFloor(page, center);
    await expect(editor.scene).toHaveAttribute(
      "data-furniture-mesh-count",
      "1",
    );

    // 對 AI 下指令 — 送出當下的 config JSON 必須含剛才手動放置的桌子
    // (而非切換到 preview 當下的舊快照)。
    await ai.open();
    await ai.sendMessage("幫我再加一張椅子");

    // route 攔截經 CDP 非同步觸發 — click 返回當下 lastChatBody 可能尚未
    // 寫入,poll 等待請求真正被攔到,避免 flake(review 修正)。
    await expect.poll(() => lastChatBody).not.toBeNull();
    const messages = (
      lastChatBody as unknown as {
        messages: { role: string; content: { type: string; text?: string }[] }[];
      }
    ).messages;
    const latestUserText = messages[messages.length - 1].content.find(
      (b) => b.type === "text",
    )?.text as string;
    expect(latestUserText).toContain("[目前配置]");
    const appendixJson = JSON.parse(
      latestUserText.slice(latestUserText.indexOf("{")),
    ) as { furniture: { kind: string }[] };
    expect(appendixJson.furniture).toHaveLength(1);
    expect(appendixJson.furniture[0].kind).toBe("table");

    // AI 回應套用後,手動放置的桌子仍在,AI 新增的椅子也在 — 互不覆蓋。
    await expect(ai.actionSummary).toContainText("已新增椅子");
    await expect(editor.scene).toHaveAttribute(
      "data-furniture-mesh-count",
      "2",
    );

    // 回 edit:2D 畫布顯示同一份包含手動 + AI 新增結果的最新配置。
    await editor.clickBackToEdit();
    await expect(editor.stepEdit).toBeVisible();
    expect(await editor.editor.getAttribute("data-furniture-count")).toBe("2");
    const furnitureRaw = await editor.editor.getAttribute("data-furniture");
    const furniture = JSON.parse(furnitureRaw ?? "[]") as { kind: string }[];
    expect(furniture.map((f) => f.kind).sort()).toEqual(["chair", "table"]);
  });
});

test.describe("AiPanel 跨步驟常駐 - Edge case: preview pending 中切回 edit", () => {
  test("preview 送出後立即上一步,等待期間 edit 手動編輯不被回應覆蓋,回應到達後正確套用", async ({
    page,
  }) => {
    await mockAiConfig(page);
    await mockAiChat(page, [{ ...ADD_CHAIR_FIXTURE, delayMs: 1000 }]);

    const editor = new PlanEditorPage(page);
    const ai = new AiPanelPage(page);
    await editor.navigate();
    await editor.clickNextStep();
    await expect(editor.stepPreview).toBeVisible();
    await ai.open();

    await ai.sendMessage("幫我加一張椅子");
    // 不等待回應 — 立即切回 edit。
    await editor.clickBackToEdit();
    await expect(editor.stepEdit).toBeVisible();

    // 等待期間使用者在 edit 手動畫一面牆。
    await editor.wallTool();
    await editor.drawWall({ x: 5, y: 5 }, { x: 10, y: 5 });
    expect(await editor.wallCount()).toBe(1);

    // 回應到達後,applyActions 仍套用到正確(最新)的幾何 state:AI 新增
    // 的椅子與使用者手動畫的牆都保留,互不覆蓋。
    await expect(ai.actionSummary).toContainText("已新增椅子", {
      timeout: 5000,
    });
    expect(await editor.editor.getAttribute("data-furniture-count")).toBe("1");
    expect(await editor.wallCount()).toBe(1);
  });
});

test.describe("AiPanel 跨步驟常駐 - Edge case: tool call 失敗訊息", () => {
  test("preview 下 move_item 索引越界,ai-action-summary 顯示失敗訊息", async ({
    page,
  }) => {
    await mockAiConfig(page);
    await mockAiChat(page, [MOVE_ITEM_OUT_OF_BOUNDS_FIXTURE]);

    const editor = new PlanEditorPage(page);
    const ai = new AiPanelPage(page);
    await editor.navigate();
    await editor.clickNextStep();
    await expect(editor.stepPreview).toBeVisible();
    await ai.open();

    await ai.sendMessage("幫我移動第 6 件家具");

    await expect(ai.actionSummary).toContainText("不存在");
    await expect(ai.actionSummary).toContainText("已跳過移動");
  });
});

test.describe("AiPanel 跨步驟常駐 - AC8 讀檔狀態不受步驟切換影響", () => {
  test("讀取存檔格後往返 edit/preview,slot/planId 不變、清空對話按鈕兩步驟皆可見可用", async ({
    page,
  }) => {
    const PLAN_ID = "33333333-3333-3333-3333-333333333333";
    const FIXTURE_PLAN = {
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
    };

    await mockAiConfig(page);
    await page.route(/\/api\/plans$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          slots: [
            {
              slot: 1,
              occupied: true,
              name: "配置1",
              updatedAt: "2026-07-19T08:00:00Z",
            },
            { slot: 2, occupied: false, name: null, updatedAt: null },
            { slot: 3, occupied: false, name: null, updatedAt: null },
          ],
        }),
      });
    });
    await page.route(/\/api\/plans\/1$/, async (route) => {
      if (route.request().method() !== "GET") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "unhandled in test" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          planId: PLAN_ID,
          slot: 1,
          name: "配置1",
          plan: FIXTURE_PLAN,
          updatedAt: "2026-07-22T00:00:00Z",
          conversation: [
            { role: "user", content: [{ type: "text", text: "哈囉" }] },
            { role: "assistant", content: [{ type: "text", text: "你好" }] },
          ],
        }),
      });
    });

    const editor = new PlanEditorPage(page);
    const ai = new AiPanelPage(page);
    const slots = new PlanSlotsPage(page);
    await editor.navigate();
    await slots.open();
    await slots.loadSlot(1);

    await expect(editor.editor).toHaveAttribute("data-current-plan-id", PLAN_ID);
    await expect(editor.editor).toHaveAttribute("data-current-slot", "1");

    await ai.open();
    await expect(ai.clearButton).toBeVisible();

    await editor.clickNextStep();
    await expect(editor.stepPreview).toBeVisible();
    await expect(editor.editor).toHaveAttribute("data-current-plan-id", PLAN_ID);
    await expect(editor.editor).toHaveAttribute("data-current-slot", "1");
    await expect(ai.clearButton).toBeVisible();

    await editor.clickBackToEdit();
    await expect(editor.stepEdit).toBeVisible();
    await expect(editor.editor).toHaveAttribute("data-current-plan-id", PLAN_ID);
    await expect(editor.editor).toHaveAttribute("data-current-slot", "1");
    await expect(ai.clearButton).toBeVisible();
  });
});
