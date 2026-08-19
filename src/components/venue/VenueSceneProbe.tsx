"use client";

// 步驟 02 白模場景的內部探針(feedback round 2, T1)。
//
// 存在理由與 RefinedSceneProbe 相同:牆高改成可調之後,「設定值有沒有生效」
// 不能靠把 prop 印回 DOM 來驗 —— 那種屬性即使 boxGeometry 的高度被寫死成
// 3 也照樣是對的。這裡量的是**場景圖裡實際 mesh 的世界包圍盒**,是唯一能
// 區分「幾何真的變高了」與「只是設定值換了個數字」的讀數。
//
// 只量第一面牆與第一根柱子:牆高是全域值,全部 mesh 必然同高,量一個就夠。

import { useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

/** 牆/柱 mesh 用這些名字標記自己,探針才找得到(見 VenueScene.tsx)。 */
export const VENUE_WALL_NAME = "venue-wall";
export const VENUE_COLUMN_NAME = "venue-column";

export interface VenueSceneMeasurements {
  /** 第一面牆 mesh 的實際世界高度(公尺);場上無牆時為 0。 */
  wallHeightM: number;
  /** 第一根柱子 mesh 的實際世界高度(公尺);場上無柱時為 0。 */
  columnHeightM: number;
}

interface VenueSceneProbeProps {
  onReport: (measurements: VenueSceneMeasurements) => void;
}

export default function VenueSceneProbe({ onReport }: VenueSceneProbeProps) {
  const { scene } = useThree();
  // Box3 重複使用 —— 每幀都 new 一個是白白製造垃圾(AGENTS.md:不在 render
  // 期間新建物件)。
  const boxRef = useRef(new THREE.Box3());
  const lastRef = useRef<string>("");

  useFrame(() => {
    const measure = (name: string): number => {
      const node = scene.getObjectByName(name);
      if (!node) return 0;
      const box = boxRef.current.setFromObject(node);
      const height = box.max.y - box.min.y;
      // 幾何尚未上傳/包圍盒為空時 Box3 會是 -Infinity..Infinity。
      return Number.isFinite(height) ? Math.round(height * 1000) / 1000 : 0;
    };

    const next: VenueSceneMeasurements = {
      wallHeightM: measure(VENUE_WALL_NAME),
      columnHeightM: measure(VENUE_COLUMN_NAME),
    };

    const key = `${next.wallHeightM}|${next.columnHeightM}`;
    if (key === lastRef.current) return;
    lastRef.current = key;
    onReport(next);
  });

  return null;
}
