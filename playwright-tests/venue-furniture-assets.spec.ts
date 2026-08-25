import { test, expect, type Page } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";

// 精密 3D 場景 (步驟 03) — Task 4: 家具模型 asset pipeline
//
// 這支 spec 守的是 **asset pipeline 的產出物本身**,不是場景怎麼用它們
// (那是 task 5)。三條線:
//   (A) 6 個 GLB 真的被 serve 得出來,而且是有效的 GLB(magic + 版本),
//       體積在合理區間 —— 抓「腳本沒跑 / 檔案漏 commit / LFS 指標檔」這類問題。
//   (B) 授權記錄檔存在且真的寫著 CC0 與來源 —— 這是法務面的驗收,
//       缺了它整批資產就不能用。
//   (C) 步驟 01 / 02 全程不得請求任何 GLB。步驟 03 的資源只在進入時載入是
//       本 story 的核心效能約束(AGENTS.md:02 與 03 互斥掛載、03 的重資源
//       不得拖慢 2D 編輯)。
//
// (C) 在 task 4 當下是「先架好的門」—— 那時還沒有任何程式碼會去載 GLB,
// 所以它必然綠。task 5 接上真正的載入之後,它才開始有意義:反證方式是把
// 預載提前到步驟 02(在 VenueScene 的模組層呼叫 preload),C2/C3 會立刻紅。
// **不要因為平常看起來恆真就刪掉它。**

/**
 * 對應 scripts/build-venue-models.mjs 的 MODELS 與 src/lib/venue/models.ts。
 * 刻意複製一份而非 import,沿用既有 page-object 慣例(測試只認對外契約)。
 *
 * minBytes / maxBytes 是寬鬆的健全性區間,不是精確斷言 —— 換模型或調壓縮
 * 參數時體積本來就會變。它要抓的是數量級錯誤:0 或幾十 bytes(漏檔、
 * LFS 指標)、或幾十 MB(忘了壓縮就 commit)。
 */
const EXPECTED_MODELS = [
  { file: "table", minBytes: 50_000, maxBytes: 3_000_000 },
  { file: "chair", minBytes: 50_000, maxBytes: 3_000_000 },
  { file: "cabinet", minBytes: 50_000, maxBytes: 3_000_000 },
  { file: "sofa", minBytes: 50_000, maxBytes: 3_000_000 },
  { file: "plant", minBytes: 50_000, maxBytes: 4_000_000 },
  { file: "display", minBytes: 50_000, maxBytes: 3_000_000 },
];

const MODEL_BASE_PATH = "/models/venue";

/** 全部 GLB 合計的上限 —— 步驟 03 一次要吃下的傳輸量天花板。 */
const TOTAL_BUDGET_BYTES = 6_000_000;

/** glTF 二進位容器的 magic:ASCII "glTF" 的小端 uint32。 */
const GLB_MAGIC = 0x46546c67;

function collectGlbRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.toLowerCase().includes(".glb") || url.includes("/models/venue/")) {
      seen.push(url);
    }
  });
  return seen;
}

/**
 * 「零請求」是個否定斷言 —— 讀太快就一定綠,量不到任何東西。
 *
 * 這不是假設性的顧慮:拿「在步驟 02 的模組載入時就 preload」去反證這三條線
 * 時,C3 立刻紅了,但 C1/C2 仍然是綠的 —— 因為它們在預載請求真的發出去
 * 之前就已經斷言完畢。等一個安定窗口之後再讀,那次反證才會如預期地讓 C2
 * 也紅。
 */
async function settleForStrayRequests(page: Page) {
  await page.waitForTimeout(1_500);
}

test.describe("精密 3D 場景 (步驟 03) - Task 4: 家具模型 asset pipeline", () => {
  test("A1: 6 個 GLB 皆可取得,且為有效的 glTF 二進位容器", async ({
    request,
    baseURL,
  }) => {
    let total = 0;

    for (const model of EXPECTED_MODELS) {
      const url = `${baseURL}${MODEL_BASE_PATH}/${model.file}.glb`;
      const response = await request.get(url);

      expect(response.status(), `${model.file}.glb 應可取得`).toBe(200);

      const body = await response.body();
      total += body.byteLength;

      // GLB header:magic(uint32) / version(uint32) / length(uint32),全小端。
      expect(body.byteLength, `${model.file}.glb 太小,不足以容納 GLB header`)
        .toBeGreaterThan(12);
      expect(body.readUInt32LE(0), `${model.file}.glb magic 不是 "glTF"`).toBe(
        GLB_MAGIC
      );
      expect(body.readUInt32LE(4), `${model.file}.glb 應為 glTF 2.0`).toBe(2);
      // 宣告長度必須等於實際長度 —— 抓截斷檔。
      expect(
        body.readUInt32LE(8),
        `${model.file}.glb header 宣告長度與實際位元組數不符(檔案被截斷?)`
      ).toBe(body.byteLength);

      expect(body.byteLength).toBeGreaterThan(model.minBytes);
      expect(body.byteLength).toBeLessThan(model.maxBytes);
    }

    expect(total, "全部 GLB 合計超出步驟 03 的傳輸預算").toBeLessThan(
      TOTAL_BUDGET_BYTES
    );
  });

  test("A2: GLB 內含 Draco 與 WebP 擴充(壓縮確實套用了)", async ({
    request,
    baseURL,
  }) => {
    // GLB 的第一個 chunk 是 JSON,直接在位元組裡找擴充名稱即可 —— 不需要
    // 完整解析。若哪天壓縮步驟被拿掉,extensionsRequired 就不會有這兩個名字。
    for (const model of EXPECTED_MODELS) {
      const response = await request.get(
        `${baseURL}${MODEL_BASE_PATH}/${model.file}.glb`
      );
      const text = (await response.body()).toString("latin1");

      expect(text, `${model.file}.glb 未套用 Draco 幾何壓縮`).toContain(
        "KHR_draco_mesh_compression"
      );
      expect(text, `${model.file}.glb 貼圖未轉成 WebP`).toContain(
        "EXT_texture_webp"
      );
    }
  });

  test("B: 授權記錄檔存在,寫明 CC0 與 Poly Haven 來源,且涵蓋全部 6 個 kind", async ({
    request,
    baseURL,
  }) => {
    const response = await request.get(
      `${baseURL}${MODEL_BASE_PATH}/ATTRIBUTION.md`
    );
    expect(response.status()).toBe(200);

    const text = await response.text();
    expect(text).toContain("CC0");
    expect(text).toContain("polyhaven.com");

    for (const model of EXPECTED_MODELS) {
      expect(text, `授權記錄缺少 ${model.file}`).toContain(model.file);
    }
  });

  test("C1: 步驟 01(2D 平面圖編輯)全程零 GLB 請求", async ({ page }) => {
    const glbRequests = collectGlbRequests(page);

    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.wallTool();
    await editor.drawWall({ x: 20, y: 20 }, { x: 25, y: 20 });
    await editor.columnTool();
    await editor.placeColumn({ x: 15, y: 15 });

    expect(await editor.currentStep()).toBe("edit");
    await settleForStrayRequests(page);
    expect(glbRequests, "步驟 01 不得載入任何 3D 模型").toEqual([]);
  });

  // C2/C3 原本守的是「步驟 02 全程零 GLB 請求」。那條規定在 feedback
  // round 2 的 R5 被推翻了 —— 步驟 02 要顯示家具的真實輪廓,幾何就在 GLB
  // 裡,不下載就畫不出來。
  //
  // 換掉的守衛不是放寬,而是換到真正的分界上:貼圖是**嵌在 GLB 內**的,
  // 從來就不會有獨立的圖檔請求,所以用網路請求驗「有沒有載貼圖」本來就
  // 驗不到東西。實質的規定有兩條,分別由下面兩個案例接手:
  //
  //   * 步驟 02 家具材質上不得掛貼圖(venue-step2-shapes.spec.ts 驗材質)。
  //   * 步驟 03 專屬的地板/牆程序化材質在步驟 02 不得被烘焙(下面 C2)。
  //
  // 步驟 01 仍然是零 GLB(C1 不變)—— 那一步根本沒有 3D 場景。

  test("C2: 步驟 02 不觸發步驟 03 專屬的地板/牆材質烘焙", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.wallTool();
    await editor.drawWall({ x: 20, y: 20 }, { x: 25, y: 20 });
    await editor.clickNextStep();

    expect(await editor.currentStep()).toBe("preview");
    await expect.poll(() => editor.sceneGenerated(), { timeout: 15_000 }).toBe(true);
    await settleForStrayRequests(page);

    expect(
      await editor.sceneSurfaceBakes(),
      "步驟 02 烘焙了步驟 03 專屬的表面材質",
    ).toBe(0);
  });

  test("C3: 01 -> 02 -> 01 往返後,步驟 01 仍然沒有任何 3D 資源請求", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.wallTool();
    await editor.drawWall({ x: 20, y: 20 }, { x: 25, y: 20 });
    await editor.clickNextStep();
    await expect.poll(() => editor.sceneGenerated(), { timeout: 15_000 }).toBe(true);
    await editor.clickBackToEdit();
    expect(await editor.currentStep()).toBe("edit");

    // 回到步驟 01 之後才開始收集 —— 步驟 02 期間載 GLB 是預期行為,這裡
    // 要守的是「退回 2D 之後不再有新的 3D 資源請求」。
    const glbRequests = collectGlbRequests(page);
    await settleForStrayRequests(page);
    expect(glbRequests, "回到步驟 01 後仍在請求 3D 資源").toEqual([]);
  });
});
