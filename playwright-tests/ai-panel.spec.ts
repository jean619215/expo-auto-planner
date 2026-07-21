import { test, expect, type Page } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";
import { AiPanelPage } from "./pages/AiPanelPage";
import { LoginPage } from "./pages/LoginPage";

// Playwright acceptance gate for 場地規劃 AI 助理 / Task 3(最後 task)。
// Covers AC1-AC4 from .claude/pipeline/orchestrator-output.md via mocked
// /api/ai/chat responses (page.route) — no real model call, no cost, no
// flakiness. /venue itself is not an auth-gated page (src/proxy.ts
// PROTECTED_PAGES), so no login is required to exercise the panel UI; the
// mock intercepts the request before it ever reaches the real (auth-gated)
// API route.

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

/** Mocks GET /api/ai/config (chatCost + initial balance shown on panel open, AC5). */
async function mockAiConfig(
  page: Page,
  {
    chatCost = 10,
    balance = 100,
  }: { chatCost?: number; balance?: number } = {},
) {
  await page.route("**/api/ai/config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ chatCost, balance }),
    });
  });
}

const TEXT_REPLY_FIXTURE: MockResponse = {
  status: 200,
  body: {
    content: [{ type: "text", text: "你好,我可以幫你規劃場地,請描述需求。" }],
    stopReason: "end_turn",
    usage: { inputTokens: 20, outputTokens: 12, cacheReadTokens: 0 },
    balance: 90,
  },
};

const GENERATE_PLAN_FIXTURE: MockResponse = {
  status: 200,
  body: {
    content: [
      { type: "text", text: "已經幫你規劃好一個簡單配置。" },
      {
        type: "tool_use",
        id: "toolu_generate_1",
        name: "generate_plan",
        input: {
          floor: [
            { x: 20, y: 20 },
            { x: 30, y: 20 },
            { x: 30, y: 30 },
            { x: 20, y: 30 },
          ],
          walls: [],
          columns: [],
          furniture: [
            { kind: "table", center: { x: 22, y: 22 }, rotationDeg: 0 },
            { kind: "table", center: { x: 26, y: 22 }, rotationDeg: 0 },
          ],
        },
      },
    ],
    stopReason: "tool_use",
    usage: { inputTokens: 40, outputTokens: 30, cacheReadTokens: 0 },
    balance: 80,
  },
};

const INSUFFICIENT_BALANCE_FIXTURE: MockResponse = {
  status: 402,
  body: { error: "點數不足", balance: 5 },
};

test.describe("AI 助理面板 - AC1 面板 UI", () => {
  test("開關切換顯示/隱藏面板,含訊息列表、輸入框、送出鈕、圖片上傳", async ({
    page,
  }) => {
    await mockAiConfig(page, { chatCost: 10, balance: 100 });

    const editor = new PlanEditorPage(page);
    const ai = new AiPanelPage(page);
    await editor.navigate();

    await expect(ai.panel).toBeHidden();
    await ai.open();

    await expect(ai.panel).toBeVisible();
    await expect(ai.messages).toBeVisible();
    await expect(ai.input).toBeVisible();
    await expect(ai.sendButton).toBeVisible();
    await expect(ai.imageButton).toBeVisible();
    await expect(ai.imageInput).toBeAttached();
    await expect(ai.balance).toBeVisible();

    // AC5:面板展開即見扣點值與餘額,不需先送出訊息。
    await expect(ai.chatCost).toHaveText("10");
    await expect(ai.balance).toHaveText("100");

    await ai.toggle.click();
    await expect(ai.panel).toBeHidden();
  });
});

test.describe("AI 助理面板 - AC2 對話流程", () => {
  test("送出訊息後顯示助理文字回應與更新後的點數餘額", async ({ page }) => {
    await mockAiConfig(page);
    await mockAiChat(page, [TEXT_REPLY_FIXTURE]);

    const editor = new PlanEditorPage(page);
    const ai = new AiPanelPage(page);
    await editor.navigate();
    await ai.open();

    await ai.sendMessage("幫我規劃一個小型攤位");

    await expect(ai.messages).toContainText("你好,我可以幫你規劃場地");
    await expect(ai.balance).toHaveText("90");
    await expect(ai.input).toHaveValue("");
  });

  test("送出中:輸入與按鈕 disabled、顯示 loading 指示", async ({ page }) => {
    await mockAiConfig(page);
    await mockAiChat(page, [{ ...TEXT_REPLY_FIXTURE, delayMs: 600 }]);

    const editor = new PlanEditorPage(page);
    const ai = new AiPanelPage(page);
    await editor.navigate();
    await ai.open();

    await ai.input.fill("哈囉");
    await ai.sendButton.click();

    await expect(ai.loading).toBeVisible();
    await expect(ai.input).toBeDisabled();
    await expect(ai.sendButton).toBeDisabled();

    await expect(ai.loading).toBeHidden();
    await expect(ai.input).toBeEnabled();
    await expect(ai.sendButton).toBeEnabled();
  });

  test(">3MB 圖片拒絕上傳,顯示錯誤且不送出", async ({ page }) => {
    await mockAiConfig(page);
    let requestSent = false;
    await page.route("**/api/ai/chat", async (route) => {
      requestSent = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(TEXT_REPLY_FIXTURE.body),
      });
    });

    const editor = new PlanEditorPage(page);
    const ai = new AiPanelPage(page);
    await editor.navigate();
    await ai.open();

    const oversizedBuffer = Buffer.alloc(3 * 1024 * 1024 + 1, 1);
    await ai.uploadImage({
      name: "too-big.png",
      mimeType: "image/png",
      buffer: oversizedBuffer,
    });

    await expect(ai.error).toBeVisible();
    await expect(ai.error).toContainText("3MB");
    expect(requestSent).toBe(false);
  });
});

test.describe("AI 助理面板 - AC3 tool call 執行", () => {
  test("generate_plan fixture 套用後 2D 平面圖出現對應家具,並顯示動作摘要", async ({
    page,
  }) => {
    await mockAiConfig(page);
    await mockAiChat(page, [GENERATE_PLAN_FIXTURE]);

    const editor = new PlanEditorPage(page);
    const ai = new AiPanelPage(page);
    await editor.navigate();
    await ai.open();

    await ai.sendMessage("幫我用預設方案產生一個場地");

    await expect(ai.actionSummary).toContainText("已產生配置");
    await expect(ai.actionSummary).toContainText("2 件家具");

    const furnitureCount = await editor.editor.getAttribute(
      "data-furniture-count",
    );
    expect(Number(furnitureCount)).toBe(2);
  });
});

test.describe("AI 助理面板 - AC4 錯誤與點數狀態", () => {
  test("402 顯示點數不足、目前餘額與商店連結,輸入保留可重送", async ({
    page,
  }) => {
    await mockAiConfig(page);
    await mockAiChat(page, [INSUFFICIENT_BALANCE_FIXTURE]);

    const editor = new PlanEditorPage(page);
    const ai = new AiPanelPage(page);
    await editor.navigate();
    await ai.open();

    const message = "幫我產生一個大型展場配置";
    await ai.sendMessage(message);

    await expect(ai.error).toBeVisible();
    await expect(ai.error).toHaveAttribute("role", "alert");
    await expect(ai.error).toContainText("點數不足");
    await expect(ai.error).toContainText("5");
    await expect(ai.error.locator("a[href='/shop']")).toBeVisible();

    // 輸入的訊息保留可重送(AC4)。
    await expect(ai.input).toHaveValue(message);
  });

  test("500 錯誤顯示 ai-error(role=alert),歷史不留失敗輪", async ({ page }) => {
    await mockAiConfig(page);
    await mockAiChat(page, [{ status: 500, body: { error: "伺服器錯誤" } }]);

    const editor = new PlanEditorPage(page);
    const ai = new AiPanelPage(page);
    await editor.navigate();
    await ai.open();

    await ai.sendMessage("測試伺服器錯誤");

    await expect(ai.error).toBeVisible();
    await expect(ai.error).toHaveAttribute("role", "alert");
    // 失敗輪不寫入歷史 — 訊息列表不應出現使用者剛剛送出的那則文字。
    await expect(ai.messages).not.toContainText("測試伺服器錯誤");
  });
});

// 真模型煙霧測試:預設 skip,需手動設定 PW_PAID_AI=1 才會執行(會花真錢,
// 見 orchestrator-output.md Assumption 3 — 不進 CI 門檻)。
test.describe("AI 助理面板 - 真模型煙霧測試 @paid", () => {
  test.skip(!process.env.PW_PAID_AI, "PW_PAID_AI 未設定,略過真模型呼叫");

  test("真實 API 問候語取得 200 與文字回應", async ({ page }) => {
    // /api/ai/chat 受 src/proxy.ts 保護,未登入必回 401 —
    // 真模型呼叫前必須先登入建立 session cookie(模式同
    // points-shop.spec.ts 的 loginAndGoToShop)。
    const email = process.env.PW_VERIFIED_EMAIL;
    const password = process.env.PW_VERIFIED_PASSWORD;
    if (!email || !password) {
      throw new Error(
        "缺少 PW_VERIFIED_EMAIL / PW_VERIFIED_PASSWORD — 請設定 .env.playwright.local 才能執行真模型煙霧測試",
      );
    }

    const loginPage = new LoginPage(page);
    await loginPage.navigate();
    await loginPage.login(email, password);
    await expect(page).toHaveURL(/\/$/);

    const editor = new PlanEditorPage(page);
    const ai = new AiPanelPage(page);
    await editor.navigate();
    await ai.open();

    // 強化斷言(AC6):鎖定真正發出的 POST /api/ai/chat 請求並確認 200,
    // 而非只看 optimistic user 訊息讓 messages 非空就判定通過 — 這樣才能
    // 重現並封死 2026-07-21 發生過的「測試綠但 server log 無請求紀錄」問題。
    const respPromise = page.waitForResponse(
      (r) =>
        r.url().includes("/api/ai/chat") && r.request().method() === "POST",
      { timeout: 90_000 },
    );
    await ai.sendMessage("你好");
    expect((await respPromise).status()).toBe(200);

    await expect(ai.lastAssistantText).toBeVisible({ timeout: 90_000 });
    await expect(ai.lastAssistantText).not.toHaveText("");
    await expect(ai.error).toBeHidden();
  });
});
