"use client";

// 地板/牆面材質選單的樣式縮圖(第四輪)。
//
// 縮圖是**實際的材質**,不是示意色塊:
//  - 程序化款式 → 用與場景完全相同的烘焙 shader 烘一張小張的 albedo。改了
//    shader 或 preset 的底色/粗糙度,選單上的縮圖跟著變,不需要有人記得同步。
//  - 實拍貼圖包 → 直接用它的 diffuse 檔。那就是場景裡貼上去的那張圖本身。
//
// 這一條的價值在「換一個材質之前先知道它長什麼樣」。色塊做不到:水泥與磨損
// 水泥的底色幾乎一樣,差別全在紋理,而紋理正是色塊丟掉的那部分。

import * as THREE from "three";
import {
  BAKE_VERTEX_SHADER,
  buildBakeFragmentShader,
} from "./surfaceBakeShader";
import { getOffscreenRenderer } from "./offscreenRenderer";
import {
  floorPreset,
  wallPreset,
  type SurfacePreset,
} from "@/lib/venue/surfacePresets";

/** 縮圖邊長。畫面上顯示 40–48px,2× 給高解析螢幕。 */
const SIZE = 96;

/**
 * 烘焙用的參數。**與 surfaceTextures.ts 的正式烘焙刻意不共用同一組數字** ——
 * 那邊的振幅是對著 1024²/512² 的實際貼圖與 T2/T5 的 GPU 讀回統計調出來的,
 * 這裡是 96² 的預覽。共用會讓「為了預覽好看而動一個數字」不小心改到場景,
 * 而那組數字有測試守著、且調校過程極痛苦(見 surfaceTextures.ts 的檔頭)。
 *
 * 反過來說,**底色與粗糙度仍然來自 preset 本身**,所以縮圖與場景描述的是
 * 同一款材質 —— 不共用的只有預覽解析度下的呈現參數。
 */
const PREVIEW_TINT_AMP = 0.09;
const PREVIEW_FINE_TINT_WEIGHT = 0.5;
const PREVIEW_ROUGH_AMP = 0.12;
const PREVIEW_NORMAL_STRENGTH = 1;

const cache = new Map<string, string>();

/** 快取鍵要含用途:同一個 id 在地板與牆面是不同的 preset 表。 */
function keyFor(surface: "floor" | "wall", presetId: string): string {
  return `${surface}:${presetId}`;
}

function presetFor(surface: "floor" | "wall", presetId: string): SurfacePreset {
  return surface === "floor" ? floorPreset(presetId) : wallPreset(presetId);
}

/** 用烘焙 shader 畫一張小圖進 render target。 */
function bakeInto(
  gl: THREE.WebGLRenderer,
  surface: "floor" | "wall",
  mode: "albedo" | "normal",
  preset: SurfacePreset,
): THREE.WebGLRenderTarget {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.ShaderMaterial({
    vertexShader: BAKE_VERTEX_SHADER,
    fragmentShader: buildBakeFragmentShader(surface, mode),
    uniforms: {
      uBaseColor: { value: new THREE.Color(preset.color) },
      uResolution: { value: SIZE },
      uNormalStrength: { value: PREVIEW_NORMAL_STRENGTH },
      uRoughBase: { value: preset.roughness },
      uRoughAmp: { value: PREVIEW_ROUGH_AMP },
      uTintAmp: { value: PREVIEW_TINT_AMP },
      uFineTintWeight: { value: PREVIEW_FINE_TINT_WEIGHT },
    },
  });
  const target = new THREE.WebGLRenderTarget(SIZE, SIZE, {
    depthBuffer: false,
    stencilBuffer: false,
    colorSpace: THREE.LinearSRGBColorSpace,
  });
  scene.add(new THREE.Mesh(geometry, material));
  gl.setRenderTarget(target);
  gl.render(scene, camera);

  geometry.dispose();
  material.dispose();
  scene.clear();
  return target;
}

/**
 * 烘一張預覽圖並轉成 dataURL。
 *
 * **打光之後才拍**,不是直接把 albedo 貼出來。程序化款式的差別有很大一部分在
 * 法線(凹凸)與粗糙度上 —— 只看 albedo 的話「木地板」與「石材」都會變成一塊
 * 平坦的色塊,而那正是使用者在選單裡分不出來、必須選下去才知道的東西。這裡
 * 用與場景同一組貼圖(albedo + normal)貼到一個小平面上,拿一盞斜射光照它,
 * 呈現的就是它在場景裡的樣子。
 */
function bakePreview(surface: "floor" | "wall", preset: SurfacePreset): string {
  const gl = getOffscreenRenderer(SIZE);
  const previousTarget = gl.getRenderTarget();

  const albedo = bakeInto(gl, surface, "albedo", preset);
  const normal = bakeInto(gl, surface, "normal", preset);

  const scene = new THREE.Scene();
  // 正交相機正對平面:預覽是一片材質,不需要透視。
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
  camera.position.set(0, 0, 5);

  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.MeshStandardMaterial({
    map: albedo.texture,
    normalMap: normal.texture,
    // 縮圖只有一格,看到的是一整片材質 —— 鋪貼倍率不套用,否則 96px 裡會塞進
    // 十幾次重複,看起來像雜訊而不是材質。
    roughness: preset.roughness,
    metalness: 0,
  });
  scene.add(new THREE.Mesh(geometry, material));
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  // 斜射光:凹凸只有在掠角照明下才看得見,正打會把法線的貢獻壓平。
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(-2, 2.5, 1.6);
  scene.add(key);

  gl.setRenderTarget(null);
  gl.render(scene, camera);
  const dataUrl = gl.domElement.toDataURL("image/png");
  gl.setRenderTarget(previousTarget);

  geometry.dispose();
  material.dispose();
  albedo.dispose();
  normal.dispose();
  scene.clear();
  return dataUrl;
}

/**
 * 某個材質款式的預覽圖來源。
 *
 * 實拍貼圖包回傳它的 diffuse 檔路徑(瀏覽器自己會快取);程序化款式回傳
 * 現烘的 dataURL。兩者都直接放進 `<img src>`,呼叫端不需要分辨。
 */
export function surfaceThumbnail(
  surface: "floor" | "wall",
  presetId: string,
): string {
  const preset = presetFor(surface, presetId);
  if (preset.textures) return preset.textures.map;

  const key = keyFor(surface, preset.id);
  const cached = cache.get(key);
  if (cached) return cached;

  const dataUrl = bakePreview(surface, preset);
  cache.set(key, dataUrl);
  return dataUrl;
}
