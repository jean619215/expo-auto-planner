import { test, expect, type Page, type Route } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";
import { AiPanelPage } from "./pages/AiPanelPage";
import { PlanSlotsPage } from "./pages/PlanSlotsPage";

// Playwright acceptance gate for 存檔 UI(三格面板)+ AiPanel 續聊/清空對話/
// 軟上限/歷史圖片占位(architect-plan.md Task 3). 全部走 page.route() mock
// (orchestrator-output.md Assumption 5) — 不打真 Supabase/Anthropic,不需
// 登入。Route 匹配用 regex 精準分流,避免 `/conversation` 被 `[slot]` 的
// glob 吃掉(architect-plan.md Test Plan 備註)。

const PLANS_LIST_RE = /\/api\/plans$/;
const PLAN_SLOT_RE = /\/api\/plans\/\d$/;
const CONVERSATION_RE = /\/api\/plans\/\d\/conversation$/;

const PRIOR_IMAGE_PLACEHOLDER = "[使用者先前提供了參考圖]";
const CONFIG_APPENDIX_HEADER = "[目前配置]";

interface SlotSummary {
  slot: number;
  occupied: boolean;
  name: string | null;
  updatedAt: string | null;
}

function defaultSlots(overrides: Partial<Record<number, SlotSummary>> = {}) {
  const base: SlotSummary[] = [1, 2, 3].map((slot) => ({
    slot,
    occupied: false,
    name: null,
    updatedAt: null,
  }));
  return base.map((row) => overrides[row.slot] ?? row);
}

/** Mocks GET /api/plans. */
async function mockPlansList(page: Page, slots: SlotSummary[]) {
  await page.route(PLANS_LIST_RE, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ slots }),
    });
  });
}

async function mockPlansListError(page: Page, status = 500) {
  await page.route(PLANS_LIST_RE, async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({ error: "伺服器錯誤" }),
    });
  });
}

interface PlanSlotHandlers {
  onGet?: (route: Route, slot: string) => Promise<void> | void;
  onPut?: (route: Route, slot: string, body: unknown) => Promise<void> | void;
  onPatch?: (
    route: Route,
    slot: string,
    body: unknown,
  ) => Promise<void> | void;
  onDelete?: (route: Route, slot: string) => Promise<void> | void;
}

/** Single dispatcher for GET/PUT/PATCH/DELETE /api/plans/[slot]. */
async function mockPlanSlot(page: Page, handlers: PlanSlotHandlers) {
  await page.route(PLAN_SLOT_RE, async (route) => {
    const url = route.request().url();
    const match = url.match(/\/api\/plans\/(\d)$/);
    const slot = match ? match[1] : "";
    const method = route.request().method();
    if (method === "GET" && handlers.onGet) {
      await handlers.onGet(route, slot);
      return;
    }
    if (method === "PUT" && handlers.onPut) {
      await handlers.onPut(route, slot, route.request().postDataJSON());
      return;
    }
    if (method === "PATCH" && handlers.onPatch) {
      await handlers.onPatch(route, slot, route.request().postDataJSON());
      return;
    }
    if (method === "DELETE" && handlers.onDelete) {
      await handlers.onDelete(route, slot);
      return;
    }
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "unhandled in test" }),
    });
  });
}

async function mockConversationDelete(
  page: Page,
  status = 200,
  body: unknown = { slot: 1, cleared: true },
) {
  await page.route(CONVERSATION_RE, async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

async function mockAiConfig(page: Page) {
  await page.route("**/api/ai/config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ chatCost: 10, balance: 100 }),
    });
  });
}

const TEXT_REPLY = {
  content: [{ type: "text", text: "收到,已更新配置。" }],
  stopReason: "end_turn",
  usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 },
  balance: 90,
};

const FIXTURE_PLAN = {
  polygon: [
    { x: 5, y: 5 },
    { x: 15, y: 5 },
    { x: 15, y: 15 },
    { x: 5, y: 15 },
  ],
  walls: [],
  columns: [],
  furniture: [
    { id: "f1", kind: "table", center: { x: 10, y: 10 }, w: 1.2, h: 0.7, rotationDeg: 0 },
  ],
  venueSizeM: 40,
};

const PLAN_ID_1 = "11111111-1111-1111-1111-111111111111";

async function closeSlotsDialogViaClose(page: Page) {
  await page.locator('[data-slot="dialog-close"]').first().click();
}

test.describe("存檔面板 - AC1 開啟與固定 3 列", () => {
  test("已占用列顯示名稱與更新時間,空列顯示占位文字", async ({ page }) => {
    await mockPlansList(
      page,
      defaultSlots({
        1: { slot: 1, occupied: true, name: "羽球場配置", updatedAt: "2026-07-20T10:00:00Z" },
      }),
    );

    const editor = new PlanEditorPage(page);
    const slots = new PlanSlotsPage(page);
    await editor.navigate();
    await slots.open();

    await expect(slots.row(1)).toBeVisible();
    await expect(slots.row(2)).toBeVisible();
    await expect(slots.row(3)).toBeVisible();
    await expect(slots.slotName(1)).toHaveText("羽球場配置");
    await expect(slots.slotUpdated(1)).not.toHaveText("");
    await expect(slots.slotEmpty(2)).toBeVisible();
    await expect(slots.slotEmpty(3)).toBeVisible();
  });
});

test.describe("存檔面板 - AC2 空格存入", () => {
  test("PUT body 含 venueSizeM 與 4 個既有欄位", async ({ page }) => {
    await mockPlansList(page, defaultSlots());
    let capturedBody: Record<string, unknown> | null = null;
    await mockPlanSlot(page, {
      onPut: async (route, _slot, body) => {
        capturedBody = body as Record<string, unknown>;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ slot: 2, name: "未命名場地", updatedAt: "2026-07-21T00:00:00Z" }),
        });
      },
      onGet: async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            planId: "22222222-2222-2222-2222-222222222222",
            slot: 2,
            name: "未命名場地",
            plan: FIXTURE_PLAN,
            updatedAt: "2026-07-21T00:00:00Z",
            conversation: [],
          }),
        });
      },
    });

    const editor = new PlanEditorPage(page);
    const slots = new PlanSlotsPage(page);
    await editor.navigate();
    await slots.open();
    await slots.saveToSlot(2);

    await expect(slots.slotName(2)).toHaveText("未命名場地");
    expect(capturedBody).not.toBeNull();
    const plan = (capturedBody as unknown as { plan: Record<string, unknown> }).plan;
    expect(plan).toHaveProperty("polygon");
    expect(plan).toHaveProperty("walls");
    expect(plan).toHaveProperty("columns");
    expect(plan).toHaveProperty("furniture");
    expect(plan).toHaveProperty("venueSizeM");
    expect(typeof plan.venueSizeM).toBe("number");
  });
});

test.describe("存檔面板 - AC3 占用格存入(覆蓋確認)", () => {
  test("先跳覆蓋確認,取消不送出,確認才 PUT", async ({ page }) => {
    await mockPlansList(
      page,
      defaultSlots({
        1: { slot: 1, occupied: true, name: "舊配置", updatedAt: "2026-07-19T08:00:00Z" },
      }),
    );
    let putCount = 0;
    await mockPlanSlot(page, {
      onPut: async (route) => {
        putCount += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ slot: 1, name: "舊配置", updatedAt: "2026-07-22T00:00:00Z" }),
        });
      },
      onGet: async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            planId: PLAN_ID_1,
            slot: 1,
            name: "舊配置",
            plan: FIXTURE_PLAN,
            updatedAt: "2026-07-22T00:00:00Z",
            conversation: [],
          }),
        });
      },
    });

    const editor = new PlanEditorPage(page);
    const slots = new PlanSlotsPage(page);
    await editor.navigate();
    await slots.open();

    await slots.saveButton(1).click();
    await expect(slots.overwriteConfirmDialog).toBeVisible();
    await expect(slots.overwriteConfirmDialog).toContainText("舊配置");

    await slots.overwriteConfirmCancel.click();
    await expect(slots.overwriteConfirmDialog).toBeHidden();
    expect(putCount).toBe(0);

    await slots.saveButton(1).click();
    await slots.confirmOverwrite();
    expect(putCount).toBe(1);
  });
});

test.describe("存檔面板 - AC4/AC5 dirty 判定", () => {
  test("dirty 時讀取先跳確認,取消不發 GET", async ({ page }) => {
    await mockPlansList(
      page,
      defaultSlots({
        1: { slot: 1, occupied: true, name: "配置1", updatedAt: "2026-07-19T08:00:00Z" },
      }),
    );
    let getCount = 0;
    await mockPlanSlot(page, {
      onGet: async (route) => {
        getCount += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            planId: PLAN_ID_1,
            slot: 1,
            name: "配置1",
            plan: FIXTURE_PLAN,
            updatedAt: "2026-07-22T00:00:00Z",
            conversation: [],
          }),
        });
      },
    });

    const editor = new PlanEditorPage(page);
    const slots = new PlanSlotsPage(page);
    await editor.navigate();

    // 使工作區 dirty:新增一根柱子。
    await editor.columnTool();
    await editor.placeColumn({ x: 10, y: 10 });
    expect(await editor.columnCount()).toBe(1);

    await slots.open();
    await slots.loadSlot(1);
    await expect(slots.loadConfirmDialog).toBeVisible();
    await slots.loadConfirmCancel.click();
    await expect(slots.loadConfirmDialog).toBeHidden();
    expect(getCount).toBe(0);
  });

  test("not dirty 時直接讀取,不跳確認彈窗", async ({ page }) => {
    await mockPlansList(
      page,
      defaultSlots({
        1: { slot: 1, occupied: true, name: "配置1", updatedAt: "2026-07-19T08:00:00Z" },
      }),
    );
    await mockPlanSlot(page, {
      onGet: async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            planId: PLAN_ID_1,
            slot: 1,
            name: "配置1",
            plan: FIXTURE_PLAN,
            updatedAt: "2026-07-22T00:00:00Z",
            conversation: [],
          }),
        });
      },
    });

    const editor = new PlanEditorPage(page);
    const slots = new PlanSlotsPage(page);
    await editor.navigate();
    await slots.open();
    await slots.loadSlot(1);

    await expect(slots.loadConfirmDialog).toBeHidden();
    await expect(slots.dialog).toBeHidden();
    await expect(editor.editor).toHaveAttribute("data-current-plan-id", PLAN_ID_1);
  });
});

test.describe("存檔面板 - AC6 讀檔套用", () => {
  test("套用 plan/venueSizeM,AiPanel 顯示歷史,續聊帶 planId", async ({ page }) => {
    await mockAiConfig(page);
    await mockPlansList(
      page,
      defaultSlots({
        1: { slot: 1, occupied: true, name: "配置1", updatedAt: "2026-07-19T08:00:00Z" },
      }),
    );
    await mockPlanSlot(page, {
      onGet: async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            planId: PLAN_ID_1,
            slot: 1,
            name: "配置1",
            plan: FIXTURE_PLAN,
            updatedAt: "2026-07-22T00:00:00Z",
            conversation: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: `幫我加一張桌子\n\n${CONFIG_APPENDIX_HEADER}\n{"floor":[]}`,
                  },
                ],
              },
              {
                role: "assistant",
                content: [{ type: "text", text: "好的,已經加上桌子。" }],
              },
            ],
          }),
        });
      },
    });
    let capturedChatBody: Record<string, unknown> | null = null;
    await page.route("**/api/ai/chat", async (route) => {
      capturedChatBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(TEXT_REPLY),
      });
    });

    const editor = new PlanEditorPage(page);
    const ai = new AiPanelPage(page);
    const slots = new PlanSlotsPage(page);
    await editor.navigate();
    await slots.open();
    await slots.loadSlot(1);

    await expect(editor.editor).toHaveAttribute("data-current-plan-id", PLAN_ID_1);
    expect(await editor.vertexCount()).toBe(4);
    const furnitureRaw = await editor.editor.getAttribute("data-furniture");
    expect(JSON.parse(furnitureRaw ?? "[]")).toHaveLength(1);

    await ai.open();
    await expect(ai.messages).toContainText("好的,已經加上桌子");
    await expect(ai.messages).toContainText("幫我加一張桌子");
    await expect(ai.messages).not.toContainText(CONFIG_APPENDIX_HEADER);

    await ai.sendMessage("再幫我加張椅子");
    await expect(ai.messages).toContainText("收到,已更新配置");
    expect(capturedChatBody).not.toBeNull();
    expect((capturedChatBody as unknown as { planId: string }).planId).toBe(PLAN_ID_1);
  });

  test("缺 venueSizeM 的舊資料:fallback 不崩潰", async ({ page }) => {
    const planWithoutSize: Record<string, unknown> = { ...FIXTURE_PLAN };
    delete planWithoutSize.venueSizeM;
    await mockPlansList(
      page,
      defaultSlots({
        1: { slot: 1, occupied: true, name: "舊資料", updatedAt: "2026-07-19T08:00:00Z" },
      }),
    );
    await mockPlanSlot(page, {
      onGet: async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            planId: PLAN_ID_1,
            slot: 1,
            name: "舊資料",
            plan: planWithoutSize,
            updatedAt: "2026-07-22T00:00:00Z",
            conversation: [],
          }),
        });
      },
    });

    const editor = new PlanEditorPage(page);
    const slots = new PlanSlotsPage(page);
    await editor.navigate();
    await slots.open();
    await slots.loadSlot(1);

    await expect(editor.editor).toBeVisible();
    await expect(editor.editor).toHaveAttribute("data-current-plan-id", PLAN_ID_1);
    expect(await editor.vertexCount()).toBe(4);
  });
});

test.describe("存檔面板 - AC7/AC8 歷史圖片占位與 displayText 還原", () => {
  test("歷史圖片顯示占位 chip,原始字串不出現", async ({ page }) => {
    await mockAiConfig(page);
    await mockPlansList(
      page,
      defaultSlots({
        1: { slot: 1, occupied: true, name: "配置1", updatedAt: "2026-07-19T08:00:00Z" },
      }),
    );
    await mockPlanSlot(page, {
      onGet: async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            planId: PLAN_ID_1,
            slot: 1,
            name: "配置1",
            plan: FIXTURE_PLAN,
            updatedAt: "2026-07-22T00:00:00Z",
            conversation: [
              {
                role: "user",
                content: [{ type: "text", text: PRIOR_IMAGE_PLACEHOLDER }],
              },
              {
                role: "assistant",
                content: [{ type: "text", text: "收到你的參考圖了。" }],
              },
            ],
          }),
        });
      },
    });

    let capturedChatBody: Record<string, unknown> | null = null;
    await page.route("**/api/ai/chat", async (route) => {
      capturedChatBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(TEXT_REPLY),
      });
    });

    const editor = new PlanEditorPage(page);
    const ai = new AiPanelPage(page);
    const slots = new PlanSlotsPage(page);
    await editor.navigate();
    await slots.open();
    await slots.loadSlot(1);
    await ai.open();

    await expect(ai.historyImagePlaceholder).toBeVisible();
    await expect(ai.historyImagePlaceholder).toContainText("📷 參考圖");
    await expect(ai.messages).not.toContainText(PRIOR_IMAGE_PLACEHOLDER);

    // 續聊迴歸(review fix):還原的歷史 image-only 輪在下一次送出時,
    // placeholder text block 必須原樣保留,且不得產生空 text block
    // (Anthropic API 拒絕空 text;扣點在模型呼叫前,失敗不退點)。
    await ai.sendMessage("續聊一句");
    expect(capturedChatBody).not.toBeNull();
    const messages = (capturedChatBody as unknown as {
      messages: { role: string; content: { type: string; text?: string }[] }[];
    }).messages;
    const historyUserBlocks = messages[0].content;
    expect(
      historyUserBlocks.some(
        (b) => b.type === "text" && b.text === PRIOR_IMAGE_PLACEHOLDER,
      ),
    ).toBe(true);
    for (const msg of messages) {
      for (const block of msg.content) {
        if (block.type === "text") {
          expect(block.text?.length ?? 0).toBeGreaterThan(0);
        }
      }
    }
  });
});

test.describe("存檔面板 - AC9 改名", () => {
  test("空字串不送出,合法名稱 PATCH 後更新列", async ({ page }) => {
    await mockPlansList(
      page,
      defaultSlots({
        1: { slot: 1, occupied: true, name: "舊名稱", updatedAt: "2026-07-19T08:00:00Z" },
      }),
    );
    let patchCount = 0;
    await mockPlanSlot(page, {
      onPatch: async (route) => {
        patchCount += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ slot: 1, name: "新名稱", updatedAt: "2026-07-22T00:00:00Z" }),
        });
      },
    });

    const editor = new PlanEditorPage(page);
    const slots = new PlanSlotsPage(page);
    await editor.navigate();
    await slots.open();

    await slots.renameButton(1).click();
    await expect(slots.renameDialog).toBeVisible();
    // 輸入框預填目前名稱(非空)— 清空後才驗證空字串擋下送出。
    await slots.renameInput.fill("");
    await expect(slots.renameConfirmButton).toBeDisabled();
    await slots.renameInput.fill("   ");
    await expect(slots.renameConfirmButton).toBeDisabled();
    expect(patchCount).toBe(0);

    await slots.renameInput.fill("新名稱");
    await slots.renameConfirmButton.click();
    expect(patchCount).toBe(1);
    await expect(slots.slotName(1)).toHaveText("新名稱");
  });
});

test.describe("存檔面板 - AC10 刪除", () => {
  test("確認彈窗文案含對話一併刪除;刪除 currentSlot 後 chat 不帶 planId", async ({ page }) => {
    await mockAiConfig(page);
    await mockPlansList(
      page,
      defaultSlots({
        1: { slot: 1, occupied: true, name: "配置1", updatedAt: "2026-07-19T08:00:00Z" },
      }),
    );
    let deleteCount = 0;
    await mockPlanSlot(page, {
      onGet: async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            planId: PLAN_ID_1,
            slot: 1,
            name: "配置1",
            plan: FIXTURE_PLAN,
            updatedAt: "2026-07-22T00:00:00Z",
            conversation: [],
          }),
        });
      },
      onDelete: async (route) => {
        deleteCount += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ slot: 1, deleted: true }),
        });
      },
    });
    let capturedChatBody: Record<string, unknown> | null = null;
    await page.route("**/api/ai/chat", async (route) => {
      capturedChatBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(TEXT_REPLY),
      });
    });

    const editor = new PlanEditorPage(page);
    const ai = new AiPanelPage(page);
    const slots = new PlanSlotsPage(page);
    await editor.navigate();
    await slots.open();
    await slots.loadSlot(1);
    await expect(editor.editor).toHaveAttribute("data-current-plan-id", PLAN_ID_1);

    await slots.open();
    await slots.deleteButton(1).click();
    await expect(slots.deleteConfirmDialog).toContainText("對話");
    await expect(slots.deleteConfirmDialog).toContainText("一併刪除");
    await slots.deleteConfirmAccept.click();
    expect(deleteCount).toBe(1);
    await expect(slots.slotEmpty(1)).toBeVisible();

    await expect(editor.editor).toHaveAttribute("data-current-plan-id", "");
    expect(await editor.vertexCount()).toBe(4); // 畫布不動

    await closeSlotsDialogViaClose(page);
    await ai.open();
    await ai.sendMessage("刪除後續聊");
    expect(capturedChatBody).not.toBeNull();
    expect(capturedChatBody as unknown as Record<string, unknown>).not.toHaveProperty("planId");
  });
});

test.describe("存檔面板 - AC11/AC12 清空對話", () => {
  test("已讀檔可清空對話,場地配置不變;未讀檔不顯示按鈕", async ({ page }) => {
    await mockAiConfig(page);
    await mockPlansList(
      page,
      defaultSlots({
        1: { slot: 1, occupied: true, name: "配置1", updatedAt: "2026-07-19T08:00:00Z" },
      }),
    );
    await mockPlanSlot(page, {
      onGet: async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            planId: PLAN_ID_1,
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
      },
    });
    await mockConversationDelete(page, 200, { slot: 1, cleared: true });

    const editor = new PlanEditorPage(page);
    const ai = new AiPanelPage(page);
    const slots = new PlanSlotsPage(page);
    await editor.navigate();
    await ai.open();
    await expect(ai.clearButton).toBeHidden();

    await slots.open();
    await slots.loadSlot(1);

    await expect(ai.clearButton).toBeVisible();
    await expect(ai.messages).toContainText("你好");
    const furnitureBefore = await editor.editor.getAttribute("data-furniture");

    await ai.clearButton.click();
    await expect(ai.clearConfirmDialog).toBeVisible();
    await ai.clearConfirmAccept.click();

    await expect(ai.messages).not.toContainText("你好");
    const furnitureAfter = await editor.editor.getAttribute("data-furniture");
    expect(furnitureAfter).toBe(furnitureBefore);
  });
});

test.describe("存檔面板 - AC13 100 輪軟上限", () => {
  test("達 100 輪顯示提示,送出鈕仍可用", async ({ page }) => {
    await mockAiConfig(page);
    await mockPlansList(
      page,
      defaultSlots({
        1: { slot: 1, occupied: true, name: "配置1", updatedAt: "2026-07-19T08:00:00Z" },
      }),
    );
    const conversation: { role: string; content: unknown }[] = [];
    for (let i = 0; i < 100; i += 1) {
      conversation.push({
        role: "user",
        content: [{ type: "text", text: `第 ${i} 輪訊息` }],
      });
      conversation.push({
        role: "assistant",
        content: [{ type: "text", text: `回覆 ${i}` }],
      });
    }
    await mockPlanSlot(page, {
      onGet: async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            planId: PLAN_ID_1,
            slot: 1,
            name: "配置1",
            plan: FIXTURE_PLAN,
            updatedAt: "2026-07-22T00:00:00Z",
            conversation,
          }),
        });
      },
    });

    const editor = new PlanEditorPage(page);
    const ai = new AiPanelPage(page);
    const slots = new PlanSlotsPage(page);
    await editor.navigate();
    await slots.open();
    await slots.loadSlot(1);
    await ai.open();

    await expect(ai.turnLimitHint).toBeVisible();
    await expect(ai.sendButton).toBeEnabled();
  });
});

test.describe("存檔面板 - Error States", () => {
  test("GET /api/plans 失敗顯示錯誤與重試", async ({ page }) => {
    await mockPlansListError(page, 500);

    const editor = new PlanEditorPage(page);
    const slots = new PlanSlotsPage(page);
    await editor.navigate();
    await slots.open();

    await expect(slots.listError).toBeVisible();
  });

  test("讀檔失敗不清空/不覆蓋目前編輯器狀態", async ({ page }) => {
    await mockPlansList(
      page,
      defaultSlots({
        1: { slot: 1, occupied: true, name: "配置1", updatedAt: "2026-07-19T08:00:00Z" },
      }),
    );
    await mockPlanSlot(page, {
      onGet: async (route) => {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "伺服器錯誤" }),
        });
      },
    });

    const editor = new PlanEditorPage(page);
    const slots = new PlanSlotsPage(page);
    await editor.navigate();
    const vertexCountBefore = await editor.vertexCount();

    await slots.open();
    await slots.loadSlot(1);

    await expect(slots.loadError).toBeVisible();
    await expect(slots.dialog).toBeVisible();
    expect(await editor.vertexCount()).toBe(vertexCountBefore);
    await expect(editor.editor).toHaveAttribute("data-current-plan-id", "");
  });
});
