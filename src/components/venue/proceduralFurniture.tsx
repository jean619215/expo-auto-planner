"use client";

// 步驟 03 的三種展場專屬家具程序化幾何(story: venue-refined-3d,task 6)。
//
// counter 接待櫃檯 / bannerStand 展示架 / podium 講台 —— Poly Haven 沒有這類
// 展場物件的 CC0 資產,所以由這裡用基本量體拼出來。零件清單(誰、多大、擺哪)
// 全部來自純領域模組 `@/lib/venue/proceduralFurniture`;這個檔案只負責把它
// 變成 geometry / material,以及 instancing 與資源釋放。
//
// 刻意與 `furnitureModels.tsx`(匯入 GLB 那條路)採同一套結構:同樣的座標約定
// (底面貼 y=0、水平置中)、同樣用 drei `<Instances>`、同樣的場景圖命名,
// 所以探針不需要分辨一件家具是模型還是程序化的 —— 它只要照 kind 分組數
// instance 就好。

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Instances, Instance } from "@react-three/drei";
import {
  FURNITURE_DEFAULTS,
  type FurnitureItem,
  type FurnitureKind,
} from "@/lib/venue/furniture";
import {
  hasProceduralFurniture,
  proceduralFurnitureParts,
  proceduralFurnitureSizeM,
  type FurniturePart,
  type PartFinish,
} from "@/lib/venue/proceduralFurniture";
import { REFINED_SURFACE } from "./refinedLighting";
import { refinedFurnitureInstanceName } from "./RefinedSceneProbe";
import { instanceLimitFor } from "./instanceLimit";
import {
  getOrBuildProceduralParts,
  type CachedFurniturePart,
} from "./proceduralFurnitureStats";

/** 供探針/測試讀取的單一 kind 量測結果。 */
export interface ProceduralFurnitureReport {
  kind: FurnitureKind;
  /** 拼出來的實際外廓(公尺)。 */
  sizeM: [number, number, number];
  /** `FURNITURE_DEFAULTS` 的標稱尺寸(公尺)。 */
  targetM: [number, number, number];
  /** 這件家具由幾個零件組成。 */
  partCount: number;
  /** 目前場上這個 kind 有幾件。 */
  instanceCount: number;
}

// --- 表面處理 ------------------------------------------------------------
//
// 風格要與匯入的 Poly Haven 模型協調(story 驗收條件):那批是霧面木作與布面
// 為主、幾乎沒有高反光,所以這裡的 body/accent 直接沿用 REFINED_SURFACE.furniture
// 的粗糙度基準,只有金屬件(易拉寶的捲軸箱與支桿)才給 metalness —— 展場的
// 易拉寶本來就是鋁製的,一律做成霧面木頭反而更假。

/** 把 hex 顏色往黑或白混,回傳新的 hex。amount > 0 提亮,< 0 加深。 */
function shadeHex(hex: string, amount: number): string {
  const value = parseInt(hex.replace("#", ""), 16);
  const target = amount > 0 ? 255 : 0;
  const ratio = Math.abs(amount);
  const mix = (channel: number) =>
    Math.round(channel + (target - channel) * ratio);
  const r = mix((value >> 16) & 0xff);
  const g = mix((value >> 8) & 0xff);
  const b = mix(value & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

const METAL_COLOR = "#9ca3af";

function finishMaterialSpec(
  finish: PartFinish,
  baseColor: string
): { color: string; roughness: number; metalness: number } {
  switch (finish) {
    case "body":
      return {
        color: baseColor,
        roughness: REFINED_SURFACE.furniture.roughness,
        metalness: REFINED_SURFACE.furniture.metalness,
      };
    case "accent":
      // 檯面/底座壓深一階,量體才有層次,不會糊成一坨同色。
      return {
        color: shadeHex(baseColor, -0.35),
        roughness: REFINED_SURFACE.furniture.roughness * 0.8,
        metalness: REFINED_SURFACE.furniture.metalness,
      };
    case "metal":
      return { color: METAL_COLOR, roughness: 0.35, metalness: 0.75 };
    case "panel":
      // 布面:提亮、幾乎全霧面。
      return { color: shadeHex(baseColor, 0.25), roughness: 0.95, metalness: 0 };
  }
}

// --- geometry ------------------------------------------------------------

/**
 * 把一個零件變成「已經在最終區域座標系裡」的 geometry。
 *
 * 傾斜與位移都烘進頂點(與 `furnitureModels.tsx` 的 `normalizeModel()` 同一
 * 個理由):`<Instances>` 只吃單一 geometry,巢狀 `<group>` 的變換會被丟掉,
 * 而且烘完之後每個 instance 只需要負責「擺在平面圖的哪裡、轉幾度」。
 */
export function buildPartGeometry(part: FurniturePart): THREE.BufferGeometry {
  const geometry =
    part.shape.kind === "box"
      ? new THREE.BoxGeometry(part.shape.w, part.shape.h, part.shape.d)
      : new THREE.CylinderGeometry(
          part.shape.radius,
          part.shape.radius,
          part.shape.h,
          12
        );

  if (part.tiltXDeg) {
    geometry.applyMatrix4(
      new THREE.Matrix4().makeRotationX((part.tiltXDeg * Math.PI) / 180)
    );
  }
  geometry.applyMatrix4(
    new THREE.Matrix4().makeTranslation(
      part.position[0],
      part.position[1],
      part.position[2]
    )
  );
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

interface ProceduralKindGroupProps {
  kind: FurnitureKind;
  items: FurnitureItem[];
  onReport: (report: ProceduralFurnitureReport) => void;
}

function ProceduralKindGroup({
  kind,
  items,
  onReport,
}: ProceduralKindGroupProps) {
  // 資源依 kind 快取在模組層(理由見 proceduralFurnitureStats.ts:一個 kind
  // 的零件完全由 kind 決定,而且 StrictMode 的雙重 render 會讓「useMemo 建立
  // + useEffect dispose」漏掉被丟棄的那一份)。這裡的 useMemo 只是省下每次
  // render 查表的成本,穩態下不新建任何 GPU 資源。
  const built = useMemo<CachedFurniturePart[]>(
    () =>
      getOrBuildProceduralParts(kind, () => {
        const parts = proceduralFurnitureParts(kind);
        if (!parts) return [];
        const baseColor = FURNITURE_DEFAULTS[kind].color;
        return parts.map((part) => {
          const spec = finishMaterialSpec(part.finish, baseColor);
          return {
            id: part.id,
            geometry: buildPartGeometry(part),
            material: new THREE.MeshStandardMaterial({
              color: spec.color,
              roughness: spec.roughness,
              metalness: spec.metalness,
            }),
          };
        });
      }),
    [kind]
  );

  const report = useMemo<ProceduralFurnitureReport | null>(() => {
    const sizeM = proceduralFurnitureSizeM(kind);
    if (!sizeM) return null;
    const defaults = FURNITURE_DEFAULTS[kind];
    return {
      kind,
      sizeM,
      targetM: [defaults.w, defaults.height3d, defaults.h],
      partCount: built.length,
      instanceCount: 0,
    };
  }, [kind, built.length]);

  const reportedRef = useRef<string>("");
  useEffect(() => {
    if (!report) return;
    const payload = { ...report, instanceCount: items.length };
    const key = JSON.stringify(payload);
    if (reportedRef.current === key) return;
    reportedRef.current = key;
    onReport(payload);
  }, [report, items.length, onReport]);

  if (items.length === 0 || built.length === 0) return null;

  const limit = instanceLimitFor(items.length);

  return (
    <>
      {built.map((part, index) => (
        <Instances
          key={`${kind}-${part.id}-${limit}`}
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
              // 與匯入模型/白模 box 同號:2D 的 rotationDeg 是螢幕座標順時針,
              // 對到 3D 的 Y 軸就是負值。
              rotation={[0, (-item.rotationDeg * Math.PI) / 180, 0]}
            />
          ))}
        </Instances>
      ))}
    </>
  );
}

interface ProceduralFurnitureProps {
  furniture: FurnitureItem[];
  onReport: (report: ProceduralFurnitureReport) => void;
}

/**
 * 依 kind 分組繪製有程序化造型的家具。沒有造型的 kind 直接跳過 —— 呼叫端
 * 負責用別的方式(匯入模型)畫它們,這裡不做 fallback,免得同一件家具被畫兩次。
 *
 * 不需要 `<Suspense>`:幾何是同步算出來的,沒有任何網路請求。
 */
export default function ProceduralFurniture({
  furniture,
  onReport,
}: ProceduralFurnitureProps) {
  const groups = useMemo(() => {
    const byKind = new Map<FurnitureKind, FurnitureItem[]>();
    for (const item of furniture) {
      if (!hasProceduralFurniture(item.kind)) continue;
      const list = byKind.get(item.kind);
      if (list) list.push(item);
      else byKind.set(item.kind, [item]);
    }
    return [...byKind.entries()];
  }, [furniture]);

  return (
    <>
      {groups.map(([kind, items]) => (
        <ProceduralKindGroup
          key={kind}
          kind={kind}
          items={items}
          onReport={onReport}
        />
      ))}
    </>
  );
}
