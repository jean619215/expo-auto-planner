import { test, expect, type Page, type Route } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";
import { PlanSlotsPage } from "./pages/PlanSlotsPage";

// 精密 3D 場景 (步驟 03) — Task 5: 匯入 6 種真實家具模型
//
// task 4 的 venue-furniture-assets.spec.ts 守的是**產出物**(GLB 檔案本身、
// 授權、步驟 01/02 零請求);這支守的是**場景怎麼用它們**:
//
//   M1  六種 kind 全部以「等比」縮放進 FURNITURE_DEFAULTS 的目標框。
//       `scale` 在對外契約裡是**單一數字**這件事本身就是等比的證據 ——
//       非等比縮放無法用一個純量表示 —— 再加上「至少一軸貼齊目標、且沒有
//       任何一軸溢出」把「等比但縮錯倍率」也擋掉。
//   M2  cabinet 的模型方位修正(rotationY = 90°)真的讓長邊對上平面圖。
//   M3  沒有對應模型的三種展場家具(counter / bannerStand / podium)不走匯入
//       模型那條路,也不會被畫兩次(task 6 起改由程序化幾何繪製 —— 它們自己
//       的驗收在 venue-procedural-furniture.spec.ts)。
//   M4  植栽延後載入:plant.glb 必須排在 eager 那批**載完之後**才被請求。
//   M5  只請求場上真的有的 kind —— 擺一張桌子不該把六個 GLB 全拉下來。
//   M6  02 <-> 03 往返多次不累積 GPU 資源(clone 出來的 geometry 有被 dispose)。
//   M7  同 kind 多件共用一個 `<Instances>`,instance 數反映真實件數。
//   M8  件數超過 `<Instances>` 初始緩衝區容量時不得靜默截斷(review 抓到的
//       實際缺陷:300 張椅子只畫得出 256 張)。
//
// 全部走 [data-testid="refined-scene"] 上的 data-* 契約(探針/場景自身回報的
// 實際狀態),不做像素比對 —— 沿用 task 2/3 的做法。

/** GLB 載入是非同步的(fetch + Draco worker),遠晚於 data-lighting-ready。 */
async function waitForFurnitureModels(editor: PlanEditorPage) {
  await expect
    .poll(() => editor.refinedFurnitureModelsLoaded(), { timeout: 20_000 })
    .toBe(true);
}

async function step2CanvasCenter(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector<HTMLCanvasElement>(
      '[data-testid="venue-scene"] canvas',
    );
    return !!el && el.getBoundingClientRect().width > 300;
  });
  const canvas = page.locator('[data-testid="venue-scene"] canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error("venue-scene canvas not visible");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function clickFloor(page: Page, point: { x: number; y: number }) {
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.waitForTimeout(50);
  await page.mouse.up();
}

/**
 * Places one piece of furniture on the Step 2 canvas and asserts it landed.
 *
 * The click has to hit the floor plane in a perspective view, and the default
 * floor is only 10m x 10m — on screen that is a smallish diamond around the
 * canvas center, so a generous offset silently misses and places nothing.
 * Every test here needs an exact item count, so the placement is verified
 * rather than assumed — a miss fails on the spot with the offset that missed,
 * instead of surfacing later as a confusing "expected 3 got 1".
 */
async function placeFurnitureOnStep2(
  page: Page,
  editor: PlanEditorPage,
  kind: string,
  offsetPx: { x: number; y: number } = { x: 0, y: 0 },
) {
  const before = await editor.furnitureCount();
  await page.getByTestId(`furniture-place-${kind}`).click();
  const center = await step2CanvasCenter(page);
  await clickFloor(page, { x: center.x + offsetPx.x, y: center.y + offsetPx.y });
  await expect
    .poll(() => editor.furnitureCount(), {
      timeout: 5_000,
      message: `${kind} 沒有放上去 — 偏移 (${offsetPx.x}, ${offsetPx.y}) 可能點在地板之外`,
    })
    .toBe(before + 1);
}

/** Empty plan -> step 02, ready to place furniture. */
async function toStep2(editor: PlanEditorPage) {
  await editor.navigate();
  // 預設攤位在 feedback round 2 之後是 3x3m,而 3D 相機現在會 fit 到實際
  // 地板 —— 下面那些像素偏移是按「fit=50 的遠距取景」調出來的,場地一小,
  // 同樣的像素對應的世界距離就變小,家具會互相擋住彼此的點擊。開一塊
  // 50x50 的場地把取景距離調回原樣,這些偏移才維持原本的語意。
  await editor.applyCustomBoothSize(50, 50);
  await editor.clickNextStep();
}

/** kind -> FURNITURE_DEFAULTS 的 (w, height3d, h),與 src/lib/venue/furniture.ts 一致。 */
const MODEL_KINDS = [
  { kind: "table", target: [1.2, 0.75, 0.7] },
  { kind: "chair", target: [0.45, 0.9, 0.45] },
  { kind: "cabinet", target: [0.6, 1.8, 1.2] },
  { kind: "sofa", target: [1.8, 0.8, 0.8] },
  { kind: "plant", target: [0.5, 1.2, 0.5] },
  { kind: "display", target: [1.0, 1.6, 0.5] },
] as const;

/** M8 用來 mock 存檔載入的 API(沿用 venue-zoom-pan.spec.ts 的寫法)。 */
const PLAN_SLOT_RE = /\/api\/plans\/\d$/;

/** 沒有 Poly Haven 資產的展場專用家具(task 6 起改由程序化幾何繪製)。 */
const BOX_ONLY_KINDS = ["counter", "bannerStand", "podium"] as const;

/**
 * Records `/models/venue/*.glb` traffic **in order**, tagging requests and
 * responses separately so a test can assert one model was only requested
 * after another had already finished — which is what "deferred" means (M4).
 */
function collectGlbTimeline(page: Page): string[] {
  const timeline: string[] = [];
  const name = (url: string) => url.split("/").pop() ?? url;
  page.on("request", (req) => {
    if (req.url().includes("/models/venue/")) {
      timeline.push(`req:${name(req.url())}`);
    }
  });
  page.on("response", (res) => {
    if (res.url().includes("/models/venue/")) {
      timeline.push(`res:${name(res.url())}`);
    }
  });
  return timeline;
}

test.describe("精密 3D 場景 (步驟 03) - Task 5: 匯入真實家具模型", () => {
  test("M1: 六種 kind 全部等比縮放進 FURNITURE_DEFAULTS 的目標框", async ({
    page,
  }) => {
    // 六件家具逐一放置(每次都驗證真的放上去了)+ 六個 GLB 全載,本來就慢。
    test.slow();
    const editor = new PlanEditorPage(page);
    await toStep2(editor);

    // 步驟 02 是透視視角,而預設地板只有 10m x 10m(平面圖 20..30m),在螢幕
    // 上是一塊不大的菱形 —— 離中心水平約 ±60px、垂直約 ±15px 之外就點空了。
    // 這六個點都在那塊區域內,且落在互不相同的平面圖座標上。
    const offsets = [
      { x: -60, y: 0 },
      { x: -30, y: 0 },
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 60, y: 0 },
      { x: 0, y: -15 },
    ];
    for (const [index, entry] of MODEL_KINDS.entries()) {
      await placeFurnitureOnStep2(page, editor, entry.kind, offsets[index]);
    }

    await editor.goToRefined();
    await waitForFurnitureModels(editor);
    // plant 是 deferred 的那一批,要等它也進場才會有六份報告。
    await expect
      .poll(() => editor.refinedFurnitureModelReports().then((r) => r.length), {
        timeout: 20_000,
      })
      .toBe(MODEL_KINDS.length);

    for (const entry of MODEL_KINDS) {
      const report = await editor.refinedFurnitureModelReport(entry.kind);
      expect(report, `${entry.kind} 應該由匯入模型繪製`).toBeDefined();
      if (!report) continue;

      // 契約上 scale 就是一個數字 —— 三軸不可能各縮各的。這是「不得非等比
      // 拉伸變形」(AGENTS.md)最直接的證據。
      expect(Number.isFinite(report.scale), `${entry.kind} scale 應為有限數`)
        .toBe(true);
      expect(report.scale, `${entry.kind} scale 應為正數`).toBeGreaterThan(0);

      expect(report.targetM, `${entry.kind} 目標尺寸應取自 FURNITURE_DEFAULTS`)
        .toEqual([...entry.target]);

      // 沒有任何一軸溢出目標框(留 1mm 浮點容差)。
      const ratios = report.fittedM.map(
        (fitted, axis) => fitted / report.targetM[axis],
      );
      for (const [axis, ratio] of ratios.entries()) {
        expect(
          ratio,
          `${entry.kind} 第 ${axis} 軸溢出目標框(${report.fittedM[axis]} > ${report.targetM[axis]})`,
        ).toBeLessThanOrEqual(1 + 1e-3);
      }
      // 且至少一軸貼齊 —— 否則「等比」也可能是縮得莫名其妙的小。
      expect(
        Math.max(...ratios),
        `${entry.kind} 沒有任何一軸貼齊目標尺寸(最大佔比 ${Math.max(...ratios)})`,
      ).toBeGreaterThan(1 - 1e-3);
    }
  });

  test("M2: cabinet 的方位修正讓模型長邊對上平面圖長邊", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await placeFurnitureOnStep2(page, editor, "cabinet");

    await editor.goToRefined();
    await waitForFurnitureModels(editor);

    const report = await editor.refinedFurnitureModelReport("cabinet");
    expect(report).toBeDefined();
    if (!report) return;

    // 平面圖目標是 0.6(X) x 1.2(Z) —— 長邊在 Z。模型原生是 1.141 x 0.488,
    // 長邊在 X,所以 models.ts 給了 rotationY = 90。若那個 90 掉了,fittedM
    // 的長邊會落回 X,這條就紅。
    const [x, , z] = report.fittedM;
    expect(z, "cabinet 的長邊應在 Z 軸(rotationY=90 未生效?)").toBeGreaterThan(x);
    // 貼齊的那一軸必須是長邊 —— 只比大小還不夠,轉錯方向也可能 z > x。
    expect(z / report.targetM[2]).toBeGreaterThan(0.85);
  });

  test("M3: 沒有模型的三種展場家具不走匯入模型,且不會被畫兩次", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await toStep2(editor);

    const offsets = [
      { x: -40, y: 0 },
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ];
    for (const [index, kind] of BOX_ONLY_KINDS.entries()) {
      await placeFurnitureOnStep2(page, editor, kind, offsets[index]);
    }

    await editor.goToRefined();
    await waitForFurnitureModels(editor);

    expect(await editor.refinedFurnitureMeshCount()).toBe(BOX_ONLY_KINDS.length);
    expect(
      await editor.refinedFurnitureModelReports(),
      "counter / bannerStand / podium 沒有 Poly Haven 資產,不該有 model report",
    ).toEqual([]);

    // 三件家具、一件算一次 —— 若哪天模型分支與程序化分支同時命中,這個件數
    // 會翻倍。這條就是 task 5 -> task 6 交接時守住「不重複繪製」的那道線。
    await expect
      .poll(() => editor.refinedShadowCasterFurnitureCount(), { timeout: 10_000 })
      .toBe(BOX_ONLY_KINDS.length);
  });

  test("M4: 植栽延後載入 — plant.glb 排在 eager 那批載完之後", async ({
    page,
  }) => {
    const timeline = collectGlbTimeline(page);

    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await placeFurnitureOnStep2(page, editor, "table", { x: -30, y: 0 });
    await placeFurnitureOnStep2(page, editor, "plant", { x: 30, y: 0 });

    await editor.goToRefined();
    await waitForFurnitureModels(editor);
    await expect
      .poll(() => editor.refinedFurnitureModelReports().then((r) => r.length), {
        timeout: 20_000,
      })
      .toBe(2);

    const plantRequested = timeline.indexOf("req:plant.glb");
    const tableFinished = timeline.indexOf("res:table.glb");
    expect(plantRequested, "plant.glb 從未被請求").toBeGreaterThanOrEqual(0);
    expect(tableFinished, "table.glb 從未載完").toBeGreaterThanOrEqual(0);
    // 「延後」的定義就是這一行:plant 的請求發生在 eager 那批**收完之後**,
    // 而不是只在它後面一點點排隊。plant 是 1.32MB / 原生 96k 面,綁同一個
    // Suspense 會讓整個步驟 03 一起等它。
    expect(
      plantRequested,
      `plant.glb 未延後載入 (timeline: ${timeline.join(" -> ")})`,
    ).toBeGreaterThan(tableFinished);
  });

  test("M5: 只載入場上真的有的 kind", async ({ page }) => {
    const timeline = collectGlbTimeline(page);

    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await placeFurnitureOnStep2(page, editor, "table");

    await editor.goToRefined();
    await waitForFurnitureModels(editor);
    // 給其他模型「如果會被誤載,也該載完了」的時間。
    await page.waitForTimeout(2_000);

    const requested = timeline
      .filter((entry) => entry.startsWith("req:"))
      .map((entry) => entry.slice(4));
    expect(new Set(requested), "只擺了一張桌子,不該把其他 GLB 也拉下來").toEqual(
      new Set(["table.glb"]),
    );
  });

  test("M6: 02 <-> 03 往返多次不累積 GPU 資源(含家具模型)", async ({ page }) => {
    // 三趟往返 = 三次 WebGL context 重建 + 三次 GLB 掛載,本來就比一般案例慢;
    // 標成 slow 而不是偷偷砍掉往返次數(往返次數本身就是這條要測的東西)。
    test.slow();
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await placeFurnitureOnStep2(page, editor, "table", { x: -30, y: 0 });
    await placeFurnitureOnStep2(page, editor, "cabinet", { x: 30, y: 0 });

    await editor.goToRefined();
    await waitForFurnitureModels(editor);
    await expect
      .poll(() => editor.refinedFurnitureModelReports().then((r) => r.length), {
        timeout: 20_000,
      })
      .toBe(2);
    const first = {
      textures: await editor.refinedRendererTextures(),
      geometries: await editor.refinedRendererGeometries(),
    };

    for (let i = 0; i < 3; i++) {
      await editor.backToPreview();
      await expect(page.locator("canvas")).toHaveCount(1);
      await editor.goToRefined();
      await waitForFurnitureModels(editor);
      await expect
        .poll(() => editor.refinedFurnitureModelReports().then((r) => r.length), {
          timeout: 20_000,
        })
        .toBe(2);
      await expect(page.locator("canvas")).toHaveCount(1);
    }

    // normalizeModel() clone 出來的 geometry 是我們自己的,卸載時必須
    // dispose;material 沿用 GLB 的、生命週期歸 useGLTF 快取管。若哪天 clone
    // 忘了釋放,三次往返就會把 geometries 疊上去。
    expect(await editor.refinedRendererGeometries()).toBe(first.geometries);
    expect(await editor.refinedRendererTextures()).toBe(first.textures);
  });

  test("M7: 同 kind 多件共用一個 <Instances>,instance 數反映真實件數", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await placeFurnitureOnStep2(page, editor, "chair", { x: -40, y: 0 });
    await placeFurnitureOnStep2(page, editor, "chair", { x: 0, y: 0 });
    await placeFurnitureOnStep2(page, editor, "chair", { x: 40, y: 0 });

    await editor.goToRefined();
    await waitForFurnitureModels(editor);

    const reports = await editor.refinedFurnitureModelReports();
    expect(reports, "三張椅子只該有一份 chair 報告(共用同一組 geometry)").toHaveLength(1);
    expect(reports[0].kind).toBe("chair");
    expect(reports[0].instanceCount).toBe(3);

    // 件數走 InstancedMesh.count,不是 mesh 數 —— 三張椅子仍然只有
    // partCount 個 InstancedMesh。
    await expect
      .poll(() => editor.refinedShadowCasterFurnitureCount(), { timeout: 10_000 })
      .toBe(3);
  });

  test("M8: 件數超過初始緩衝區容量時,全部都要畫出來(不得靜默截斷)", async ({
    page,
  }) => {
    // review 抓到的實際缺陷:`<Instances>` 的矩陣緩衝區在第一次 render 就
    // 定案,原本寫死 256。用 300 張椅子讀存檔時,3D 只畫得出 256 張,多的 44
    // 張人間蒸發 —— 沒有錯誤、沒有警告,平面圖上卻明明有 300 張。
    //
    // 用 mock 的存檔載入而不是點 300 次:UI 放置一次要好幾百毫秒,而這條要
    // 驗的是容量,不是放置流程。
    test.slow();

    const COUNT = 300;
    const furniture = Array.from({ length: COUNT }, (_, i) => ({
      id: `chair-${i}`,
      // T2 之後存檔存的是目錄代碼;沒有 code 的舊形狀會被繪製端拒畫(D8)。
      code: "CHR-45-90",
      center: { x: 5 + (i % 50) * 0.5, y: 5 + Math.floor(i / 50) * 0.5 },
      rotationDeg: 0,
    }));

    await page.route(PLAN_SLOT_RE, async (route: Route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            planId: "33333333-3333-3333-3333-333333333333",
            slot: 1,
            name: "壓力測試",
            plan: {
              polygon: [
                { x: 2, y: 2 },
                { x: 40, y: 2 },
                { x: 40, y: 40 },
                { x: 2, y: 40 },
              ],
              walls: [],
              columns: [],
              furniture,
              venueSizeM: 200,
            },
            updatedAt: "2026-08-04T00:00:00Z",
            conversation: [],
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      });
    });
    await page.route(/\/api\/plans$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          slots: [
            {
              slot: 1,
              occupied: true,
              name: "壓力測試",
              updatedAt: "2026-08-04T00:00:00Z",
            },
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
        body: "[]",
      });
    });

    const editor = new PlanEditorPage(page);
    const slots = new PlanSlotsPage(page);
    await editor.navigate();
    await slots.open();
    await slots.loadSlot(1);
    await expect
      .poll(() => editor.furnitureCount(), { timeout: 15_000 })
      .toBe(COUNT);

    await editor.clickNextStep();
    await editor.goToRefined();
    await waitForFurnitureModels(editor);

    // 這一條讀的是探針從 `InstancedMesh.count` 量到的**實際繪製數**,不是
    // 元件自己宣稱的件數 —— 缺陷發生時報告仍然寫 300,只有這個數字會掉到 256。
    await expect
      .poll(() => editor.refinedShadowCasterFurnitureCount(), { timeout: 20_000 })
      .toBe(COUNT);

    const report = await editor.refinedFurnitureModelReport("chair");
    expect(report?.instanceCount).toBe(COUNT);
  });
});
