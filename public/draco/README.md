# Draco 解碼器(自架)

由 `scripts/build-venue-models.mjs` 從 `three@0.185.1` 的
`examples/jsm/libs/draco/gltf/` 複製而來,請勿手改 —— 升級 three 後重跑該腳本。

自架而非用 CDN 的原因:drei 的 `useGLTF` 預設把 decoder path 指向
gstatic.com,而步驟 03 有「零外部下載」硬規定。場景端要顯式傳
`/draco/` 才會用到這裡的檔案。

只有 WASM 版本。純 JS fallback(`draco_decoder.js`,512KB)沒複製 —
`DRACOLoader` 只在瀏覽器沒有 WebAssembly 時才需要它,而那種瀏覽器也跑不動
本場景的 WebGL2 負載。
