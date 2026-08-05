#!/usr/bin/env node
/**
 * 場地家具 3D 模型 asset pipeline(story: venue-refined-3d,task 4)。
 *
 * 從 Poly Haven 下載 6 個 CC0 模型的 1k glTF 版本,轉成單檔 GLB(貼圖內嵌
 * WebP + 幾何 Draco 壓縮)放進 public/models/venue/,並產生授權記錄檔。
 *
 * 用法:
 *   node scripts/build-venue-models.mjs          # 有快取就不重抓
 *   node scripts/build-venue-models.mjs --force  # 重抓來源檔
 *
 * 產出物(GLB + ATTRIBUTION.md)是 **commit 進 repo 的**,這支腳本只在要換
 * 模型或重新調壓縮參數時才跑 —— build/CI 不執行它,因此 @gltf-transform/cli
 * 與 sharp 只需存在於開發機。
 *
 * ⚠️ 為什麼不是 KTX2(story 原文寫 GLB + Draco + KTX2):
 *   KTX2 需要 (a) 打包期的原生編碼器 toktx/basisu —— 本機與 CI 皆未安裝,
 *   (b) 執行期自架 basis transcoder 的 wasm/js 到 /public 並接上 KTX2Loader。
 *   本專案步驟 03 有「零外部下載」硬規定,(b) 的自架成本是實打實的。
 *   而 KTX2 真正的好處是 GPU 記憶體常駐壓縮 —— 6 個模型、1k 貼圖的量級下
 *   GPU 記憶體不是瓶頸,傳輸體積才是,而傳輸體積 WebP 就解得掉。
 *   若日後模型數量或貼圖解析度上升到 GPU 記憶體吃緊,再回頭補 KTX2。
 */

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  existsSync,
  writeFileSync,
  statSync,
  rmSync,
  copyFileSync,
  readFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = join(ROOT, ".cache", "polyhaven");
const OUT_DIR = join(ROOT, "public", "models", "venue");
const DRACO_DIR = join(ROOT, "public", "draco");
const API = "https://api.polyhaven.com";
const FORCE = process.argv.includes("--force");

/**
 * kind 對應的 Poly Haven asset slug。
 *
 * 挑選標準:先以語意過濾(家具/植栽類別),再比對模型原生長寬高與
 * `FURNITURE_DEFAULTS` 目標尺寸的**比例殘差** —— 因為家具只能等比縮放
 * (AGENTS.md 硬規定),比例差得越遠,等比縮到目標框內的空隙就越大。
 * `err` 是三軸 log 比例對最佳等比縮放的 RMS 殘差,0 表示形狀完全同比例。
 * `rotationY` 是為了讓模型的長邊對上平面圖長邊所需的 Y 軸旋轉(度)。
 */
const MODELS = [
  { kind: "table", slug: "wooden_table_02", rotationY: 0, err: 0.049 },
  { kind: "chair", slug: "painted_wooden_chair_02", rotationY: 0, err: 0.02 },
  { kind: "cabinet", slug: "drawer_cabinet", rotationY: 90, err: 0.103 },
  { kind: "sofa", slug: "sofa_02", rotationY: 0, err: 0.063 },
  { kind: "plant", slug: "potted_plant_01", rotationY: 0, err: 0.051 },
  {
    kind: "display",
    slug: "wooden_display_shelves_01",
    rotationY: 0,
    err: 0.157,
  },
];

const RES = "1k";

function log(...args) {
  console.log("[models]", ...args);
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

async function download(url, dest) {
  if (!FORCE && existsSync(dest)) return false;
  mkdirSync(dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return true;
}

function run(args) {
  const result = spawnSync("npx", ["--no-install", "gltf-transform", ...args], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `gltf-transform ${args[0]} failed (${result.status}):\n${result.stderr || result.stdout}`
    );
  }
  return result.stdout;
}

const mb = (bytes) => `${(bytes / 1e6).toFixed(2)}MB`;

async function buildOne(entry) {
  const { kind, slug } = entry;
  const files = await getJson(`${API}/files/${slug}`);
  const gltf = files?.gltf?.[RES]?.gltf;
  if (!gltf) throw new Error(`${slug}: no ${RES} glTF variant`);

  const assetDir = join(CACHE_DIR, slug);
  const mainPath = join(assetDir, `${slug}_${RES}.gltf`);

  let sourceBytes = 0;
  await download(gltf.url, mainPath);
  sourceBytes += statSync(mainPath).size;

  // include 的 key 就是 glTF 內部的相對路徑,必須原樣落盤,否則 buffer/image
  // 的 uri 解析不到。
  for (const [relPath, meta] of Object.entries(gltf.include ?? {})) {
    const dest = join(assetDir, relPath);
    await download(meta.url, dest);
    sourceBytes += statSync(dest).size;
  }

  const outPath = join(OUT_DIR, `${kind}.glb`);
  const tmpPath = join(assetDir, `${kind}.staged.glb`);

  // 順序有意義:先 dedup/prune 砍掉重複與孤兒資源,再壓貼圖,最後才 Draco ——
  // Draco 之後的 mesh 是壓縮態,再跑 prune 會多一次解/壓來回。
  run(["copy", mainPath, tmpPath]);
  run(["dedup", tmpPath, tmpPath]);
  run(["prune", tmpPath, tmpPath]);
  run(["webp", tmpPath, tmpPath, "--quality", "85"]);
  run(["draco", tmpPath, outPath]);
  rmSync(tmpPath, { force: true });

  const outBytes = statSync(outPath).size;
  log(
    `${kind.padEnd(8)} ${slug.padEnd(26)} ${mb(sourceBytes)} -> ${mb(outBytes)} (${((1 - outBytes / sourceBytes) * 100).toFixed(0)}% smaller)`
  );

  const info = await getJson(`${API}/info/${slug}`);
  return {
    ...entry,
    outPath,
    outBytes,
    sourceBytes,
    title: info.name ?? slug,
    authors: Object.keys(info.authors ?? {}),
    dimensionsM: (info.dimensions ?? []).map((v) => +(v / 1000).toFixed(3)),
    polycount: info.polycount,
  };
}

function writeAttribution(built) {
  const rows = built
    .map(
      (b) =>
        `| \`${b.kind}\` | [${b.title}](https://polyhaven.com/a/${b.slug}) | ${b.authors.join(", ")} | ${b.dimensionsM.join(" × ")} | ${b.polycount.toLocaleString()} | ${b.rotationY}° | ${mb(b.outBytes)} |`
    )
    .join("\n");

  const total = built.reduce((sum, b) => sum + b.outBytes, 0);

  writeFileSync(
    join(OUT_DIR, "ATTRIBUTION.md"),
    `# 場地家具 3D 模型 — 來源與授權

> 由 \`scripts/build-venue-models.mjs\` 產生,請勿手改。換模型請改該腳本的
> \`MODELS\` 表後重跑。

全部模型來自 **[Poly Haven](https://polyhaven.com)**,授權為
**[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)**
（公眾領域貢獻，無署名義務、可商用、可修改）。Poly Haven 全站資產一律 CC0，
見 <https://polyhaven.com/license>。本檔的作者欄位為自願署名，非授權要求。

原始下載為各資產的 **${RES} glTF** 版本，經 \`gltf-transform\` 以
\`dedup → prune → webp(q85) → draco\` 轉為單檔 GLB。

| kind | 模型 | 作者 | 原始尺寸 X×Y×Z (m) | 三角面 | 載入時 Y 旋轉 | GLB |
|---|---|---|---|---|---|---|
${rows}

合計 ${mb(total)}（${built.length} 檔）。這些資源只在**步驟 03 精密 3D** 進入時
載入，步驟 01/02 不得參照。

## 尺寸約定

模型一律**等比**縮放到 \`FURNITURE_DEFAULTS\` 的 \`w / h / height3d\`（見
\`src/lib/venue/furniture.ts\`），不得非等比拉伸變形。上表「原始尺寸」是
Poly Haven 標示的公尺尺寸，Z 為高度（Blender 慣例）；\`load 時 Y 旋轉\` 是
讓模型長邊對上平面圖長邊所需的旋轉。
`,
    "utf8"
  );
}

/**
 * 把 three 內附的 Draco 解碼器複製到 public/draco/。
 *
 * 為什麼要自架:drei 的 `useGLTF` 預設把 DRACOLoader 的 decoder path 指向
 * `https://www.gstatic.com/draco/versioned/decoders/…`(Gltf.js 的 decoderPath)
 * —— 步驟 03 有「零外部下載」硬規定,那條預設路徑不可接受。場景端必須顯式
 * 傳入 `/draco/`,而檔案得先在這裡落地。
 *
 * 只複製 WASM 版本,不含 512KB 的純 JS fallback(`draco_decoder.js`):
 * DRACOLoader 只在 `typeof WebAssembly !== "object"` 時才會去要那支,而能跑
 * WebGL2 + 本場景這種 GPU 負載的瀏覽器不可能沒有 WASM。
 *
 * 取 `gltf/` 子目錄而非上層:那是對齊 KHR_draco_mesh_compression 擴充的建置,
 * 正是我們 GLB 用的壓縮方式。
 */
function copyDracoDecoder() {
  // 直接走檔案系統路徑,不用 require.resolve("three/package.json") ——
  // three 的 package.json 沒有列在 exports 裡,那樣解會直接拋
  // ERR_PACKAGE_PATH_NOT_EXPORTED。
  const threeDir = join(ROOT, "node_modules", "three");
  const srcDir = join(threeDir, "examples", "jsm", "libs", "draco", "gltf");
  const version = JSON.parse(
    readFileSync(join(threeDir, "package.json"), "utf8")
  ).version;

  mkdirSync(DRACO_DIR, { recursive: true });
  for (const file of ["draco_wasm_wrapper.js", "draco_decoder.wasm"]) {
    copyFileSync(join(srcDir, file), join(DRACO_DIR, file));
  }
  writeFileSync(
    join(DRACO_DIR, "README.md"),
    `# Draco 解碼器(自架)

由 \`scripts/build-venue-models.mjs\` 從 \`three@${version}\` 的
\`examples/jsm/libs/draco/gltf/\` 複製而來,請勿手改 —— 升級 three 後重跑該腳本。

自架而非用 CDN 的原因:drei 的 \`useGLTF\` 預設把 decoder path 指向
gstatic.com,而步驟 03 有「零外部下載」硬規定。場景端要顯式傳
\`/draco/\` 才會用到這裡的檔案。

只有 WASM 版本。純 JS fallback(\`draco_decoder.js\`,512KB)沒複製 —
\`DRACOLoader\` 只在瀏覽器沒有 WebAssembly 時才需要它,而那種瀏覽器也跑不動
本場景的 WebGL2 負載。
`,
    "utf8"
  );
  log(`draco decoder copied from three@${version}`);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  copyDracoDecoder();
  const built = [];
  for (const entry of MODELS) {
    built.push(await buildOne(entry));
  }
  writeAttribution(built);
  const total = built.reduce((sum, b) => sum + b.outBytes, 0);
  log(`done — ${built.length} models, ${mb(total)} total in public/models/venue/`);
}

main().catch((err) => {
  console.error("[models] FAILED:", err.message);
  process.exit(1);
});
