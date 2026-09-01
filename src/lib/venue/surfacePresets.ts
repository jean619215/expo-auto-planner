// 步驟 03 地板/牆面的材質選項(feedback round 2, R6)。
//
// 純領域模組:只有資料,沒有 React / Three / DOM(AGENTS.md 分層)。
//
// 這一輪不做貼圖包,選項是**既有程序化烘焙的參數化** —— 換的是底色與粗糙度,
// 紋理生成邏輯(surfaceBakeShader.ts 的高度場)不動。刻意不讓 preset 改變
// 鋪貼尺寸:那個值同時被牆面 UV 的驗證表引用(venue-refined-materials 的
// T3),改它會讓實作與測試一起漂移。

/** 實拍貼圖組。三張都有才算完整 —— 少了法線,寫實度反而不如程序化那組。 */
export interface SurfaceTexturePack {
  map: string;
  normalMap: string;
  roughnessMap: string;
  /** 一張貼圖對應幾公尺。實拍貼圖的自然尺度比程序化那組小。 */
  tileM: number;
}

export interface SurfacePreset {
  id: string;
  label: string;
  /** 烘焙時的底色(十六進位)。有 textures 時不使用。 */
  color: string;
  /** 材質的粗糙度。地板走 roughnessMap,這個值當作烘焙的基準。 */
  roughness: number;
  /**
   * 有值代表這款走**實拍貼圖**,不走程序化烘焙。
   * 檔案由 scripts/build-venue-textures.mjs 產生,來源與授權見
   * public/textures/venue/ATTRIBUTION.md。
   */
  textures?: SurfaceTexturePack;
}

export const TEXTURE_BASE_PATH = "/textures/venue";

function pack(id: string, tileM: number): SurfaceTexturePack {
  return {
    map: `${TEXTURE_BASE_PATH}/${id}_diff.webp`,
    normalMap: `${TEXTURE_BASE_PATH}/${id}_nor.webp`,
    roughnessMap: `${TEXTURE_BASE_PATH}/${id}_rough.webp`,
    tileM,
  };
}

export const FLOOR_PRESETS: SurfacePreset[] = [
  { id: "concrete", label: "水泥", color: "#e7e5e4", roughness: 0.55 },
  { id: "wood", label: "木地板", color: "#b08050", roughness: 0.45 },
  { id: "carpet", label: "地毯", color: "#6b7280", roughness: 0.95 },
  { id: "stone", label: "石材", color: "#a8a29e", roughness: 0.35 },
  {
    id: "laminate",
    label: "木質地板(實拍)",
    color: "#b08050",
    roughness: 0.5,
    textures: pack("laminate", 2),
  },
  {
    id: "worn-concrete",
    label: "磨損水泥(實拍)",
    color: "#cfcac4",
    roughness: 0.7,
    textures: pack("worn-concrete", 4),
  },
];

export const WALL_PRESETS: SurfacePreset[] = [
  { id: "painted", label: "白牌漆面", color: "#d6d3d1", roughness: 0.85 },
  { id: "fabric", label: "布幕", color: "#94a3b8", roughness: 0.95 },
  { id: "wood", label: "木紋", color: "#a97c50", roughness: 0.6 },
  { id: "dark", label: "深色板", color: "#44403c", roughness: 0.75 },
  {
    id: "beige-plaster",
    label: "米色批土牆(實拍)",
    color: "#d9cfc2",
    roughness: 0.9,
    textures: pack("beige-plaster", 2),
  },
  {
    id: "dirty-carpet",
    label: "地毯牆布(實拍)",
    color: "#8b8378",
    roughness: 0.95,
    textures: pack("dirty-carpet", 2),
  },
];

export interface SurfaceSelection {
  floor: string;
  /**
   * **預設**牆面材質:沒有被個別指定的牆,以及柱子,都用這一款。
   *
   * 第三輪 T9 之前這是唯一的牆面設定(所有牆共用)。改成逐面牆之後它沒有消失
   * —— 一面牆都還沒畫的時候仍然要有東西可設定,新畫出來的牆也要有個起點。
   */
  wall: string;
  /**
   * 個別牆的覆寫,鍵是 `WallSegment.id`。沒有覆寫的牆不會出現在這裡。
   *
   * 第三輪 T9 定案「逐面牆各自設定」(備選是依方位分成恆定四組)。設定因此
   * **跟著那面牆本身走** —— 牆被刪掉重畫,設定跟著消失。那是誠實的行為:
   * 那面牆真的不存在了,假裝記得只會在下一次畫牆時冒出來歷不明的材質。
   */
  wallOverrides: Record<string, string>;
}

export const DEFAULT_SURFACE_SELECTION: SurfaceSelection = {
  floor: FLOOR_PRESETS[0].id,
  wall: WALL_PRESETS[0].id,
  wallOverrides: {},
};

function resolve(presets: SurfacePreset[], id: string): SurfacePreset {
  return presets.find((preset) => preset.id === id) ?? presets[0];
}

export function floorPreset(id: string): SurfacePreset {
  return resolve(FLOOR_PRESETS, id);
}

export function wallPreset(id: string): SurfacePreset {
  return resolve(WALL_PRESETS, id);
}

/**
 * 柱子沒有獨立選項 —— 跟隨牆面,只是壓暗一點以便與牆分辨。展場實務上柱子
 * 通常與牆同材質,多一組選單只是多一份狀態與 UI。
 */
export function columnPreset(wallId: string): SurfacePreset {
  const wall = wallPreset(wallId);
  return { ...wall, id: `${wall.id}-column`, color: darken(wall.color, 0.75) };
}

function darken(hex: string, factor: number): string {
  const value = hex.replace("#", "");
  const n = parseInt(value, 16);
  const r = Math.round(((n >> 16) & 0xff) * factor);
  const g = Math.round(((n >> 8) & 0xff) * factor);
  const b = Math.round((n & 0xff) * factor);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * 快取鍵:同一組選擇必須得到同一份烘焙結果。
 *
 * **只含地板與預設牆面** —— 這個鍵管的是 `bakeSurfaceTextures()` 那一份
 * (地板 4 張 + 預設牆 2 張 + 柱子 2 張),個別牆的覆寫各自以款式為鍵另外烘
 * (見 `bakeWallTextures`)。把覆寫也塞進來的話,改一面牆的材質會讓地板整份
 * 重烘 —— 那是 8 張 render target,而地板根本沒變。
 */
export function surfaceSelectionKey(selection: SurfaceSelection): string {
  return `${selection.floor}|${selection.wall}`;
}

/** 這面牆實際採用的款式 id:有覆寫就用覆寫,否則用預設。 */
export function wallPresetIdFor(
  selection: SurfaceSelection,
  wallId: string,
): string {
  const override = selection.wallOverrides[wallId];
  // 走 wallPreset() 解析而不是直接回傳字串:存檔裡可能留著已下架的款式 id,
  // 那時該退回第一款,而不是讓場景拿著一個查不到的 id 去烘焙。
  return override ? wallPreset(override).id : wallPreset(selection.wall).id;
}

/**
 * 場上實際用得到的牆面款式(去重,含預設)。烘焙的依據 —— 按**款式**烘而不是
 * 按牆烘:十面牆全設成木紋只需要一份木紋貼圖。
 */
export function wallPresetIdsInUse(
  selection: SurfaceSelection,
  wallIds: readonly string[],
): string[] {
  const ids = new Set<string>([wallPreset(selection.wall).id]);
  for (const wallId of wallIds) ids.add(wallPresetIdFor(selection, wallId));
  return [...ids].sort();
}

/** 設定(或以 null 清除)某一面牆的覆寫,回傳新的 selection。 */
export function withWallOverride(
  selection: SurfaceSelection,
  wallId: string,
  presetId: string | null,
): SurfaceSelection {
  const next = { ...selection.wallOverrides };
  if (presetId === null) {
    delete next[wallId];
  } else {
    next[wallId] = presetId;
  }
  return { ...selection, wallOverrides: next };
}

/**
 * 丟掉已經不存在的牆留下的覆寫。
 *
 * 牆刪掉之後覆寫如果還留著,存檔會慢慢累積查不到對象的設定;更糟的是新牆萬一
 * 拿到同一個 id,會突然套上前一面牆的材質。存檔前與讀檔後都要過這一關。
 */
export function pruneWallOverrides(
  selection: SurfaceSelection,
  wallIds: readonly string[],
): SurfaceSelection {
  const live = new Set(wallIds);
  const next: Record<string, string> = {};
  for (const [wallId, presetId] of Object.entries(selection.wallOverrides)) {
    if (live.has(wallId)) next[wallId] = presetId;
  }
  // 沒有東西被清掉時回**原本那個物件**,不是內容相同的新物件。呼叫端用
  // identity 判斷「有沒有變」來決定要不要 setState —— 每次都給新物件的話,
  // 那個判斷永遠成立,等於失效。
  const sameSize =
    Object.keys(next).length === Object.keys(selection.wallOverrides).length;
  return sameSize ? selection : { ...selection, wallOverrides: next };
}

/**
 * 讀檔用的正規化:補上缺少的欄位、把查不到的款式退回第一款。
 *
 * T9 之前存的檔沒有 `wallOverrides`,而 `Object.entries(undefined)` 會丟例外
 * —— 舊檔一讀就整頁掛掉。這裡是唯一該處理這件事的地方。
 */
export function normalizeSurfaceSelection(raw: {
  floor?: string;
  wall?: string;
  wallOverrides?: Record<string, string>;
}): SurfaceSelection {
  const overrides: Record<string, string> = {};
  for (const [wallId, presetId] of Object.entries(raw.wallOverrides ?? {})) {
    if (typeof presetId === "string") overrides[wallId] = wallPreset(presetId).id;
  }
  return {
    floor: floorPreset(raw.floor ?? "").id,
    wall: wallPreset(raw.wall ?? "").id,
    wallOverrides: overrides,
  };
}

// --- AI 工具用 -----------------------------------------------------------

/**
 * 「維持現狀」與「清除個別牆覆寫」的哨符值。
 *
 * 款式清單是**靜態常數**(和會長大的家具目錄不同),所以可以直接進 tool schema
 * 的 enum,留在 prompt cache 的前綴裡不必每輪付費。代價是 strict schema 的每個
 * 欄位都必須有值 —— 沒有「不填」這回事,所以「這次不動地板」得是一個明說出來
 * 的值,而不是靠省略。這樣模型也必須為「不改」做一次明確的決定。
 */
export const SURFACE_KEEP = "keep";
/** 個別牆的覆寫用:改回跟隨預設牆面。 */
export const SURFACE_WALL_DEFAULT = "default";

/**
 * 款式 id 是否真的存在。
 *
 * **不要用 `floorPreset()`/`wallPreset()` 做這件事** —— 它們查不到就退回第一款,
 * 那正是「無聲夾制」那一類 bug:模型送了一個不存在的款式,使用者拿到水泥地板,
 * 而工具回報成功。要判斷合法性就明說,要解析才用那兩支。
 */
export function isFloorPresetId(id: string): boolean {
  return FLOOR_PRESETS.some((preset) => preset.id === id);
}

export function isWallPresetId(id: string): boolean {
  return WALL_PRESETS.some((preset) => preset.id === id);
}

/** 款式 id + 標籤,給 tool description 用(靜態,不逐輪夾帶)。 */
export function presetLegend(presets: readonly SurfacePreset[]): string {
  return presets.map((preset) => `${preset.id}=${preset.label}`).join("、");
}
