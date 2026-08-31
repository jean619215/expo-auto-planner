"use client";

// 共用的離屏 renderer(第四輪)。
//
// 目錄縮圖與材質縮圖都需要「畫一張小圖出來」,而**每一個 WebGLRenderer 就是
// 一個 WebGL context**,瀏覽器大約 8–16 個就到上限。步驟 02/03 的場景各自
// 已經佔掉一個,縮圖這條路徑因此只能有一個,而且是兩種用途共用的那一個 ——
// 各自建一個就等於把預算花掉一半,而且是在使用者看不見的地方。
//
// context 一旦被擠掉,症狀是「場景整個變空白」而不是任何錯誤訊息,查起來
// 極耗時。這個檔案存在就是為了讓那件事不可能發生。

import * as THREE from "three";

let renderer: THREE.WebGLRenderer | null = null;

/**
 * 取得共用 renderer,並設定成指定的輸出尺寸。
 *
 * `preserveDrawingBuffer` 必須開著:`toDataURL()` 讀的是 drawing buffer,
 * 不保留的話在某些瀏覽器/時機下拿到的是一張空白圖(而且是間歇性的)。
 */
export function getOffscreenRenderer(size: number): THREE.WebGLRenderer {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    // 縮圖是給人看的,照步驟 03 的輸出設定走,否則會偏暗偏灰。
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  renderer.setSize(size, size, false);
  return renderer;
}
