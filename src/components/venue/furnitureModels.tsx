"use client";

// 步驟 03 精密 3D 場景的家具模型載入與繪製(story: venue-refined-3d,task 5)。
//
// 六種家具用 Poly Haven CC0 的 GLB(見 public/models/venue/ATTRIBUTION.md);
// 其餘三種展場專屬家具(counter / bannerStand / podium)沒有對應資產,
// 由 task 6 的程序化幾何負責,這裡完全不碰。

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGLTF, Instances, Instance } from "@react-three/drei";
import {
  FURNITURE_DEFAULTS,
  type FurnitureItem,
  type FurnitureKind,
} from "@/lib/venue/furniture";
import { furnitureModel, uniformFitScale } from "@/lib/venue/models";
import { refinedFurnitureInstanceName } from "./RefinedSceneProbe";
import { instanceLimitFor } from "./instanceLimit";

/**
 * Draco 解碼器路徑。**必須顯式傳給 useGLTF** —— drei 的預設值是
 * `https://www.gstatic.com/draco/versioned/decoders/…`(Gltf.js 的
 * decoderPath),而步驟 03 有「零外部下載」硬規定。檔案由
 * scripts/build-venue-models.mjs 從 three 複製到 public/draco/。
 */
export const DRACO_DECODER_PATH = "/draco/";

export interface FurnitureModelPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

/** 供探針/測試讀取的單一 kind 量測結果。 */
export interface FurnitureModelReport {
  kind: FurnitureKind;
  /** 等比縮放倍率(三軸共用一個值,這正是「不得非等比拉伸」的證據)。 */
  scale: number;
  /** 縮放後的實際包圍盒尺寸(公尺,已套用 rotationY)。 */
  fittedM: [number, number, number];
  /** `FURNITURE_DEFAULTS` 的目標尺寸(公尺)。 */
  targetM: [number, number, number];
  /** 這個 kind 被拆成幾個 instanced mesh(GLB 內的 mesh 數)。 */
  partCount: number;
  /** 目前場上這個 kind 有幾件。 */
  instanceCount: number;
}

/**
 * 把 GLB 的場景圖攤平成一組「已經在最終區域座標系裡」的 geometry/material。
 *
 * 為什麼要先烘進 geometry 而不是靠 `<group>` 疊變換:`<Instances>` 只吃單一
 * geometry + material,GLB 節點自身的階層變換會整個被丟掉。所以這裡先把
 * 節點的世界矩陣、模型方位修正(rotationY)、等比縮放與置中通通乘進頂點,
 * 之後每個 instance 只需要負責「擺在平面圖的哪裡、轉幾度」。
 *
 * 座標約定與既有 box 版本一致:模型底面貼在 y=0,水平方向以原點為中心;
 * 呼叫端用 `position=[center.x, 0, center.y]` 擺放即可。
 */
function normalizeModel(
  source: THREE.Object3D,
  kind: FurnitureKind,
  rotationY: number
): { parts: FurnitureModelPart[]; report: FurnitureModelReport } {
  const defaults = FURNITURE_DEFAULTS[kind];

  // Poly Haven 的 glTF 是 Y-up(轉檔時已從 Blender 的 Z-up 轉過),所以
  // 目標尺寸在模型座標系裡是 (w, height3d, h)。
  const target: [number, number, number] = [
    defaults.w,
    defaults.height3d,
    defaults.h,
  ];

  const rotation = new THREE.Matrix4().makeRotationY(
    (rotationY * Math.PI) / 180
  );

  source.updateWorldMatrix(true, true);

  const baked: { geometry: THREE.BufferGeometry; material: THREE.Material }[] =
    [];
  source.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const geometry = node.geometry.clone();
    // 節點世界矩陣 -> 方位修正。縮放與置中要等全部 mesh 都攤平、量到整體
    // 包圍盒之後才能算,所以分兩趟。
    geometry.applyMatrix4(node.matrixWorld);
    geometry.applyMatrix4(rotation);
    const material = Array.isArray(node.material)
      ? node.material[0]
      : node.material;
    baked.push({ geometry, material });
  });

  const bounds = new THREE.Box3();
  for (const part of baked) {
    part.geometry.computeBoundingBox();
    if (part.geometry.boundingBox) bounds.union(part.geometry.boundingBox);
  }

  const size = new THREE.Vector3();
  bounds.getSize(size);

  const scale = uniformFitScale(
    { x: size.x, y: size.y, z: size.z },
    { x: target[0], y: target[1], z: target[2] }
  );

  // 縮放後再置中:水平置中、底面落在 y=0。
  const center = new THREE.Vector3();
  bounds.getCenter(center);
  const place = new THREE.Matrix4()
    .makeTranslation(
      -center.x * scale,
      -bounds.min.y * scale,
      -center.z * scale
    )
    .multiply(new THREE.Matrix4().makeScale(scale, scale, scale));

  for (const part of baked) {
    part.geometry.applyMatrix4(place);
    part.geometry.computeBoundingBox();
    part.geometry.computeBoundingSphere();
  }

  return {
    parts: baked,
    report: {
      kind,
      scale,
      fittedM: [size.x * scale, size.y * scale, size.z * scale],
      targetM: target,
      partCount: baked.length,
      instanceCount: 0,
    },
  };
}

interface FurnitureKindGroupProps {
  kind: FurnitureKind;
  url: string;
  rotationY: number;
  items: FurnitureItem[];
  onReport: (report: FurnitureModelReport) => void;
}

function FurnitureKindGroup({
  kind,
  url,
  rotationY,
  items,
  onReport,
}: FurnitureKindGroupProps) {
  // useGLTF 會 suspend,所以這個元件一定被包在 <Suspense> 裡。
  const gltf = useGLTF(url, DRACO_DECODER_PATH);

  const { parts, report } = useMemo(
    () => normalizeModel(gltf.scene, kind, rotationY),
    [gltf.scene, kind, rotationY]
  );

  // normalizeModel clone 出來的 geometry 是我們自己的,useGLTF 的快取不會
  // 幫忙釋放 —— 卸載時必須自己 dispose,否則往返步驟 02/03 會累積 GPU 資源
  // (AGENTS.md)。material 沒有 clone(直接沿用 GLB 的),而 GLB 資源的
  // 生命週期歸 useGLTF 的快取管,這裡不能碰。
  useEffect(() => {
    return () => {
      for (const part of parts) part.geometry.dispose();
    };
  }, [parts]);

  const reportedRef = useRef<string>("");
  useEffect(() => {
    const payload = { ...report, instanceCount: items.length };
    const key = JSON.stringify(payload);
    if (reportedRef.current === key) return;
    reportedRef.current = key;
    onReport(payload);
  }, [report, items.length, onReport]);

  if (items.length === 0) return null;

  // 容量進到 key 裡:桶變大時整個 <Instances> 重掛,矩陣緩衝區才會跟著重配
  // (見 MIN_INSTANCE_LIMIT 的註解)。桶只會往上跳,所以一般的加減家具不會
  // 造成重掛。
  const limit = instanceLimitFor(items.length);

  return (
    <>
      {parts.map((part, index) => (
        <Instances
          key={`${kind}-${index}-${limit}`}
          limit={limit}
          range={items.length}
          geometry={part.geometry}
          material={part.material}
          castShadow
          receiveShadow
          name={refinedFurnitureInstanceName(kind, index)}
        >
          {items.map((item) => (
            <Instance
              key={item.id}
              position={[item.center.x, 0, item.center.y]}
              // 與既有 box 版本同號:2D 的 rotationDeg 是螢幕座標順時針,
              // 對到 3D 的 Y 軸就是負值。
              rotation={[0, (-item.rotationDeg * Math.PI) / 180, 0]}
            />
          ))}
        </Instances>
      ))}
    </>
  );
}

interface FurnitureModelsProps {
  furniture: FurnitureItem[];
  /**
   * 這一批要畫哪一類模型。
   *
   * `"eager"` 是進入步驟 03 就載的五個;`"deferred"` 目前只有植栽 —— 它原生
   * 96k 三角面、GLB 1.32MB,是其餘五個加起來的量級,綁在同一個 Suspense 會
   * 讓整個場景一起等它。呼叫端把兩批放在各自的 `<Suspense>` 裡,並且等
   * eager 那批就緒後才掛 deferred。
   */
  phase: "eager" | "deferred";
  onReport: (report: FurnitureModelReport) => void;
}

/**
 * 依 kind 分組繪製有真實模型的家具。沒有模型的 kind 直接跳過 —— 呼叫端負責
 * 用別的方式(box 或 task 6 的程序化幾何)畫它們,這裡不做 fallback,免得
 * 同一件家具被畫兩次。
 */
export default function FurnitureModels({
  furniture,
  phase,
  onReport,
}: FurnitureModelsProps) {
  const groups = useMemo(() => {
    const wantDeferred = phase === "deferred";
    const byKind = new Map<FurnitureKind, FurnitureItem[]>();
    for (const item of furniture) {
      const model = furnitureModel(item.kind);
      if (!model || model.deferred !== wantDeferred) continue;
      const list = byKind.get(item.kind);
      if (list) list.push(item);
      else byKind.set(item.kind, [item]);
    }
    return [...byKind.entries()].map(([kind, items]) => ({
      kind,
      items,
      // furnitureModel(kind) 在上面的迴圈已確認存在。
      model: furnitureModel(kind)!,
    }));
  }, [furniture, phase]);

  return (
    <>
      {groups.map((group) => (
        <FurnitureKindGroup
          key={group.kind}
          kind={group.kind}
          url={group.model.url}
          rotationY={group.model.rotationY}
          items={group.items}
          onReport={onReport}
        />
      ))}
    </>
  );
}
