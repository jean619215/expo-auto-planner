"use client";

// 家具目錄卡片的模型縮圖(第四輪)。
//
// **一張卡一個 <Canvas> 是行不通的。** 每個 Canvas 就是一個 WebGL context,
// 瀏覽器大約 8–16 個就到上限,而目錄現在 23 項、目標上百項 —— 那樣做會把
// 步驟 02/03 的場景直接擠掉(而且是以「場景整個消失」這種很難查的形式)。
//
// 所以這裡是**一個共用的離屏 renderer**:輪流把每個品項渲染成一張 PNG
// dataURL 並快取,卡片顯示的是那張圖。整個頁面因此只多用一個 context。
//
// 幾何來源與場景**完全相同** —— 程序化走 `proceduralPartsForItem`,GLB 走
// 與步驟 02/03 同一份 `getOrBuildNormalizedModel` 快取。縮圖因此不可能與
// 場景裡的東西長得不一樣:那不是「畫一張示意圖」,是把同一份幾何拍一張照。

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { proceduralPartsForItem } from "@/lib/venue/proceduralFurniture";
import type { CatalogItem } from "@/lib/venue/catalog";
import { buildPartGeometry } from "./proceduralFurniture";
import { getOrBuildNormalizedModel } from "./furnitureModelStats";
import { DRACO_DECODER_PATH, normalizeModel } from "./furnitureModels";
import { getOffscreenRenderer } from "./offscreenRenderer";

/** 縮圖邊長(像素)。卡片上顯示 48–56px,2× 給高解析螢幕。 */
export const THUMBNAIL_SIZE = 128;

/** 白模色。與步驟 02 一致 —— 目錄是在挑「哪一個型號」,不是在挑材質。 */
const THUMBNAIL_COLOR = "#d9d5d0";

let gltfLoader: GLTFLoader | null = null;

/** code -> dataURL。渲染過就不再渲染,面板收合再展開也不重畫。 */
const cache = new Map<string, string>();
/** 進行中的請求,避免同一個代碼被併發渲染多次(GLB 載入是非同步的)。 */
const inFlight = new Map<string, Promise<string | null>>();

function getGltfLoader(): GLTFLoader {
  if (gltfLoader) return gltfLoader;
  const draco = new DRACOLoader();
  // 與 useGLTF 同一條路徑。步驟 03 有「零外部下載」硬規定,預設的 gstatic
  // 解碼器不能用 —— 縮圖這條路徑同樣不得例外。
  draco.setDecoderPath(DRACO_DECODER_PATH);
  gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(draco);
  return gltfLoader;
}

/** 這個品項的幾何(公尺,底面在 y=0、水平置中)。 */
async function geometriesFor(
  item: CatalogItem,
): Promise<THREE.BufferGeometry[]> {
  if (item.geometry.kind === "procedural") {
    const parts = proceduralPartsForItem(item);
    if (!parts) return [];
    return parts.map(buildPartGeometry);
  }

  const { url, rotationY } = item.geometry;
  const gltf = await getGltfLoader().loadAsync(url);
  // 與場景共用同一份正規化快取:縮圖若自己算一份,改了正規化邏輯就會出現
  // 「縮圖與場景不一樣」而且沒有任何地方會報錯。
  const { parts } = getOrBuildNormalizedModel(item.code, () =>
    normalizeModel(gltf.scene, item, rotationY),
  );
  return parts.map((part) => part.geometry);
}

/**
 * 把一個品項渲染成 dataURL。
 *
 * 相機是固定的 3/4 俯視角(與競品型錄的慣例一致),依實際包圍盒取景 ——
 * 所以 45cm 的椅子與 200cm 的展示架在卡片上都會填滿同樣的空間,一排看下來
 * 是「形狀不同」而不是「有的很大有的看不見」。**尺寸資訊由卡片上的文字負責**,
 * 那是精確的;縮圖負責的是「這是什麼東西」。
 */
async function render(item: CatalogItem): Promise<string | null> {
  const geometries = await geometriesFor(item);
  if (geometries.length === 0) return null;

  const scene = new THREE.Scene();
  const material = new THREE.MeshStandardMaterial({
    color: THUMBNAIL_COLOR,
    roughness: 0.75,
    metalness: 0,
  });
  const bounds = new THREE.Box3();
  for (const geometry of geometries) {
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (geometry.boundingBox) bounds.union(geometry.boundingBox);
  }

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(-4, 2, -3);
  scene.add(fill);

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bounds.getSize(size);
  bounds.getCenter(center);
  const radius = Math.max(size.x, size.y, size.z, 0.1);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  // 1.9 是留白倍率:剛好把最長邊塞滿會讓相鄰卡片的模型邊緣互相貼死。
  const distance = radius * 1.9;
  camera.position.set(
    center.x + distance * 0.75,
    center.y + distance * 0.6,
    center.z + distance * 0.75,
  );
  camera.lookAt(center);

  const gl = getOffscreenRenderer(THUMBNAIL_SIZE);
  gl.render(scene, camera);
  const dataUrl = gl.domElement.toDataURL("image/png");

  // 材質與燈是這次渲染自己建的,要收掉。**geometry 不能收** —— 那是共用
  // 快取(或程序化模組)的財產,收掉會讓場景裡的家具跟著消失。
  material.dispose();
  scene.clear();

  return dataUrl;
}

/**
 * 取得某個品項的縮圖。已渲染過的直接回快取;同一個代碼併發呼叫只渲染一次。
 *
 * 失敗回 `null`(卡片顯示佔位符)—— 縮圖畫不出來不該讓整個目錄面板掛掉,
 * 使用者仍然選得到那個品項。
 */
export function furnitureThumbnail(item: CatalogItem): Promise<string | null> {
  const cached = cache.get(item.code);
  if (cached) return Promise.resolve(cached);

  const existing = inFlight.get(item.code);
  if (existing) return existing;

  const promise = render(item)
    .then((dataUrl) => {
      if (dataUrl) cache.set(item.code, dataUrl);
      return dataUrl;
    })
    .catch(() => null)
    .finally(() => {
      inFlight.delete(item.code);
    });

  inFlight.set(item.code, promise);
  return promise;
}

/** 已產生的縮圖數 —— 測試用來確認「同一個品項不會重複渲染」。 */
export function thumbnailCacheSize(): number {
  return cache.size;
}
