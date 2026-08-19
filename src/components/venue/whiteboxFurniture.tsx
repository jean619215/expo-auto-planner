"use client";

// 步驟 02(白模預覽)的家具外型(feedback round 2, R5)。
//
// 回饋:「家具也應該看得當模型的形狀(不需要貼圖),而不是現在的方塊」。
//
// 六種有 GLB 的家具直接重用步驟 03 那份**已正規化的幾何**(同一個依 kind
// 的快取),三種展場專屬家具用既有的程序化零件規格。兩者的材質一律換成單色
// MeshStandardMaterial —— 沒有貼圖、沒有法線貼圖。這是本步驟與步驟 03 的
// 唯一差別:外型相同,材質不同。
//
// 這推翻了 venue-refined-3d 原本「步驟 02 不載入步驟 03 專用資源」的定調。
// 貼圖是嵌在 GLB 裡的,所以「不載入貼圖」不可能靠不下載 GLB 來達成 ——
// 真正的分界是材質上有沒有掛貼圖,以及步驟 03 專屬的地板/牆程序化材質有沒有
// 被烘焙。兩者都有對應的檢查(venue-furniture-assets.spec.ts)。

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import {
  FURNITURE_DEFAULTS,
  type FurnitureItem,
  type FurnitureKind,
} from "@/lib/venue/furniture";
import {
  hasProceduralFurniture,
  proceduralFurnitureParts,
} from "@/lib/venue/proceduralFurniture";
import { furnitureModel } from "@/lib/venue/models";
import { useNormalizedFurnitureModel } from "./furnitureModels";
import { buildPartGeometry } from "./proceduralFurniture";

/** 探針靠這個名字找場上的家具 mesh。 */
export function whiteboxFurnitureName(kind: FurnitureKind): string {
  return `venue-furniture-${kind}`;
}

/** 白模材質:單色、不吃貼圖。依 kind 快取一份,由呼叫端負責卸載時 dispose。 */
function useWhiteboxMaterial(kind: FurnitureKind): THREE.MeshStandardMaterial {
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: FURNITURE_DEFAULTS[kind].color,
        roughness: 0.8,
        metalness: 0,
      }),
    [kind],
  );
  useEffect(() => () => material.dispose(), [material]);
  return material;
}

interface KindGeometriesProps {
  kind: FurnitureKind;
  children: (geometries: THREE.BufferGeometry[]) => React.ReactNode;
}

/** 有 GLB 的 kind:幾何來自步驟 03 的同一份快取。 */
function ModelGeometries({ kind, children }: KindGeometriesProps) {
  // furnitureModel(kind) 已由呼叫端確認存在。
  const model = furnitureModel(kind)!;
  const { parts } = useNormalizedFurnitureModel(
    kind,
    model.url,
    model.rotationY,
  );
  return <>{children(parts.map((part) => part.geometry))}</>;
}

/** 程序化 kind:幾何由零件規格即時建,卸載時自行 dispose。 */
function ProceduralGeometries({ kind, children }: KindGeometriesProps) {
  const geometries = useMemo(
    () =>
      (proceduralFurnitureParts(kind) ?? []).map((part) =>
        buildPartGeometry(part),
      ),
    [kind],
  );
  useEffect(
    () => () => {
      for (const geometry of geometries) geometry.dispose();
    },
    [geometries],
  );
  return <>{children(geometries)}</>;
}

interface WhiteboxFurnitureItemProps {
  item: FurnitureItem;
  selected: boolean;
  meshRef: (node: THREE.Object3D | null) => void;
  onSelect: () => void;
}

/**
 * 單件家具。一件 = 一個 group,底下掛該 kind 的所有零件 mesh —— gizmo 與
 * 拖曳都掛在 group 上,所以選取/搬移/旋轉的語意與原本的單一 box 完全相同。
 */
export default function WhiteboxFurnitureItem({
  item,
  selected,
  meshRef,
  onSelect,
}: WhiteboxFurnitureItemProps) {
  const defaults = FURNITURE_DEFAULTS[item.kind];
  const material = useWhiteboxMaterial(item.kind);
  const selectedMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#1F4E79",
        roughness: 0.8,
        metalness: 0,
      }),
    [],
  );
  useEffect(() => () => selectedMaterial.dispose(), [selectedMaterial]);

  const renderParts = (geometries: THREE.BufferGeometry[]) => (
    <>
      {geometries.map((geometry, index) => (
        <mesh
          key={index}
          name={whiteboxFurnitureName(item.kind)}
          geometry={geometry}
          material={selected ? selectedMaterial : material}
        />
      ))}
    </>
  );

  const body = furnitureModel(item.kind) ? (
    <ModelGeometries kind={item.kind}>{renderParts}</ModelGeometries>
  ) : hasProceduralFurniture(item.kind) ? (
    <ProceduralGeometries kind={item.kind}>{renderParts}</ProceduralGeometries>
  ) : (
    // 保底:有人往 FURNITURE_DEFAULTS 加了新 kind 卻還沒給它造型時,至少
    // 畫得出來,而不是無聲消失。
    <mesh
      name={whiteboxFurnitureName(item.kind)}
      position={[0, defaults.height3d / 2, 0]}
      material={selected ? selectedMaterial : material}
    >
      <boxGeometry args={[item.w, defaults.height3d, item.h]} />
    </mesh>
  );

  return (
    <group
      ref={meshRef}
      position={[item.center.x, 0, item.center.y]}
      rotation={[0, (-item.rotationDeg * Math.PI) / 180, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      {body}
    </group>
  );
}
