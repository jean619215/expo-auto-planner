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
import { getSurfaceTextureStats } from "./surfaceTextures";

/** 牆/柱 mesh 用這些名字標記自己,探針才找得到(見 VenueScene.tsx)。 */
export const VENUE_WALL_NAME = "venue-wall";
export const VENUE_COLUMN_NAME = "venue-column";

/** 家具 mesh 的命名前綴(見 whiteboxFurniture.tsx)。 */
export const FURNITURE_NAME_PREFIX = "venue-furniture-";

/** 家具**單件**根 group 的命名前綴(見 whiteboxFurniture.tsx)。 */
export const FURNITURE_ITEM_NAME_PREFIX = "venue-item-";

/** geometry 的三角面數(index 優先,否則用頂點數)。 */
function triangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  if (index) return index.count / 3;
  const position = geometry.getAttribute("position");
  return position ? position.count / 3 : 0;
}

/** 場上某一種家具的實際幾何/材質摘要。 */
export interface WhiteboxFurnitureShape {
  /** 目錄代碼。 */
  code: string;
  /** 這個品項被拆成幾個零件 mesh。 */
  partCount: number;
  /**
   * 這個代碼在場上有幾**件**(不是幾個零件)。
   *
   * 數的是場景圖裡的根 group,不是家具陣列的長度 —— 報價的逐件加總拿這個數字
   * 交叉驗證,回音式的探針在那裡起不了作用。
   */
  instances: number;
  /** 零件三角面數總和。單一 box 是 12,所以 >12 就證明不是方塊了。 */
  triangles: number;
  /**
   * 這個品項**實際幾何**的外廓(公尺,未套用擺放位置與旋轉)。
   *
   * 量的是零件 geometry 的包圍盒聯集,不是世界包圍盒:世界包圍盒會把「場上
   * 有幾件、各自擺在哪」也算進去,同一個品項放兩件就會量出兩倍寬。geometry
   * 空間的聯集只描述這個品項本身多大 —— 那才是要拿來跟目錄比對的東西。
   *
   * 聯集必須取各軸的 min/max 極值,不能取各零件跨距的最大值:講台由三塊疊起來
   * 的板子組成,每塊自己只有幾公分厚,取最大跨距會量出「講台高 0.05m」。
   */
  sizeM: [number, number, number];
  /** 材質上有沒有掛貼圖 —— 步驟 02 的規定是「有形狀、沒貼圖」。 */
  hasMap: boolean;
  hasNormalMap: boolean;
}

export interface VenueSceneMeasurements {
  /** 第一面牆 mesh 的實際世界高度(公尺);場上無牆時為 0。 */
  wallHeightM: number;
  /** 第一根柱子 mesh 的實際世界高度(公尺);場上無柱時為 0。 */
  columnHeightM: number;
  /** 場上各品項的幾何/材質摘要,依代碼排序。 */
  furnitureShapes: WhiteboxFurnitureShape[];
  /**
   * 步驟 03 專屬的地板/牆程序化材質累計烘焙次數。
   *
   * 步驟 02 現在會載入 GLB(貼圖嵌在檔案裡,擋不掉也不需要擋),所以
   * 「步驟 02 不載入步驟 03 專用資源」這條規定的實質內容改成兩件事:
   * 家具材質上沒有貼圖(見 hasMap),以及這個數字維持 0。
   */
  surfaceBakes: number;
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

    const shapes = new Map<string, WhiteboxFurnitureShape>();
    // 每個品項的幾何極值(geometry 空間)。與 shapes 分開存是因為外廓要靠
    // min/max 累積,而 WhiteboxFurnitureShape 對外只吐算好的 sizeM。
    const extents = new Map<
      string,
      { min: [number, number, number]; max: [number, number, number] }
    >();
    // 每個代碼的件數:先數根 group,再在下面併進各代碼的摘要裡。
    const instances = new Map<string, number>();
    scene.traverse((node) => {
      if (!node.name.startsWith(FURNITURE_ITEM_NAME_PREFIX)) return;
      const code = node.name.slice(FURNITURE_ITEM_NAME_PREFIX.length);
      instances.set(code, (instances.get(code) ?? 0) + 1);
    });

    scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      if (!node.name.startsWith(FURNITURE_NAME_PREFIX)) return;
      const code = node.name.slice(FURNITURE_NAME_PREFIX.length);
      const existing = shapes.get(code) ?? {
        code,
        partCount: 0,
        instances: 0,
        triangles: 0,
        sizeM: [0, 0, 0] as [number, number, number],
        hasMap: false,
        hasNormalMap: false,
      };
      const extent = extents.get(code) ?? {
        min: [Infinity, Infinity, Infinity] as [number, number, number],
        max: [-Infinity, -Infinity, -Infinity] as [number, number, number],
      };
      // 同一個品項可能場上有多件,每件都掛同一組零件 —— partCount 只算
      // 一件的零件數,所以用第一件為準(後續件的零件是同樣的幾何)。
      const material = node.material as THREE.MeshStandardMaterial;

      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      const partBox = node.geometry.boundingBox;
      if (partBox) {
        const lo = [partBox.min.x, partBox.min.y, partBox.min.z];
        const hi = [partBox.max.x, partBox.max.y, partBox.max.z];
        for (let axis = 0; axis < 3; axis++) {
          if (Number.isFinite(lo[axis])) {
            extent.min[axis] = Math.min(extent.min[axis], lo[axis]);
          }
          if (Number.isFinite(hi[axis])) {
            extent.max[axis] = Math.max(extent.max[axis], hi[axis]);
          }
        }
        extents.set(code, extent);
      }
      const sizeM: [number, number, number] = [0, 1, 2].map((axis) => {
        const span = extent.max[axis] - extent.min[axis];
        return Number.isFinite(span) ? Math.round(span * 1000) / 1000 : 0;
      }) as [number, number, number];

      shapes.set(code, {
        code,
        partCount: existing.partCount + 1,
        instances: instances.get(code) ?? 0,
        triangles: existing.triangles + triangleCount(node.geometry),
        sizeM,
        hasMap: existing.hasMap || material?.map != null,
        hasNormalMap: existing.hasNormalMap || material?.normalMap != null,
      });
    });

    const next: VenueSceneMeasurements = {
      wallHeightM: measure(VENUE_WALL_NAME),
      columnHeightM: measure(VENUE_COLUMN_NAME),
      furnitureShapes: [...shapes.values()].sort((a, b) =>
        a.code.localeCompare(b.code),
      ),
      surfaceBakes: getSurfaceTextureStats().totalBakes,
    };

    const key = JSON.stringify(next);
    if (key === lastRef.current) return;
    lastRef.current = key;
    onReport(next);
  });

  return null;
}
