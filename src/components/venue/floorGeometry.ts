import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { FloorPolygon } from "@/lib/venue/plan";

// 共用地板厚度常數,`VenueScene`(步驟 02)與 `RefinedScene`(步驟 03)
// 一律從這裡匯入,避免兩處各自硬編碼造成不一致。
export const FLOOR_THICKNESS_M = 0.1;

// 共用地板三角化邏輯(architect-plan.md D4)。演算法照搬
// `VenueScene.tsx` 原本 `FloorMesh` 內的 `useMemo` 內容,一字不改 —— 唯一
// 目的是讓 02/03 兩步驟的 `ExtrudeGeometry`(含凹多邊形三角化行為)完全
// 一致。回傳的 geometry 在依賴的 `polygon` 改變或呼叫端卸載時自動 dispose。
export function useFloorGeometry(polygon: FloorPolygon) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(polygon[0].x, polygon[0].y);
    polygon.slice(1).forEach((p) => shape.lineTo(p.x, p.y));
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, {
      depth: FLOOR_THICKNESS_M,
      bevelEnabled: false,
    });
  }, [polygon]);

  useEffect(() => {
    return () => geometry.dispose();
  }, [geometry]);

  return geometry;
}
