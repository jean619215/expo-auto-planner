import { test, expect, type Page } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";
import { catalogItem, CATALOG } from "../src/lib/venue/catalog";

// 驗收閘:T3 繪製路徑改吃目錄(stories/venue-catalog-and-quote-draft.md)。
//
// T2 把資料搬進目錄,但繪製仍以舊的 `kind` 當索引鍵,靠一張對照表橋接。T3
// 拆掉那座橋:2D、白模輪廓、GLB、程序化幾何、探針分組、模型快取,全部改以
// **目錄代碼**為鍵。
//
// 這一輪要守的是「同一件家具在 2D 與 3D 是同一個尺寸」。改動前 2D 讀
// `item.w/h`(建立當下的快照)而 3D 讀常數表,兩邊可以各說各話 —— 這正是 D1
// 要消滅的不一致。

const TABLE = "TBL-120-75";
// T5 之後方正規格件全走程序化,仍是 GLB 的只剩椅/沙發/植栽。
// 「模型快取」相關的案例必須用這三者之一,否則場上根本沒有模型可快取。
const CHAIR = "CHR-45-90";
const COUNTER = "CNT-100-110";
const PODIUM = "POD-60-110";

/**
 * 進步驟 02 放一件家具。
 *
 * 動作序列(move → 停 → down → 停 → up)沿用 venue-step2-shapes.spec.ts:裸的
 * click 會在 OrbitControls 首輪 update 把相機安定下來之前送出,有機率打不到
 * 地板 mesh。
 *
 * 這裡比那支多兩件事,因為本 spec 每個案例都從乾淨的頁面進步驟 02,吃不到
 * 「前一個案例已經把場景暖起來」的便宜:
 *   1. 先等 `data-placing-code`,確認按鈕真的把放置模式打開了 —— 失敗時才分得出
 *      是沒進模式還是 raycast 打空。
 *   2. 地板點擊重試。放置成功後放置模式會自動關掉,所以重試不會放成兩件;
 *      而放置模式仍開著就代表上一次點擊根本沒打到地板。
 */
async function place(
  page: Page,
  editor: PlanEditorPage,
  code: string,
  offsetPx: { x: number; y: number } = { x: 0, y: 0 },
) {
  const before = await editor.furnitureCount();
  await page.getByTestId(`furniture-place-${code}`).click();
  await expect(editor.scene).toHaveAttribute("data-placing-code", code);

  const canvas = page.locator('[data-testid="venue-scene"] canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error("venue-scene canvas not visible");
  const point = {
    x: box.x + box.width / 2 + offsetPx.x,
    y: box.y + box.height / 2 + offsetPx.y,
  };

  // 點擊目標必須真的是 canvas。這同時是守衛與等待:守衛防的是日後某個覆蓋層
  // (AI 面板、工具列)蓋住畫面中央 —— 那會讓放置靜靜失敗,而錯誤訊息只會說
  // 「沒放上去」;等待則讓 R3F 多跑一輪,首次進場景時的 raycast 穩定不少。
  await expect
    .poll(
      () =>
        page.evaluate(
          ([x, y]) =>
            document.elementFromPoint(x as number, y as number)?.tagName ?? "",
          [point.x, point.y],
        ),
      { timeout: 10_000, message: "畫面中央不是 canvas — 有東西蓋住了" },
    )
    .toBe("CANVAS");

  // 本機無 GPU(SwiftShader),步驟 02 首次進場景時 raycast 常常前幾次打空。
  // 重試次數與間隔都放寬:放置成功會自動關掉放置模式,所以多點幾次不會放成
  // 兩件,而放置模式仍開著就表示上一次確實沒打到。
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if ((await editor.furnitureCount()) === before + 1) break;
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(200);
    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.up();
    await page.waitForTimeout(400);
  }

  await expect
    .poll(() => editor.furnitureCount(), {
      timeout: 10_000,
      message: `${code} 沒有放上去 — 偏移可能點在地板之外`,
    })
    .toBe(before + 1);
}

async function toStep2(editor: PlanEditorPage) {
  await editor.navigate();
  // 50×50 讓取景距離回到既有 spec 的基準,像素偏移才維持原本語意。
  await editor.applyCustomBoothSize(50, 50);
  await editor.clickNextStep();
  await expect(editor.stepPreview).toBeVisible();
  await expect
    .poll(() => editor.sceneGenerated(), { timeout: 20_000 })
    .toBe(true);
}

test.describe("Catalogue drives drawing (T3)", () => {
  test("2D 畫出的家具尺寸等於目錄宣告的 w × d", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await place(page, editor, TABLE);
    await editor.clickBackToEdit();

    const placed = (await editor.furniture())[0];
    expect(placed.code).toBe(TABLE);

    // 平面圖的矩形寬高來自目錄,不是品項自己存的快照 —— 品項身上已經沒有
    // w/h 可存(T2 第 5 項)。這裡驗的是「2D 真的去查了目錄」。
    const spec = catalogItem(TABLE)!;
    const rect = await editor.furnitureRectM(placed.id);
    expect(rect.w).toBeCloseTo(spec.w, 3);
    expect(rect.h).toBeCloseTo(spec.d, 3);
  });

  test("步驟 02 的實際 mesh 外廓與目錄一致", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await place(page, editor, COUNTER);

    const shapes = await expect
      .poll(async () => await editor.sceneFurnitureShapes(), {
        timeout: 20_000,
      })
      .not.toHaveLength(0)
      .then(() => editor.sceneFurnitureShapes());

    const shape = shapes.find((s) => s.code === COUNTER);
    expect(shape, `場上找不到 ${COUNTER} 的 mesh`).toBeTruthy();

    // 程序化品項是照目錄尺寸拼出來的,所以三軸都該剛好對上(1cm 容差)。
    const spec = catalogItem(COUNTER)!;
    expect(shape!.sizeM[0]).toBeCloseTo(spec.w, 2);
    expect(shape!.sizeM[1]).toBeCloseTo(spec.height3d, 2);
    expect(shape!.sizeM[2]).toBeCloseTo(spec.d, 2);
  });

  test("步驟 02 的 GLB 品項等比縮放後不超出目錄框,且至少一軸貼齊", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await place(page, editor, TABLE);

    await expect
      .poll(async () => (await editor.sceneFurnitureShapes()).length, {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);
    const shapes = await editor.sceneFurnitureShapes();
    const shape = shapes.find((s) => s.code === TABLE)!;

    // 匯入模型只能**等比**縮放(AGENTS.md 硬規定),所以它不可能三軸都剛好
    // 等於目錄尺寸 —— 那需要非等比拉伸。正確的關係是「都不超出,且至少一軸
    // 貼齊」:貼齊的那一軸就是限制縮放倍率的那一軸。
    const spec = catalogItem(TABLE)!;
    const target = [spec.w, spec.height3d, spec.d];
    for (let axis = 0; axis < 3; axis++) {
      expect(shape.sizeM[axis]).toBeLessThanOrEqual(target[axis] + 0.01);
    }
    const touching = [0, 1, 2].some(
      (axis) => Math.abs(shape.sizeM[axis] - target[axis]) < 0.01,
    );
    expect(touching, `沒有任何一軸貼齊目錄尺寸:${shape.sizeM} vs ${target}`).toBe(
      true,
    );
  });

  test("步驟 03 的量測同樣以目錄為準", async ({ page }) => {
    test.slow();
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await place(page, editor, COUNTER);
    await editor.goToRefined();

    await expect
      .poll(
        async () => (await editor.refinedProceduralFurnitureReports()).length,
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);

    const report = await editor.refinedProceduralFurnitureReport(COUNTER);
    expect(report, `步驟 03 沒有 ${COUNTER} 的量測`).toBeTruthy();

    const spec = catalogItem(COUNTER)!;
    expect(report!.targetM).toEqual([spec.w, spec.height3d, spec.d]);
    // targetM 是元件回報的目標值,sizeM 是零件拼出來的實際外廓 —— 兩者相符才
    // 代表「照目錄畫出來」,只看 targetM 只證明它讀了目錄。
    expect(report!.sizeM[0]).toBeCloseTo(spec.w, 2);
    expect(report!.sizeM[1]).toBeCloseTo(spec.height3d, 2);
    expect(report!.sizeM[2]).toBeCloseTo(spec.d, 2);
  });

  test("模型快取以代碼為鍵:往返步驟 03 三趟,totalBuilds 不增加", async ({
    page,
  }) => {
    test.slow();
    const editor = new PlanEditorPage(page);
    await toStep2(editor);
    await place(page, editor, CHAIR);

    await editor.goToRefined();
    await expect
      .poll(async () => (await editor.refinedFurnitureModelReports()).length, {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    const first = await editor.refinedFurnitureModelStats();

    for (let trip = 0; trip < 3; trip += 1) {
      await editor.clickBackToPreview();
      await expect(editor.stepPreview).toBeVisible();
      await editor.goToRefined();
      await expect
        .poll(async () => (await editor.refinedFurnitureModelReports()).length, {
          timeout: 30_000,
        })
        .toBeGreaterThan(0);
    }

    const after = await editor.refinedFurnitureModelStats();
    // 快取命中的證據是 totalBuilds 不動。它若跟著往返次數往上跑,代表每趟都
    // 重新 clone 了一次 GLB 幾何 —— 植栽那種 96k 面的品項會讓這件事很有感。
    expect(after.totalBuilds).toBe(first.totalBuilds);
  });

  test("探針以代碼分組:同一子類的不同品項各自計數", async ({ page }) => {
    test.slow();
    const editor = new PlanEditorPage(page);
    await toStep2(editor);

    // 櫃檯與講台是兩個代碼、兩種造型,但同屬「櫃檯與收納」大類。分組鍵若退回
    // 大類或造型,兩者會被併成一筆。
    await place(page, editor, COUNTER, { x: -80, y: 0 });
    await place(page, editor, PODIUM, { x: 80, y: 0 });

    await editor.goToRefined();
    await expect
      .poll(
        async () => (await editor.refinedProceduralFurnitureReports()).length,
        { timeout: 30_000 },
      )
      .toBe(2);

    const reports = await editor.refinedProceduralFurnitureReports();
    expect(reports.map((r) => r.code).sort()).toEqual([COUNTER, PODIUM].sort());
    for (const report of reports) {
      expect(report.instanceCount, `${report.code} 的件數`).toBe(1);
    }
  });

  test("繪製端沒有第二份尺寸表 —— 目錄是唯一來源", async () => {
    // 第 4 項(改目錄尺寸,2D 與 3D 同時跟著變)靠腳本化的破壞驗證確認,
    // 不放進套件:那需要在測試執行中改原始碼再等重建,失敗時會把 repo 留在
    // 被改過的狀態。這裡守的是它的靜態面 —— 繪製路徑不得自帶尺寸字面量。
    //
    // 用目錄本身推導期望值,而不是抄一份數字:抄一份就又是一個會分岔的來源。
    const { readFileSync } = await import("fs");
    const path = await import("path");

    const drawingFiles = [
      "src/components/venue/furnitureModels.tsx",
      "src/components/venue/whiteboxFurniture.tsx",
      "src/components/venue/proceduralFurniture.tsx",
      "src/components/venue/RefinedScene.tsx",
      "src/components/venue/PlanEditor.tsx",
    ];

    const offenders: string[] = [];
    for (const file of drawingFiles) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      // 舊的常數表與過渡橋都不該再出現在繪製路徑上。
      for (const banned of ["FURNITURE_DEFAULTS", "kindForCode"]) {
        if (new RegExp(`\\b${banned}\\b`).test(source)) {
          offenders.push(`${file} 仍引用 ${banned}`);
        }
      }
    }
    expect(offenders, offenders.join("; ")).toEqual([]);

    // 目錄之外不該再有第二份「代碼 -> 尺寸」的對照。
    const furnitureSource = readFileSync(
      path.join(process.cwd(), "src/lib/venue/furniture.ts"),
      "utf8",
    );
    expect(/FURNITURE_DEFAULTS/.test(furnitureSource)).toBe(false);
  });

  test("每個目錄品項都畫得出來 —— 沒有品項落進保底 box", async () => {
    // 保底 box 是給「目錄長出這裡還不認得的幾何種類」用的。目前九個品項應該
    // 全部走 model 或 procedural,一個都不該落到保底路徑。
    for (const item of CATALOG) {
      expect(
        ["model", "procedural"],
        `${item.code} 的幾何種類是 ${item.geometry.kind}`,
      ).toContain(item.geometry.kind);
    }
  });
});
