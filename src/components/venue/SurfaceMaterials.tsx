"use client";

// architect-plan.md 階段 A 步驟 3 — 場景內 context provider:烘焙 procedural
// PBR 材質(architect-plan.md D1-D8)、以 memo 快取三份共用
// `MeshStandardMaterial`、卸載時完整釋放。只被 RefinedScene.tsx(步驟 03)
// 使用;VenueScene.tsx(步驟 02)不得 import 本檔。

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { REFINED_SURFACE } from "./refinedLighting";
import {
  AO_MAP_INTENSITY,
  FLOOR_TILE_M,
  MAX_ANISOTROPY,
  WALL_TILE_M,
  bakeSurfaceTextures,
  disposeSurfaceTextureSet,
  NORMAL_SCALE,
  type SurfaceTextureSet,
} from "./surfaceTextures";
import {
  surfaceSelectionKey,
  type SurfaceSelection,
} from "@/lib/venue/surfacePresets";

export interface SurfaceMaterialsValue {
  floor: THREE.MeshStandardMaterial | null;
  wall: THREE.MeshStandardMaterial | null;
  column: THREE.MeshStandardMaterial | null;
  ready: boolean;
  // Raw baked render targets, exposed so RefinedSceneProbe.tsx can
  // gl.readRenderTargetPixels() the real GPU output (T2/T4/T5) — the
  // materials above only expose `.texture`, not the target itself.
  textureSet: SurfaceTextureSet | null;
}

const EMPTY_VALUE: SurfaceMaterialsValue = {
  floor: null,
  wall: null,
  column: null,
  ready: false,
  textureSet: null,
};

const SurfaceMaterialsContext = createContext<SurfaceMaterialsValue>(EMPTY_VALUE);

/** Consumed by RefinedScene.tsx's floor/wall/column meshes. `materials.*`
 * is null until the bake's `useLayoutEffect` commits — consumers should
 * fall back to a task-2-equivalent plain material while `ready` is false
 * (in practice a single-commit window, see architect-plan.md step 3). */
export function useSurfaceMaterials(): SurfaceMaterialsValue {
  return useContext(SurfaceMaterialsContext);
}

interface SurfaceMaterialsProps {
  children: ReactNode;
  /** 使用者選的地板/牆面材質(feedback round 2, R6)。 */
  selection: SurfaceSelection;
  /**
   * 使用者自行上傳的材質圖(blob URL),沒有就是 null。
   *
   * 上傳的只有一張彩色圖 —— 沒有 normal / roughness,所以這條路徑刻意
   * **關掉凹凸感**:寧可比內建材質平,也不要用亮度硬推出一組與圖案對不上
   * 的假陰影。
   */
  uploads: { floor: string | null; wall: string | null };
  /** Reported whenever readiness flips — RefinedScene.tsx uses this to
   * drive the `data-materials-ready` DOM attribute / loading overlay. */
  onReady?: (ready: boolean) => void;
}

export default function SurfaceMaterials({
  children,
  selection,
  uploads,
  onReady,
}: SurfaceMaterialsProps) {
  const gl = useThree((state) => state.gl);
  const [textureSet, setTextureSet] = useState<SurfaceTextureSet | null>(null);

  // Bakes once per mount, before paint. Deliberately depends only on
  // `[gl]` — architect-plan.md D2/D3 makes texture UV world-meters, so
  // texture content is fully decoupled from polygon/walls/columns/
  // furniture; `revision` must NOT participate here, or every AI scene
  // edit while sitting on step 03 would re-pay the bake cost for nothing.
  // 本次造訪期間烘焙過的材質快取,鍵是選擇組合。使用者切到別的材質再切
  // 回來時不重烘 —— 一次烘焙是 8 張 render target,來回比較材質是很自然
  // 的操作,每次都重烘會讓比較變得卡頓。
  //
  // 快取的擁有者是這個 mount:離開步驟 03 時整批釋放(下面的 cleanup),
  // 所以「往返不累積 GPU 資源」仍然成立;上限也只有 preset 組合數。
  const cacheRef = useRef(new Map<string, SurfaceTextureSet>());
  const selectionKey = surfaceSelectionKey(selection);

  useLayoutEffect(() => {
    const cache = cacheRef.current;
    const cached = cache.get(selectionKey);
    const set = cached ?? bakeSurfaceTextures(gl, selection);
    if (!cached) cache.set(selectionKey, set);
    // Deferred to a microtask (same convention as src/app/login/page.tsx)
    // to avoid the project's react-hooks/set-state-in-effect rule against
    // calling setState synchronously in an effect body. A microtask still
    // drains before the browser paints, so this preserves the "no visible
    // unbaked frame" guarantee a synchronous call would have given —
    // README/architect-plan.md's "single commit" framing is about paint
    // timing, not React commit counting.
    queueMicrotask(() => {
      setTextureSet(set);
    });
    // 這裡刻意不釋放 —— 釋放的責任在下面「卸載時整批清空」的 effect。
    // 切換材質時釋放的話,快取就沒有意義了。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, selectionKey]);

  // 卸載(離開步驟 03)時把本次造訪烘焙過的全部釋放。
  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      for (const set of cache.values()) disposeSurfaceTextureSet(set);
      cache.clear();
    };
  }, []);

  // 上傳的圖:單張 baseColor,非同步載入。載完才換上去,所以切換的瞬間
  // 看到的仍是原本的材質,不會閃一下空白。
  const [uploadedTextures, setUploadedTextures] = useState<{
    floor: THREE.Texture | null;
    wall: THREE.Texture | null;
  }>({ floor: null, wall: null });

  useEffect(() => {
    const loader = new THREE.TextureLoader();
    let cancelled = false;
    const created: THREE.Texture[] = [];

    function load(url: string | null, tileM: number): Promise<THREE.Texture | null> {
      if (!url) return Promise.resolve(null);
      return loader.loadAsync(url).then((texture) => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1 / tileM, 1 / tileM);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = MAX_ANISOTROPY;
        created.push(texture);
        return texture;
      });
    }

    void Promise.all([
      load(uploads.floor, FLOOR_TILE_M),
      load(uploads.wall, WALL_TILE_M),
    ]).then(([floor, wall]) => {
      if (cancelled) return;
      setUploadedTextures({ floor, wall });
    });

    return () => {
      cancelled = true;
      for (const texture of created) texture.dispose();
    };
  }, [uploads.floor, uploads.wall]);

  const materials = useMemo(() => {
    if (!textureSet) return null;

    // D5: `color: 0xffffff` on every surface — the baked albedo texture is
    // the sole source of both base tone and its variation (task 2's
    // anti-overexposure tuning of REFINED_SURFACE.*.color is baked into
    // the texture's mean, see surfaceTextures.ts baseColorFor()). Floor
    // additionally omits an explicit `roughness` (defaults to 1), so its
    // roughnessMap is the sole source there too (D6).
    // 上傳的圖走「只有 baseColor」的路徑:normal / roughness / ao 全部不掛,
    // 也不從亮度推 normal。上傳的材質因此比內建的平,但不會出現與圖案對不上
    // 的假陰影。
    const floor = uploadedTextures.floor
      ? new THREE.MeshStandardMaterial({
          map: uploadedTextures.floor,
          color: 0xffffff,
          roughness: REFINED_SURFACE.floor.roughness,
          metalness: REFINED_SURFACE.floor.metalness,
          side: THREE.DoubleSide,
        })
      : new THREE.MeshStandardMaterial({
          map: textureSet.floor.map,
          normalMap: textureSet.floor.normalMap,
          roughnessMap: textureSet.floor.roughnessMap,
          aoMap: textureSet.floor.aoMap,
          aoMapIntensity: AO_MAP_INTENSITY,
          color: 0xffffff,
          metalness: REFINED_SURFACE.floor.metalness,
          side: THREE.DoubleSide,
          normalScale: new THREE.Vector2(NORMAL_SCALE.floor, NORMAL_SCALE.floor),
        });

    const wall = uploadedTextures.wall
      ? new THREE.MeshStandardMaterial({
          map: uploadedTextures.wall,
          color: 0xffffff,
          roughness: REFINED_SURFACE.wall.roughness,
          metalness: REFINED_SURFACE.wall.metalness,
        })
      : new THREE.MeshStandardMaterial({
          map: textureSet.wall.map,
          normalMap: textureSet.wall.normalMap,
          color: 0xffffff,
          roughness: REFINED_SURFACE.wall.roughness,
          metalness: REFINED_SURFACE.wall.metalness,
          normalScale: new THREE.Vector2(NORMAL_SCALE.wall, NORMAL_SCALE.wall),
        });

    const column = new THREE.MeshStandardMaterial({
      map: textureSet.column.map,
      normalMap: textureSet.column.normalMap,
      color: 0xffffff,
      roughness: REFINED_SURFACE.column.roughness,
      metalness: REFINED_SURFACE.column.metalness,
      normalScale: new THREE.Vector2(NORMAL_SCALE.column, NORMAL_SCALE.column),
    });

    return { floor, wall, column };
  }, [textureSet, uploadedTextures]);

  useEffect(() => {
    if (!materials) return;
    return () => {
      materials.floor.dispose();
      materials.wall.dispose();
      materials.column.dispose();
    };
  }, [materials]);

  const ready = materials !== null;

  useEffect(() => {
    onReady?.(ready);
  }, [ready, onReady]);

  const value = useMemo<SurfaceMaterialsValue>(
    () => ({
      floor: materials?.floor ?? null,
      wall: materials?.wall ?? null,
      column: materials?.column ?? null,
      ready,
      textureSet,
    }),
    [materials, ready, textureSet],
  );

  return (
    <SurfaceMaterialsContext.Provider value={value}>{children}</SurfaceMaterialsContext.Provider>
  );
}
