import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";
import { PlanEditorPage } from "./pages/PlanEditorPage";
import { AiPanelPage } from "./pages/AiPanelPage";
import { CONFIG_APPENDIX_HEADER } from "../src/lib/ai-panel/messages";

// 驗收閘:T4 AI schema 改用目錄代碼(stories/venue-catalog-and-quote-draft.md)。
//
// 決議是「自由字串 + 伺服器端驗證,不用 enum」:目錄會長大,enum 跟著改動會讓
// prompt cache 每次失效。代價是模型可以送出任何字串,所以**套用端必須自己驗**,
// 而且驗不過時要清楚說出原因、且不能拖垮同一批的其他 action。

const CHAIR = "CHR-45-90";
const TABLE = "TBL-120-75";
const BOGUS = "NOPE-999";

interface MockResponse {
  status: number;
  body: unknown;
}

async function mockAiChat(page: Page, responses: MockResponse[]) {
  let callIndex = 0;
  await page.route("**/api/ai/chat", async (route) => {
    const resp = responses[Math.min(callIndex, responses.length - 1)];
    callIndex += 1;
    await route.fulfill({
      status: resp.status,
      contentType: "application/json",
      body: JSON.stringify(resp.body),
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

function toolUse(name: string, id: string, input: unknown) {
  return { type: "tool_use", id, name, input };
}

function reply(text: string, blocks: unknown[]): MockResponse {
  return {
    status: 200,
    body: {
      content: [{ type: "text", text }, ...blocks],
      stopReason: "tool_use",
      usage: { inputTokens: 40, outputTokens: 30, cacheReadTokens: 0 },
      balance: 80,
    },
  };
}

async function openPreviewWithAi(page: Page) {
  const editor = new PlanEditorPage(page);
  const ai = new AiPanelPage(page);
  await editor.navigate();
  await editor.wallTool();
  await editor.drawWall({ x: 20, y: 20 }, { x: 25, y: 20 });
  await editor.clickNextStep();
  await expect(editor.stepPreview).toBeVisible();
  await ai.open();
  return { editor, ai };
}

test.describe("AI tool schema keyed by catalogue code (T4)", () => {
  test("合法代碼 → 家具正確放置,且尺寸來自目錄", async ({ page }) => {
    await mockAiConfig(page);
    await mockAiChat(page, [
      reply("已幫你加上一張椅子。", [
        toolUse("add_furniture", "toolu_ok_1", {
          code: CHAIR,
          center: { x: 24, y: 24 },
          rotationDeg: 0,
        }),
      ]),
    ]);

    const { editor, ai } = await openPreviewWithAi(page);
    await ai.sendMessage("幫我加一張椅子");

    await expect(editor.scene).toHaveAttribute("data-furniture-mesh-count", "1");
    const furniture = await editor.furniture();
    expect(furniture).toHaveLength(1);
    expect(furniture[0].code).toBe(CHAIR);
  });

  test("不存在的代碼 → 不新增家具,面板說出是哪個代碼", async ({ page }) => {
    await mockAiConfig(page);
    await mockAiChat(page, [
      reply("好的。", [
        toolUse("add_furniture", "toolu_bad_1", {
          code: BOGUS,
          center: { x: 24, y: 24 },
          rotationDeg: 0,
        }),
      ]),
    ]);

    const { editor, ai } = await openPreviewWithAi(page);
    await ai.sendMessage("加一張不存在的家具");

    // 訊息要指名代碼 —— 只說「失敗」的話,使用者與模型都不知道錯在哪。
    await expect(ai.actionSummary).toContainText(BOGUS);
    await expect(ai.actionSummary).toContainText("不在家具目錄裡");
    expect(await editor.furnitureCount()).toBe(0);
    await expect(editor.scene).toHaveAttribute("data-furniture-mesh-count", "0");
  });

  test("同一批裡一個代碼壞掉,其餘合法的仍然套用", async ({ page }) => {
    await mockAiConfig(page);
    await mockAiChat(page, [
      reply("幫你加兩件。", [
        toolUse("add_furniture", "toolu_mix_1", {
          code: BOGUS,
          center: { x: 22, y: 22 },
          rotationDeg: 0,
        }),
        toolUse("add_furniture", "toolu_mix_2", {
          code: TABLE,
          center: { x: 24, y: 24 },
          rotationDeg: 0,
        }),
      ]),
    ]);

    const { editor, ai } = await openPreviewWithAi(page);
    await ai.sendMessage("加兩件家具");

    // 壞的被擋下、好的照放 —— 一個壞代碼不該讓整批停擺。
    await expect(ai.actionSummary).toContainText(BOGUS);
    await expect
      .poll(() => editor.furnitureCount(), { timeout: 10_000 })
      .toBe(1);
    const furniture = await editor.furniture();
    expect(furniture[0].code).toBe(TABLE);
  });

  test("generate_plan 裡的壞代碼只跳過那一件,配置照樣產生", async ({
    page,
  }) => {
    await mockAiConfig(page);
    await mockAiChat(page, [
      reply("已產生配置。", [
        toolUse("generate_plan", "toolu_gen_1", {
          floor: [
            { x: 18, y: 18 },
            { x: 26, y: 18 },
            { x: 26, y: 26 },
            { x: 18, y: 26 },
          ],
          walls: [],
          columns: [],
          furniture: [
            { code: BOGUS, center: { x: 20, y: 20 }, rotationDeg: 0 },
            { code: TABLE, center: { x: 22, y: 22 }, rotationDeg: 0 },
          ],
        }),
      ]),
    ]);

    const { editor, ai } = await openPreviewWithAi(page);
    await ai.sendMessage("幫我產生一份配置");

    await expect
      .poll(() => editor.furnitureCount(), { timeout: 10_000 })
      .toBe(1);
    const furniture = await editor.furniture();
    expect(furniture[0].code).toBe(TABLE);
    // 地板照樣換掉了 —— 壞代碼沒有讓整個 generate_plan 作廢。
    await expect.poll(() => editor.vertexCount()).toBe(4);
    await expect(ai.actionSummary).toContainText("已產生配置");
    await expect(ai.actionSummary).toContainText(BOGUS);
  });

  test("模型拿得到可用代碼:目前配置附錄帶著目錄", async ({ page }) => {
    await mockAiConfig(page);
    let sentBody: string | null = null;
    await page.route("**/api/ai/chat", async (route) => {
      sentBody = route.request().postData();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          content: [{ type: "text", text: "收到。" }],
          stopReason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 },
          balance: 90,
        }),
      });
    });

    const { ai } = await openPreviewWithAi(page);
    await ai.sendMessage("有哪些家具可以選?");

    await expect.poll(() => sentBody !== null).toBe(true);
    const body = sentBody as unknown as string;
    // schema 沒有 enum,模型只能從這裡知道有哪些代碼可用。
    expect(body).toContain(CONFIG_APPENDIX_HEADER);
    expect(body).toContain("catalogue");
    expect(body).toContain(CHAIR);
    expect(body).toContain(TABLE);
  });

  test("tool schema 裡沒有品項代碼的 enum,system prompt 仍是凍結字串", () => {
    const toolsSrc = readFileSync(
      path.join(process.cwd(), "src/lib/ai/tools.ts"),
      "utf8",
    );

    // 目錄會長大。代碼一旦進了 enum,每加一個品項就改動 tools 區塊,
    // prompt cache 的前綴跟著失效 —— 這正是決議要避開的。
    expect(toolsSrc, "tool schema 出現了品項代碼").not.toContain(CHAIR);
    expect(toolsSrc, "tool schema 出現了品項代碼").not.toContain(TABLE);
    // 舊的 kind enum 也不該留著。
    expect(toolsSrc).not.toContain('"bannerStand"');

    // system prompt 是凍結字串:不得為了目錄插值(AGENTS.md 既有硬規定)。
    const systemSrc = readFileSync(
      path.join(process.cwd(), "src/lib/ai/system.ts"),
      "utf8",
    );
    expect(systemSrc, "system prompt 出現了模板插值").not.toMatch(/\$\{/);
    expect(systemSrc).not.toContain(CHAIR);
  });

  test("kind 橋接表已刪除,沒有留著沒人用", () => {
    const furnitureSrc = readFileSync(
      path.join(process.cwd(), "src/lib/venue/furniture.ts"),
      "utf8",
    );
    expect(furnitureSrc).not.toContain("KIND_TO_CODE");
    expect(furnitureSrc).not.toContain("codeForKind");
    expect(furnitureSrc).not.toContain("FurnitureKind");
  });
});
