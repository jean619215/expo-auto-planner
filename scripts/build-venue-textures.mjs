// 步驟 03 的真實 PBR 貼圖打包(story: venue-feedback-round2, T10)。
//
// 從 Poly Haven(全站 CC0)抓 1k 的 diffuse / normal / roughness,轉成 WebP
// 後放進 public/textures/venue/,並產生授權記錄檔。與模型那條管線同樣的做法
// (見 scripts/build-venue-models.mjs):**不是 build 的一部分**,產物進版控,
// 需要更新貼圖時才手動跑。
//
// 為什麼是 WebP 而不是 KTX2:與模型管線同一個理由 —— KTX2 需要打包期的原生
// 編碼器與執行期自架 transcoder,而步驟 03 有「零外部下載」硬規定。在 4 張
// 貼圖的量級下瓶頸是傳輸體積,那件事 WebP 已經解掉。

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, "public", "textures", "venue");
const API = "https://api.polyhaven.com";

// 刻意只挑四款:兩款地板、兩款牆面。這是「補幾款真實貼圖」,不是建一座貼圖庫。
const TEXTURES = [
  { id: "laminate", surface: "floor", slug: "laminate_floor_02", label: "木質地板(實拍)" },
  { id: "worn-concrete", surface: "floor", slug: "concrete_floor_worn_001", label: "磨損水泥(實拍)" },
  { id: "beige-plaster", surface: "wall", slug: "beige_wall_001", label: "米色批土牆(實拍)" },
  { id: "dirty-carpet", surface: "wall", slug: "dirty_carpet", label: "地毯牆布(實拍)" },
];

const MAPS = [
  { api: "Diffuse", suffix: "diff" },
  { api: "nor_gl", suffix: "nor" },
  { api: "Rough", suffix: "rough" },
];

// 單檔上限。超過就代表壓縮參數該調,而不是默默放行 —— 步驟 03 的資源是
// lazy load 的,但仍然要在合理的行動網路下載得完。
const MAX_BYTES = 400 * 1024;

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const records = [];

  for (const texture of TEXTURES) {
    const [files, info] = await Promise.all([
      fetchJson(`${API}/files/${texture.slug}`),
      fetchJson(`${API}/info/${texture.slug}`),
    ]);

    for (const map of MAPS) {
      const entry = files[map.api]?.["1k"]?.jpg;
      if (!entry) throw new Error(`${texture.slug} 缺少 1k jpg 的 ${map.api}`);
      const res = await fetch(entry.url);
      if (!res.ok) throw new Error(`${entry.url} -> ${res.status}`);
      const source = Buffer.from(await res.arrayBuffer());

      // normal / roughness 是資料而不是照片,壓太狠會在斜面上出現色帶,
      // 所以品質分開給。
      const quality = map.suffix === "diff" ? 82 : 90;
      const webp = await sharp(source).webp({ quality }).toBuffer();
      if (webp.byteLength > MAX_BYTES) {
        throw new Error(
          `${texture.id}_${map.suffix}.webp 為 ${webp.byteLength} bytes,超過上限 ${MAX_BYTES}`,
        );
      }
      const name = `${texture.id}_${map.suffix}.webp`;
      await writeFile(join(OUT_DIR, name), webp);
      console.log(`${name} ${(webp.byteLength / 1024).toFixed(0)}KB`);
    }

    records.push({
      ...texture,
      authors: Object.keys(info.authors ?? {}),
      license: info.license ?? "CC0",
    });
  }

  const attribution = [
    "# 步驟 03 表面貼圖來源",
    "",
    "由 `scripts/build-venue-textures.mjs` 產生,請勿手動編輯。",
    "",
    "全部取自 [Poly Haven](https://polyhaven.com/),授權為 CC0(公眾領域,",
    "商用免標註)。此檔留存來源是為了可追溯,不是授權要求。",
    "",
    "| id | 用途 | Poly Haven slug | 作者 | 授權 |",
    "| --- | --- | --- | --- | --- |",
    ...records.map(
      (r) =>
        `| ${r.id} | ${r.surface} | [${r.slug}](https://polyhaven.com/a/${r.slug}) | ${r.authors.join(", ")} | ${r.license} |`,
    ),
    "",
    "每款各有三張:`_diff`(基礎色)、`_nor`(法線,OpenGL 慣例)、",
    "`_rough`(粗糙度),1k 解析度、轉為 WebP。",
    "",
  ].join("\n");
  await writeFile(join(OUT_DIR, "ATTRIBUTION.md"), attribution);
  console.log("ATTRIBUTION.md 已更新");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
