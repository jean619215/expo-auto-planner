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
import { type FurnitureItem } from "@/lib/venue/furniture";
import { catalogItem, type CatalogItem } from "@/lib/venue/catalog";
import { proceduralPartsForItem } from "@/lib/venue/proceduralFurniture";
import { useNormalizedFurnitureModel } from "./furnitureModels";
import { buildPartGeometry } from "./proceduralFurniture";

/** 探針靠這個名字找場上的家具 mesh。鍵是目錄代碼。 */
export function whiteboxFurnitureName(code: string): string {
  return `venue-furniture-${code}`;
}

/**
 * 每一**件**家具的根 group 名字(mesh 名字是每個**零件**一個,同一件會有好幾個,
 * 同一個代碼放兩件更會混在一起)。
 *
 * 存在理由是探針要能數出「場上有幾件」而不是「有幾種」—— 而且要從場景圖數,
 * 不是把家具陣列的長度印回 DOM。報價的逐件加總就是靠這個數字交叉驗證的:
 * 場景裡少掛了一件,計出來的金額與畫面就會對不上,而不是兩邊一起錯。
 *
 * 前綴刻意不是 `venue-furniture-` 的延伸 —— 那會讓依 mesh 前綴切代碼的探針
 * 把 `item-TBL-120-75` 當成一個代碼。
 */
export function whiteboxFurnitureItemName(code: string): string {
  return `venue-item-${code}`;
}

/** 白模材質:單色、不吃貼圖。依顏色快取一份,由呼叫端負責卸載時 dispose。 */
function useWhiteboxMaterial(color: string): THREE.MeshStandardMaterial {
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.8,
        metalness: 0,
      }),
    [color],
  );
  useEffect(() => () => material.dispose(), [material]);
  return material;
}

interface ItemGeometriesProps {
  item: CatalogItem;
  children: (geometries: THREE.BufferGeometry[]) => React.ReactNode;
}

/** 有 GLB 的品項:幾何來自步驟 03 的同一份快取(鍵是目錄代碼)。 */
function ModelGeometries({ item, children }: ItemGeometriesProps) {
  // 幾何來源已由呼叫端確認是 model。
  const geometry = item.geometry as Extract<
    CatalogItem["geometry"],
    { kind: "model" }
  >;
  const { parts } = useNormalizedFurnitureModel(
    item,
    geometry.url,
    geometry.rotationY,
  );
  return <>{children(parts.map((part) => part.geometry))}</>;
}

/** 程序化品項:幾何由零件規格即時建,卸載時自行 dispose。 */
function ProceduralGeometries({ item, children }: ItemGeometriesProps) {
  const geometries = useMemo(
    () =>
      (proceduralPartsForItem(item) ?? []).map((part) => buildPartGeometry(part)),
    [item],
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
  // 幾何、尺寸、顏色、mesh 命名全部以目錄代碼為鍵。查不到的代碼(存檔中已
  // 下架的品項)一律畫不出來,不猜尺寸 —— 見下方 `entry` 為 undefined 的分支。
  const entry = catalogItem(item.code);
  const material = useWhiteboxMaterial(entry?.color ?? "#808080");
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
          name={whiteboxFurnitureName(item.code)}
          geometry={geometry}
          material={selected ? selectedMaterial : material}
        />
      ))}
    </>
  );

  const body = !entry ? null : entry.geometry.kind === "model" ? (
    <ModelGeometries item={entry}>{renderParts}</ModelGeometries>
  ) : entry.geometry.kind === "procedural" ? (
    <ProceduralGeometries item={entry}>{renderParts}</ProceduralGeometries>
  ) : (
    // 保底:目錄新增了這裡還不認得的幾何種類時,至少畫得出來,而不是無聲消失。
    <mesh
      name={whiteboxFurnitureName(item.code)}
      position={[0, entry.height3d / 2, 0]}
      material={selected ? selectedMaterial : material}
    >
      <boxGeometry args={[entry.w, entry.height3d, entry.d]} />
    </mesh>
  );

  return (
    <group
      ref={meshRef}
      name={whiteboxFurnitureItemName(item.code)}
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
