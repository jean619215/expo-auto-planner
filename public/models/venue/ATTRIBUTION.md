# 場地家具 3D 模型 — 來源與授權

> 由 `scripts/build-venue-models.mjs` 產生,請勿手改。換模型請改該腳本的
> `MODELS` 表後重跑。

全部模型來自 **[Poly Haven](https://polyhaven.com)**,授權為
**[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)**
（公眾領域貢獻，無署名義務、可商用、可修改）。Poly Haven 全站資產一律 CC0，
見 <https://polyhaven.com/license>。本檔的作者欄位為自願署名，非授權要求。

原始下載為各資產的 **1k glTF** 版本，經 `gltf-transform` 以
`dedup → prune → webp(q85) → draco` 轉為單檔 GLB。

| kind | 模型 | 作者 | 原始尺寸 X×Y×Z (m) | 三角面 | 載入時 Y 旋轉 | GLB |
|---|---|---|---|---|---|---|
| `table` | [Wooden Table 02](https://polyhaven.com/a/wooden_table_02) | Serhii Khromov | 1.134 × 0.706 × 0.8 | 196 | 0° | 0.27MB |
| `chair` | [Painted Wooden Chair 02](https://polyhaven.com/a/painted_wooden_chair_02) | Kirill Sannikov | 0.639 × 0.662 × 1.264 | 1,246 | 0° | 0.52MB |
| `cabinet` | [Drawer Cabinet](https://polyhaven.com/a/drawer_cabinet) | Ulan Cabanilla | 1.141 × 0.488 × 1.881 | 26,406 | 90° | 0.25MB |
| `sofa` | [Sofa 02](https://polyhaven.com/a/sofa_02) | Kirill Sannikov | 1.807 × 0.818 × 0.709 | 2,728 | 0° | 0.20MB |
| `plant` | [Potted Plant 01](https://polyhaven.com/a/potted_plant_01) | Rico Cilliers | 0.589 × 0.637 × 1.351 | 96,030 | 0° | 1.32MB |
| `display` | [Wooden Display Shelves 01](https://polyhaven.com/a/wooden_display_shelves_01) | James Ray Cock | 1.078 × 0.372 × 1.556 | 3,174 | 0° | 0.21MB |

合計 2.78MB（6 檔）。這些資源只在**步驟 03 精密 3D** 進入時
載入，步驟 01/02 不得參照。

## 尺寸約定

模型一律**等比**縮放到 `FURNITURE_DEFAULTS` 的 `w / h / height3d`（見
`src/lib/venue/furniture.ts`），不得非等比拉伸變形。上表「原始尺寸」是
Poly Haven 標示的公尺尺寸，Z 為高度（Blender 慣例）；`load 時 Y 旋轉` 是
讓模型長邊對上平面圖長邊所需的旋轉。
