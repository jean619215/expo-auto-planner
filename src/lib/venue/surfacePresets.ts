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
  wall: string;
}

export const DEFAULT_SURFACE_SELECTION: SurfaceSelection = {
  floor: FLOOR_PRESETS[0].id,
  wall: WALL_PRESETS[0].id,
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

/** 快取鍵:同一組選擇必須得到同一份烘焙結果。 */
export function surfaceSelectionKey(selection: SurfaceSelection): string {
  return `${selection.floor}|${selection.wall}`;
}
