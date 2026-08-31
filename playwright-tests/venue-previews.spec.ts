import { test, expect } from "@playwright/test";
import { PlanEditorPage } from "./pages/PlanEditorPage";

// 驗收閘:第四輪 —— 目錄的模型縮圖與材質的樣式預覽。
//
// 使用者的話:「選地板貼圖希望有樣式的預覽」「選家具的時候也希望有模型的預覽
// 跟規格」。規格(尺寸/價格)第三輪 T7 就有了,這一輪補的是**圖**。
//
// 這裡守的重點不是「有沒有 <img>」,而是**那張圖是不是真的來自那個東西**:
//  - 同款不同尺寸的兩張桌子,縮圖必須不同(縮圖若是寫死的示意圖就會相同)
//  - 材質縮圖必須隨款式不同
//  - 而且整頁只多一個 WebGL context —— 一張卡一個 <Canvas> 會把步驟 02/03
//    的場景擠掉,那是這一輪最容易踩、且症狀最難查的坑(場景直接變空白)。

const TABLE_LOW = "TBL-120-75";
const TABLE_HIGH = "TBL-120-100"; // 同款、只有高度不同
const CHAIR = "CHR-45-90"; // GLB(離屏載入那條路徑)
const PLANT = "PLT-50-120"; // GLB

/** 沒有 GPU 的環境慢 3–4 倍,而縮圖要等離屏渲染(GLB 還要載檔)。 */
test.describe.configure({ timeout: 180_000 });

/** 用搜尋把某個品項叫出來,等它的縮圖畫好,回傳圖片來源。 */
async function thumbnailSrc(
  editor: PlanEditorPage,
  code: string,
): Promise<string> {
  const page = editor.page;
  await page.getByTestId("catalog-search").fill(code);
  const thumb = page.getByTestId(`catalog-thumbnail-${code}`);
  await expect(thumb).toHaveAttribute("data-loaded", "true", {
    timeout: 60_000,
  });
  return (await thumb.locator("img").getAttribute("src")) ?? "";
}

async function toStep2(editor: PlanEditorPage) {
  await editor.navigate();
  await editor.clickNextStep();
  await expect(editor.stepPreview).toBeVisible();
}

async function toRefined(editor: PlanEditorPage) {
  await editor.navigate();
  await editor.clickNextStep();
  await editor.goToRefined();
  await expect
    .poll(() => editor.refinedLightingReady(), { timeout: 60_000 })
    .toBe(true);
}

test.describe("Catalogue and surface previews (round 4)", () => {
  test("目錄卡片有模型縮圖,而且不同品項不是同一張圖", async ({ page }) => {
    test.slow();
    const editor = new PlanEditorPage(page);
    await toStep2(editor);

    const low = await thumbnailSrc(editor, TABLE_LOW);
    const chair = await thumbnailSrc(editor, CHAIR);

    expect(low.startsWith("data:image/png")).toBe(true);
    expect(chair.startsWith("data:image/png")).toBe(true);
    // 桌子與椅子長得完全不同,縮圖沒有理由一樣。相同就代表圖不是從那個品項
    // 畫出來的(例如共用了一張佔位圖)。
    expect(low).not.toBe(chair);
  });

  test("同款不同高度的縮圖不同 —— 圖是從實際幾何畫的", async ({ page }) => {
    test.slow();
    const editor = new PlanEditorPage(page);
    await toStep2(editor);

    const low = await thumbnailSrc(editor, TABLE_LOW);
    const high = await thumbnailSrc(editor, TABLE_HIGH);

    // 這兩項共用同一個程序化造型,只有高度參數不同(第三輪 D4)。縮圖若不是
    // 真的把幾何畫出來,而是依造型或子類挑一張圖,這兩張就會一模一樣。
    expect(low).not.toBe(high);
  });

  test("GLB 品項的縮圖也畫得出來(離屏載入那條路徑)", async ({ page }) => {
    test.slow();
    const editor = new PlanEditorPage(page);
    await toStep2(editor);

    const chair = await thumbnailSrc(editor, CHAIR);
    const plant = await thumbnailSrc(editor, PLANT);
    expect(chair.length).toBeGreaterThan(1000);
    expect(plant.length).toBeGreaterThan(1000);
    expect(chair).not.toBe(plant);
  });

  test("縮圖有快取:同一張卡再次出現時是同一張圖", async ({ page }) => {
    test.slow();
    const editor = new PlanEditorPage(page);
    await toStep2(editor);

    const first = await thumbnailSrc(editor, TABLE_LOW);
    // 搜尋別的品項再搜回來 —— 卡片會被卸載再掛載。
    await thumbnailSrc(editor, CHAIR);
    const second = await thumbnailSrc(editor, TABLE_LOW);

    // 完全相同的字串代表命中快取(重畫一次的 PNG 位元組不保證相同,而且那
    // 也正是我們不想要的:目錄捲動一次就重畫上百張圖)。
    expect(second).toBe(first);
  });

  test("縮圖沒有吃掉場景的 WebGL context —— 步驟 02/03 照常運作", async ({
    page,
  }) => {
    test.slow();
    const editor = new PlanEditorPage(page);
    await toStep2(editor);

    // 先讓一批縮圖畫出來(含 GLB 那條路徑),再進步驟 03。
    await thumbnailSrc(editor, TABLE_LOW);
    await thumbnailSrc(editor, CHAIR);
    await thumbnailSrc(editor, PLANT);
    await page.getByTestId("catalog-search-clear").click();

    await editor.goToRefined();
    await expect
      .poll(() => editor.refinedLightingReady(), { timeout: 60_000 })
      .toBe(true);
    // 場景真的有東西 —— context 被擠掉時的症狀正是「畫面空白但沒有錯誤」。
    expect(await editor.refinedFloorVertexCount()).toBeGreaterThan(2);
    expect(await editor.refinedMaterialsReady()).toBe(true);
  });

  test("材質選擇器每一格都有樣式縮圖,且不同款式不同圖", async ({ page }) => {
    test.slow();
    const editor = new PlanEditorPage(page);
    await toRefined(editor);

    expect(await editor.surfaceOptionCount("floor")).toBeGreaterThanOrEqual(3);
    expect(await editor.surfaceOptionCount("wall")).toBeGreaterThanOrEqual(3);

    const concrete = await editor.surfaceSwatchSource("floor", "concrete");
    const carpet = await editor.surfaceSwatchSource("floor", "carpet");
    const laminate = await editor.surfaceSwatchSource("floor", "laminate");

    // 程序化款式是現烘的 dataURL;實拍款式直接用它的 diffuse 檔 —— 兩條路徑
    // 都要有圖,而且來源形狀不同本身就是「走了不同路徑」的證據。
    expect(concrete.startsWith("data:image/png")).toBe(true);
    expect(carpet.startsWith("data:image/png")).toBe(true);
    expect(laminate).toContain("/textures/venue/");

    // 水泥與地毯的底色、粗糙度都不同,縮圖沒有理由一樣。
    expect(concrete).not.toBe(carpet);
  });

  test("點材質縮圖真的會換場景的材質", async ({ page }) => {
    test.slow();
    const editor = new PlanEditorPage(page);
    await toRefined(editor);

    expect(await editor.selectedSurface("floor")).toBe("concrete");
    await editor.selectFloorSurface("carpet");

    // 讀的是場景回報的實際套用值,不是選擇器自己的狀態。
    await expect
      .poll(() => editor.refinedSurfaceFloor(), { timeout: 60_000 })
      .toBe("carpet");
    expect(await editor.selectedSurface("floor")).toBe("carpet");
  });

  test("牆面縮圖同樣可用,且與地板各自獨立", async ({ page }) => {
    test.slow();
    const editor = new PlanEditorPage(page);
    await toRefined(editor);

    const painted = await editor.surfaceSwatchSource("wall", "painted");
    const dark = await editor.surfaceSwatchSource("wall", "dark");
    expect(painted.startsWith("data:image/png")).toBe(true);
    expect(painted).not.toBe(dark);

    await editor.selectWallSurface("dark");
    await expect
      .poll(() => editor.refinedSurfaceWall(), { timeout: 60_000 })
      .toBe("dark");
    // 換牆面不該把地板一起換掉。
    expect(await editor.refinedSurfaceFloor()).toBe("concrete");
  });
});
