import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { PlanEditorPage } from "./pages/PlanEditorPage";
import { catalogItem } from "../src/lib/venue/catalog";

// 驗收閘:第三輪 T1 —— 可編輯範圍 = 攤位尺寸 + 5m 邊距,取代固定的 200m 見方。
//
// 舊行為讓使用者可以把柱子拖到離攤位 190m 外(畫面上就是「東西不見了」),
// 而且格線每軸要畫 200 條。範圍跟著攤位走之後兩個問題一起消失,同時攤位外
// 那圈 5m 邊距成為重排時的暫存區。
//
// 攤位錨在 BOOTH_ORIGIN = (20, 20),邊距 5m,所以預設 3×3 攤位的地板是
// [20,23]²,可編輯範圍是 [15,28]² —— 13×13。下面的座標都照這個算。

const MARGIN_M = 5;
const ORIGIN = { x: 20, y: 20 };
// 預設 3×3 攤位的可編輯範圍邊界,**由規格算出來、寫死在測試裡**。
// 夾制類斷言一律拿這兩個值比,不要拿 `data-plan-area` 回報的值 —— 那是
// 實作自己說的,實作壞掉時兩邊會一起壞,守衛就形同虛設。
const MIN_EDGE_M = ORIGIN.x - MARGIN_M; // 15
const MAX_EDGE_M = ORIGIN.x + 3 + MARGIN_M; // 28

test.describe("Plan area follows the booth (T1)", () => {
  test("預設 3×3 攤位的可編輯範圍是 13×13,且錨在攤位外一圈邊距", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    const area = await editor.planArea();
    expect(area.widthM).toBeCloseTo(13, 6);
    expect(area.heightM).toBeCloseTo(13, 6);
    // 不只看大小 —— 位置也要對,否則 13×13 可能是從原點量的。
    expect(area.minX).toBeCloseTo(ORIGIN.x - MARGIN_M, 6);
    expect(area.minY).toBeCloseTo(ORIGIN.y - MARGIN_M, 6);
    expect(area.maxX).toBeCloseTo(ORIGIN.x + 3 + MARGIN_M, 6);
    expect(area.maxY).toBeCloseTo(ORIGIN.y + 3 + MARGIN_M, 6);
  });

  test("換成 9×3 攤位後,範圍變成 19 × 13(長短邊分開跟著走)", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.applyCustomBoothSize(9, 3);

    await expect
      .poll(async () => (await editor.planArea()).widthM)
      .toBeCloseTo(19, 6);
    const area = await editor.planArea();
    expect(area.heightM).toBeCloseTo(13, 6);
  });

  test("柱子拖到範圍外會停在邊界上,不會跑到 200m 外", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.columnTool();
    await editor.placeColumn({ x: 21, y: 21 });

    const column = (await editor.objects()).columns[0];

    // 目標遠在舊上限那一帶。夾制生效的話柱子會停在邊界內緣。
    await editor.dragObjectBody({ x: column.center.x, y: column.center.y }, { x: 120, y: 120 });

    const moved = (await editor.objects()).columns[0];
    // **寫死 28**,不讀 `data-plan-area`。拿探針回報的範圍當基準會讓這個
    // 斷言變成空守衛:把實作改回固定 200m,回報的 maxX 也跟著變 200,
    // 兩邊一起漂移就永遠成立。破壞驗證時實測過這件事。
    expect(moved.center.x + moved.w / 2).toBeLessThanOrEqual(MAX_EDGE_M + 1e-6);
    expect(moved.center.y + moved.h / 2).toBeLessThanOrEqual(MAX_EDGE_M + 1e-6);
    // 真的被拖動了(不是原地沒動所以剛好通過)。
    expect(moved.center.x).toBeGreaterThan(column.center.x);
  });

  test("縮小攤位後,落在新範圍外的家具被夾回範圍內", async ({ page }) => {
    // 掛了 WebGL 場景(步驟 02 擺家具),沒有 GPU 的環境要慢得多 —— 見
    // AGENTS.md「重量級 3D 測試要明確編列 timeout 預算」。
    test.slow();
    // 2D 沒有家具放置工具(家具只在步驟 02 擺),所以家具的夾制走另一條
    // 2D 可達的路徑:先在步驟 02 擺一件,回步驟 01 把攤位縮小,範圍跟著縮,
    // 原本合法的位置就變成範圍外。拖曳那條路徑與柱子共用同一個
    // `clampColumnCenter(..., planArea)`,已由上一個案例覆蓋。
    const editor = new PlanEditorPage(page);
    await editor.navigate();
    await editor.applyCustomBoothSize(20, 20);
    await editor.clickNextStep();

    await page.getByTestId("furniture-place-TBL-120-75").click();
    const canvas = page.locator('[data-testid="venue-scene"] canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error("venue-scene canvas not visible");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => editor.furnitureCount()).toBe(1);

    await editor.clickBackToEdit();
    const before = (await editor.furniture())[0];

    // 家具此時在 20×20 攤位的中央附近(約 30, 30),縮到 3×3 之後可編輯範圍
    // 只剩 [15,28],30 落在外面。刻意用差距夠大的尺寸:9×9 縮到 3×3 時家具
    // 反而還在邊距裡不會被夾 —— 那是邊距該有的行為,不是可以拿來驗夾制的情境。
    // 所以確認對話框一定會跳,這裡明確等它、明確按下去,不吞例外。
    await editor.applyCustomBoothSize(3, 3);
    await expect(editor.boothSizeConfirmDialog).toBeVisible();
    expect(await editor.boothOutsideCount()).toBeGreaterThan(0);
    await editor.acceptBoothSize();

    await expect
      .poll(async () => (await editor.planArea()).widthM)
      .toBeCloseTo(13, 6);
    const area = await editor.planArea();
    const after = (await editor.furniture())[0];

    // T2 之後家具身上只有代碼,外廓尺寸查目錄。
    const spec = catalogItem(after.code)!;
    expect(after.center.x - spec.w / 2).toBeGreaterThanOrEqual(area.minX - 1e-6);
    expect(after.center.x + spec.w / 2).toBeLessThanOrEqual(area.maxX + 1e-6);
    expect(after.center.y - spec.d / 2).toBeGreaterThanOrEqual(area.minY - 1e-6);
    expect(after.center.y + spec.d / 2).toBeLessThanOrEqual(area.maxY + 1e-6);
    // 真的被移動過,不是本來就在範圍內所以自動通過。
    expect(after.center).not.toEqual(before.center);
  });

  test("地板頂點拖到範圍外同樣被夾住", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    const before = await editor.vertices();
    // 右下角那顆頂點,往遠處拖。
    const target = before.reduce((a, b) => (a.x + a.y > b.x + b.y ? a : b));

    await editor.dragObjectBody({ x: target.x, y: target.y }, { x: 150, y: 150 });

    const after = await editor.vertices();
    // 同案例3:寫死邊界,不讀探針。這一項守的是「拖曳頂點不會把範圍一起
    // 撐大」—— 曾經真的會:範圍由地板即時推導時,一次 8 步的拖曳讓地板
    // 長到 63m,而讀探針的版本照樣全綠。
    for (const v of after) {
      expect(v.x).toBeLessThanOrEqual(MAX_EDGE_M + 1e-6);
      expect(v.y).toBeLessThanOrEqual(MAX_EDGE_M + 1e-6);
      expect(v.x).toBeGreaterThanOrEqual(MIN_EDGE_M - 1e-6);
      expect(v.y).toBeGreaterThanOrEqual(MIN_EDGE_M - 1e-6);
    }
  });

  test("格線條數跟著範圍降下來(舊行為是每軸 200 條)", async ({ page }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    // 13×13 的範圍,1m 一條 → 每軸 14 條、共 28 條上下。舊值是 402
    // (每軸 201 條),所以這個上限抓得住「其實沒有跟著範圍走」。
    const count = await editor.gridLineCount();
    expect(count).toBeGreaterThan(20);
    expect(count).toBeLessThan(40);
  });

  test("攤位外 2m 放得下柱子,6m 放不下(邊距是可用的暫存區)", async ({
    page,
  }) => {
    const editor = new PlanEditorPage(page);
    await editor.navigate();

    // 攤位右緣在 x=23。+2m = 25,在邊距內;+6m = 29,超出 maxX=28。
    await editor.columnTool();
    await editor.placeColumn({ x: 25, y: 21 });
    const inMargin = (await editor.objects()).columns[0];
    expect(inMargin.center.x).toBeCloseTo(25, 6);

    await editor.columnTool();
    await editor.placeColumn({ x: 29, y: 21 });
    const outside = (await editor.objects()).columns[1];
    expect(outside.center.x).toBeLessThan(29);
    expect(outside.center.x + outside.w / 2).toBeLessThanOrEqual(
      MAX_EDGE_M + 1e-6,
    );
  });

  test("固定的 200m 常數已從 src/ 移除,不是留著沒人用", () => {
    const root = path.join(process.cwd(), "src");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry)) {
          if (readFileSync(full, "utf8").includes("PLAN_AREA_SIZE_M")) {
            hits.push(full);
          }
        }
      }
    };
    walk(root);
    expect(hits, `PLAN_AREA_SIZE_M 仍存在於: ${hits.join(", ")}`).toEqual([]);
  });
});
