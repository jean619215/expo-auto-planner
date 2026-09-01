import { test, expect, type Page } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";
import { AiPanelPage } from "./pages/AiPanelPage";
import { CONFIG_APPENDIX_HEADER } from "../src/lib/ai-panel/messages";
import {
  FLOOR_PRESETS,
  SURFACE_KEEP,
  SURFACE_WALL_DEFAULT,
  WALL_PRESETS,
} from "../src/lib/venue/surfacePresets";

// 驗收閘:AI 也能決定材質(貼皮)—— `set_surfaces`。
//
// 回饋原文:「貼皮也可以自動選嗎 / 應該說可以給 AI 主宰規畫嗎 貼皮」。
//
// 這一支的重點不是「state 有沒有被寫進去」,而是兩件更容易出事的事:
//
// 1. **不合法的款式必須明說,不能無聲退回第一款。** `floorPreset()` /
//    `wallPreset()` 查不到就回 presets[0] —— 直接拿它們當驗證的話,模型送了
//    一個不存在的款式,使用者會拿到水泥地板,而工具回報「已設定」。這正是
//    讓六角形塌成三角形的那一類 bug(PR #21)。
// 2. **材質要真的到得了 3D 場景。** 最後一項把探針從 GPU 讀回來的地板亮度
//    拿來比,而不是比選單的值。

const BOGUS = "no-such-preset";
const FLOOR_A = FLOOR_PRESETS[0].id;
const FLOOR_B = FLOOR_PRESETS[1].id;
const WALL_B = WALL_PRESETS[1].id;
const WALL_C = WALL_PRESETS[2].id;

interface MockResponse {
  status: number;
  body: unknown;
}

async function mockAiChat(page: Page, responses: MockResponse[]) {
  const bodies: string[] = [];
  let callIndex = 0;
  await page.route("**/api/ai/chat", async (route) => {
    bodies.push(route.request().postData() ?? "");
    const resp = responses[Math.min(callIndex, responses.length - 1)];
    callIndex += 1;
    await route.fulfill({
      status: resp.status,
      contentType: "application/json",
      body: JSON.stringify(resp.body),
    });
  });
  return bodies;
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

/**
 * 從送出去的請求主體裡取出附帶的「目前配置」JSON。
 *
 * 不要對整包 body 做字串比對 —— 那分不出「欄位真的在附錄裡」與「這個字剛好
 * 出現在別的地方」。這一項要驗的是附錄的**結構**(覆寫以索引而不是內部
 * wallId 送出),所以得真的解析出來。
 */
function appendixFrom(rawBody: string): {
  surfaces: {
    floor: string;
    wall: string;
    wallOverrides: { index: number; preset: string }[];
  };
} {
  const body = JSON.parse(rawBody) as { messages: { content: unknown }[] };
  const texts: string[] = [];
  for (const message of body.messages ?? []) {
    const content = message.content;
    if (typeof content === "string") {
      texts.push(content);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (
          block &&
          typeof block === "object" &&
          (block as { type?: string }).type === "text"
        ) {
          texts.push((block as { text: string }).text);
        }
      }
    }
  }
  const withAppendix = texts.filter((text) =>
    text.includes(CONFIG_APPENDIX_HEADER),
  );
  const last = withAppendix[withAppendix.length - 1];
  if (!last) throw new Error("請求裡沒有附帶目前配置");
  return JSON.parse(
    last
      .slice(last.indexOf(CONFIG_APPENDIX_HEADER) + CONFIG_APPENDIX_HEADER.length)
      .trim(),
  );
}

function setSurfaces(
  id: string,
  input: {
    floor: string;
    wall: string;
    wallOverrides: { index: number; preset: string }[];
  },
) {
  return { type: "tool_use", id, name: "set_surfaces", input };
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

/** 畫兩面牆再進步驟 02 —— 個別牆覆寫要有對象才驗得到。 */
async function openWithTwoWalls(page: Page) {
  const editor = new PlanEditorPage(page);
  const ai = new AiPanelPage(page);
  await editor.navigate();
  await editor.wallTool();
  await editor.drawWall({ x: 20, y: 20 }, { x: 23, y: 20 });
  await editor.wallTool();
  await editor.drawWall({ x: 20, y: 23 }, { x: 23, y: 23 });
  await editor.clickNextStep();
  await expect(editor.stepPreview).toBeVisible();
  await ai.open();
  return { editor, ai };
}

test.describe("AI 可以決定材質(set_surfaces)", () => {
  test("換地板款式:只動地板,牆面維持原狀", async ({ page }) => {
    await mockAiConfig(page);
    await mockAiChat(page, [
      reply("幫你換成木質地板。", [
        setSurfaces("toolu_floor", {
          floor: FLOOR_B,
          wall: SURFACE_KEEP,
          wallOverrides: [],
        }),
      ]),
    ]);

    const { editor, ai } = await openWithTwoWalls(page);
    const before = await editor.planSnapshotSurfaces();
    expect(before.floor).toBe(FLOOR_A);

    await ai.sendMessage("地板換成木頭");

    await expect
      .poll(async () => (await editor.planSnapshotSurfaces()).floor)
      .toBe(FLOOR_B);
    // keep 真的是「不動」,不是「重送一次目前值」—— 牆面必須原封不動。
    expect((await editor.planSnapshotSurfaces()).wall).toBe(before.wall);
  });

  test('三項都填 "keep":什麼都不改,而且明說沒有變更', async ({ page }) => {
    await mockAiConfig(page);
    await mockAiChat(page, [
      reply("好。", [
        setSurfaces("toolu_noop", {
          floor: SURFACE_KEEP,
          wall: SURFACE_KEEP,
          wallOverrides: [],
        }),
      ]),
    ]);

    const { editor, ai } = await openWithTwoWalls(page);
    const before = await editor.planSnapshotSurfaces();

    await ai.sendMessage("材質先不要動");

    // 「沒發生任何事」也要說出來 —— 不說的話模型會以為自己改過了。
    await expect(ai.actionSummary).toContainText("未變更");
    expect(await editor.planSnapshotSurfaces()).toEqual(before);
  });

  test("不存在的款式:不套用、不退回第一款,訊息指名是哪個款式", async ({
    page,
  }) => {
    await mockAiConfig(page);
    await mockAiChat(page, [
      reply("好的。", [
        setSurfaces("toolu_bad", {
          floor: BOGUS,
          wall: SURFACE_KEEP,
          wallOverrides: [],
        }),
      ]),
    ]);

    const { editor, ai } = await openWithTwoWalls(page);
    const before = await editor.planSnapshotSurfaces();

    await ai.sendMessage("地板換成大理石金箔");

    await expect(ai.actionSummary).toContainText(BOGUS);
    await expect(ai.actionSummary).toContainText("不在可用清單中");
    // 關鍵:**維持原狀**,不是悄悄變成第一款。用 floorPreset() 當驗證的
    // 版本在這裡會是綠的 —— 它會回 presets[0],剛好就是原本的值 ——
    // 所以下一項才把預設先改掉再驗一次。
    expect(await editor.planSnapshotSurfaces()).toEqual(before);
  });

  test("不存在的款式(已先手動改過地板):仍然維持使用者的選擇", async ({
    page,
  }) => {
    await mockAiConfig(page);
    await mockAiChat(page, [
      reply("好的。", [
        setSurfaces("toolu_bad2", {
          floor: BOGUS,
          wall: SURFACE_KEEP,
          wallOverrides: [],
        }),
      ]),
    ]);

    const { editor, ai } = await openWithTwoWalls(page);
    // 材質選單只在步驟 03,AI 面板只在步驟 01/02 可輸入(03 是 CSS 隱藏,
    // 見 AGENTS.md)—— 所以「先手動選、再叫 AI 改」一定要走這一趟往返。
    await editor.goToRefined();
    await editor.selectFloorSurface(FLOOR_B);
    expect((await editor.planSnapshotSurfaces()).floor).toBe(FLOOR_B);
    await editor.backToPreview();

    await ai.sendMessage("地板換成大理石金箔");
    await expect(ai.actionSummary).toContainText(BOGUS);

    // 無聲退回 presets[0] 的實作會在這裡把使用者選的木地板換成水泥。
    expect((await editor.planSnapshotSurfaces()).floor).toBe(FLOOR_B);
  });

  test("個別牆覆寫:指定索引的那面牆換款式,另一面不受影響", async ({
    page,
  }) => {
    await mockAiConfig(page);
    await mockAiChat(page, [
      reply("把第一面牆換成木紋。", [
        setSurfaces("toolu_wall", {
          floor: SURFACE_KEEP,
          wall: SURFACE_KEEP,
          wallOverrides: [{ index: 0, preset: WALL_C }],
        }),
      ]),
    ]);

    const { editor, ai } = await openWithTwoWalls(page);
    await ai.sendMessage("第一面牆換成木紋");

    await expect
      .poll(
        async () =>
          Object.keys((await editor.planSnapshotSurfaces()).wallOverrides)
            .length,
      )
      .toBe(1);
    const surfaces = await editor.planSnapshotSurfaces();
    expect(Object.values(surfaces.wallOverrides)).toEqual([WALL_C]);

    // 覆寫的鍵必須是那面牆真正的 id —— 存錯鍵的話設定會落在別面牆上,
    // 或者根本對不到任何牆。
    await editor.goToRefined();
    const firstWallId = await editor.wallSurfaceRowId(1);
    expect(Object.keys(surfaces.wallOverrides)).toEqual([firstWallId]);
  });

  test('個別牆填 "default":清掉覆寫、改回跟隨預設', async ({ page }) => {
    await mockAiConfig(page);
    await mockAiChat(page, [
      reply("改回預設。", [
        setSurfaces("toolu_clear", {
          floor: SURFACE_KEEP,
          wall: SURFACE_KEEP,
          wallOverrides: [{ index: 0, preset: SURFACE_WALL_DEFAULT }],
        }),
      ]),
    ]);

    const { editor, ai } = await openWithTwoWalls(page);
    await editor.goToRefined();
    await editor.setWallSurface(1, WALL_C);
    expect(
      Object.keys((await editor.planSnapshotSurfaces()).wallOverrides),
    ).toHaveLength(1);
    await editor.backToPreview();

    await ai.sendMessage("第一面牆改回預設");

    await expect
      .poll(
        async () =>
          Object.keys((await editor.planSnapshotSurfaces()).wallOverrides)
            .length,
      )
      .toBe(0);
  });

  test("牆索引不存在:跳過並指名索引,同一批的其他項照樣套用", async ({
    page,
  }) => {
    await mockAiConfig(page);
    await mockAiChat(page, [
      reply("好。", [
        setSurfaces("toolu_mix", {
          floor: FLOOR_B,
          wall: SURFACE_KEEP,
          wallOverrides: [{ index: 9, preset: WALL_C }],
        }),
      ]),
    ]);

    const { editor, ai } = await openWithTwoWalls(page);
    await ai.sendMessage("地板換木頭,順便把第十面牆換掉");

    await expect(ai.actionSummary).toContainText("牆 #9 不存在");
    // 一個壞掉的項目不該讓整批停擺。
    await expect
      .poll(async () => (await editor.planSnapshotSurfaces()).floor)
      .toBe(FLOOR_B);
  });

  test("附錄帶了目前材質(不然模型只能瞎猜「換成暖色系」)", async ({
    page,
  }) => {
    await mockAiConfig(page);
    const bodies = await mockAiChat(page, [reply("收到。", [])]);

    const { editor, ai } = await openWithTwoWalls(page);
    await editor.goToRefined();
    await editor.selectFloorSurface(FLOOR_B);
    await editor.selectWallSurface(WALL_B);
    await editor.setWallSurface(2, WALL_C);
    const wallTwoId = await editor.wallSurfaceRowId(2);
    await editor.backToPreview();

    await ai.sendMessage("現在的材質是什麼?");

    expect(bodies.length).toBeGreaterThan(0);
    const appendix = appendixFrom(bodies[bodies.length - 1]);

    expect(appendix.surfaces.floor).toBe(FLOOR_B);
    expect(appendix.surfaces.wall).toBe(WALL_B);
    // 覆寫以**索引**送出,不是內部 wallId —— 模型從來沒看過那些 id,
    // 送 id 給它等於送一串它無法對照的亂碼。
    expect(appendix.surfaces.wallOverrides).toEqual([
      { index: 1, preset: WALL_C },
    ]);
    expect(JSON.stringify(appendix.surfaces)).not.toContain(wallTwoId);
  });

  test("哨符值不會和任何款式 id 撞名", () => {
    // "keep" / "default" 是靠「不會是款式 id」成立的。哪天有人加一款叫
    // default 的牆面,個別牆設定會靜靜失效 —— 這一項讓它在當下就紅。
    for (const preset of [...FLOOR_PRESETS, ...WALL_PRESETS]) {
      expect(preset.id, "款式 id 撞到哨符值").not.toBe(SURFACE_KEEP);
      expect(preset.id, "款式 id 撞到哨符值").not.toBe(SURFACE_WALL_DEFAULT);
    }
  });

  test("材質真的到得了 3D 場景(從 GPU 讀回來,不是比選單的值)", async ({
    page,
  }) => {
    // 無 GPU 的環境走 SwiftShader 軟體算圖,烘焙 + readback 比開發機慢
    // 三四倍;這一項還要在步驟 02↔03 之間來回兩趟。
    test.slow();

    await mockAiConfig(page);
    await mockAiChat(page, [
      reply("換成布幕。", [
        setSurfaces("toolu_scene", {
          floor: SURFACE_KEEP,
          wall: WALL_B,
          wallOverrides: [],
        }),
      ]),
    ]);

    const { editor, ai } = await openWithTwoWalls(page);
    await editor.goToRefined();
    await expect
      .poll(async () => (await editor.refinedMaterialDiagnostics())?.ready, {
        timeout: 60_000,
      })
      .toBe(true);
    const before = await editor.refinedWallSurfaces();
    expect(before.length).toBeGreaterThan(0);
    expect(before[0].albedoMean).not.toBeNull();

    // AI 面板在步驟 03 是 CSS 隱藏的(AGENTS.md),要下指令得先退回 02。
    await editor.backToPreview();
    await ai.sendMessage("牆面換成布幕");
    await expect
      .poll(async () => (await editor.planSnapshotSurfaces()).wall)
      .toBe(WALL_B);

    await editor.goToRefined();
    await expect
      .poll(async () => (await editor.refinedMaterialDiagnostics())?.ready, {
        timeout: 60_000,
      })
      .toBe(true);
    const after = await editor.refinedWallSurfaces();

    // 門檻 0.05:`albedoMean` 是正規化到 0–1 的亮度,不是 0–255。實測
    // 白牌漆面 0.653 → 布幕 0.380,差 0.27;同一份材質重複量測的雜訊看
    // `wallAlbedo.seamDelta`,約 0.001。0.05 在兩者之間,離兩邊都夠遠。
    //
    // **只比烘出來的顏色,不比 materialUuid。** 02↔03 是互斥掛載(一次只有
    // 一個 WebGL context),往返一趟材質本來就會全部重建,uuid 必然不同 ——
    // 拿它當證據的話,這一項不管實作對不對都會綠。亮度是從 GPU 讀回來的
    // 烘焙結果,那才是「材質真的換了」。
    expect(after[0].albedoMean).not.toBeNull();
    expect(
      Math.abs((after[0].albedoMean ?? 0) - (before[0].albedoMean ?? 0)),
      `牆面亮度沒有改變(before=${before[0].albedoMean} after=${after[0].albedoMean})`,
    ).toBeGreaterThan(0.05);
  });
});
