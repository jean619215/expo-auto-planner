"use client";

// architect-plan.md 階段 A 步驟 3 — 場景內 context provider:烘焙 procedural
// PBR 材質(architect-plan.md D1-D8)、以 memo 快取共用的
// `MeshStandardMaterial`、卸載時完整釋放。只被 RefinedScene.tsx(步驟 03)
// 使用;VenueScene.tsx(步驟 02)不得 import 本檔。
//
// 第三輪 T9:牆面從「全場一份」改成**逐面牆各自設定**。這裡的結構因此從
// 「地板 / 牆 / 柱子三份材質」變成「地板 + 柱子兩份,加上一組依**來源**索引的
// 牆面材質」——「來源」是三者之一:這面牆自己上傳的圖、款式的實拍貼圖包、
// 或程序化烘焙。按來源快取而不是按牆:十面牆全設成木紋只會有一份木紋材質。

import {
  createContext,
  useCallback,
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
  bakeWallTextures,
  disposeSurfaceTextureSet,
  disposeWallTextureSet,
  NORMAL_SCALE,
  type SurfaceTextureSet,
  type WallTextureSet,
} from "./surfaceTextures";
import {
  floorPreset,
  surfaceSelectionKey,
  wallPreset,
  wallPresetIdFor,
  type SurfacePreset,
  type SurfaceSelection,
  type SurfaceTexturePack,
} from "@/lib/venue/surfacePresets";

/** 一次載入請求:上傳只有一張圖,貼圖包有三張。 */
type LoadedSurfaceRequest =
  | { kind: "upload"; map: string; tileM: number }
  | {
      kind: "pack";
      map: string;
      normalMap: string;
      roughnessMap: string;
      tileM: number;
    };

interface LoadedSurfaceTextures {
  map: THREE.Texture;
  normalMap: THREE.Texture | null;
  roughnessMap: THREE.Texture | null;
}

function requestKey(request: LoadedSurfaceRequest | null): string {
  if (!request) return "";
  return request.kind === "upload"
    ? `upload:${request.map}`
    : `pack:${request.map}`;
}

/** 使用者自行上傳的材質圖(blob URL)。`walls` 是逐面牆的,鍵是 `WallSegment.id`。 */
export interface SurfaceUploads {
  floor: string | null;
  /** 預設牆面的自訂圖:套用在**沒有個別指定款式**的牆上。 */
  wall: string | null;
  walls: Record<string, string>;
}

export const EMPTY_SURFACE_UPLOADS: SurfaceUploads = {
  floor: null,
  wall: null,
  walls: {},
};

/**
 * 一面牆的材質來源。三者互斥,優先序見 `resolveWallSource()`。
 *
 * `key` 同時是材質快取的鍵 —— 兩面牆算出同一個 key 就**共用同一個材質物件**,
 * 那是刻意的(省 GPU 資源);算出不同 key 就必須是不同物件,而 T9 的破壞驗證
 * 正是把後者打破。
 */
type WallMaterialSource =
  | { kind: "upload"; map: string }
  | { kind: "pack"; pack: SurfaceTexturePack; preset: SurfacePreset }
  | { kind: "proc"; presetId: string };

/**
 * 這面牆該用哪一份材質。`wallId` 為 null 代表「預設牆面」(還沒有牆時的
 * 選擇,以及所有未覆寫的牆共用的那一份)。
 *
 * 優先序:自己上傳的圖 > 個別指定的款式 > 預設牆面的自訂圖 > 預設款式。
 * 「自己上傳的圖」排最前面 —— 使用者剛對這面牆丟進來的圖,比任何選單上的
 * 選擇都更能代表當下的意圖。
 */
function resolveWallSource(
  selection: SurfaceSelection,
  uploads: SurfaceUploads,
  wallId: string | null,
): { key: string; source: WallMaterialSource } {
  const ownUpload = wallId ? uploads.walls[wallId] : undefined;
  if (ownUpload) {
    return { key: `upload:${wallId}`, source: { kind: "upload", map: ownUpload } };
  }
  const override = wallId ? selection.wallOverrides[wallId] : undefined;
  if (!override && uploads.wall) {
    return { key: "upload:default", source: { kind: "upload", map: uploads.wall } };
  }
  const presetId = wallId
    ? wallPresetIdFor(selection, wallId)
    : wallPreset(selection.wall).id;
  const preset = wallPreset(presetId);
  if (preset.textures) {
    return {
      key: `pack:${presetId}`,
      source: { kind: "pack", pack: preset.textures, preset },
    };
  }
  return { key: `proc:${presetId}`, source: { kind: "proc", presetId } };
}

/** 一份牆面材質該掛的貼圖,以及(程序化才有的)可供讀回的 render target。 */
interface WallMaterialSpec {
  map: THREE.Texture;
  normalMap: THREE.Texture | null;
  roughnessMap: THREE.Texture | null;
  albedoTarget: THREE.WebGLRenderTarget | null;
}

export interface SurfaceMaterialsValue {
  floor: THREE.MeshStandardMaterial | null;
  /** 預設牆面的材質。沒有個別指定的牆用這一份,探針的全域牆面讀數也讀它。 */
  wall: THREE.MeshStandardMaterial | null;
  column: THREE.MeshStandardMaterial | null;
  ready: boolean;
  // Raw baked render targets, exposed so RefinedSceneProbe.tsx can
  // gl.readRenderTargetPixels() the real GPU output (T2/T4/T5) — the
  // materials above only expose `.texture`, not the target itself.
  textureSet: SurfaceTextureSet | null;
  /** 這面牆實際掛上去的材質(T9)。查不到時退回預設牆面那一份。 */
  wallMaterialFor: (wallId: string) => THREE.MeshStandardMaterial | null;
  /**
   * 材質 `uuid` → 該材質的 albedo render target。
   *
   * 探針靠這張表把「場景裡這面牆掛的是哪個材質」接回「那份材質實際烘出來的
   * 像素」—— T9 條件 2 要的是後者,不是選單的回音。走實拍貼圖包或上傳圖的
   * 牆沒有 render target(貼圖是檔案不是烘的),不會出現在表裡。
   */
  wallAlbedoTargets: Map<string, THREE.WebGLRenderTarget>;
}

const EMPTY_VALUE: SurfaceMaterialsValue = {
  floor: null,
  wall: null,
  column: null,
  ready: false,
  textureSet: null,
  wallMaterialFor: () => null,
  wallAlbedoTargets: new Map(),
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
  /** 使用者選的地板/牆面材質(feedback round 2, R6;T9 起含逐面牆覆寫)。 */
  selection: SurfaceSelection;
  /** 場上的牆 id —— 決定要為哪些款式烘貼圖。沒有牆就只烘預設那一份。 */
  wallIds: string[];
  /**
   * 使用者自行上傳的材質圖(blob URL),沒有就是 null。
   *
   * 上傳的只有一張彩色圖 —— 沒有 normal / roughness,所以這條路徑刻意
   * **關掉凹凸感**:寧可比內建材質平,也不要用亮度硬推出一組與圖案對不上
   * 的假陰影。
   */
  uploads: SurfaceUploads;
  /** Reported whenever readiness flips — RefinedScene.tsx uses this to
   * drive the `data-materials-ready` DOM attribute / loading overlay. */
  onReady?: (ready: boolean) => void;
}

export default function SurfaceMaterials({
  children,
  selection,
  wallIds,
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

  // --- T9:個別牆覆寫成別的**程序化**款式時,各自烘一份(兩張 512²)---------
  //
  // 只烘「程序化且不是預設」的款式:預設那一份已經在上面的整份烘焙裡,
  // 實拍貼圖包與上傳圖走的是檔案載入,兩者都不需要 render target。
  const proceduralOverrideIds = useMemo(() => {
    const defaultId = wallPreset(selection.wall).id;
    const ids = new Set<string>();
    for (const wallId of wallIds) {
      if (uploads.walls[wallId]) continue;
      const presetId = wallPresetIdFor(selection, wallId);
      if (presetId === defaultId) continue;
      if (wallPreset(presetId).textures) continue;
      ids.add(presetId);
    }
    return [...ids].sort();
  }, [selection, wallIds, uploads]);
  const overrideIdsKey = proceduralOverrideIds.join(",");

  const wallSetsRef = useRef(new Map<string, WallTextureSet>());
  const [wallSets, setWallSets] = useState<Map<string, WallTextureSet>>(
    new Map(),
  );

  useLayoutEffect(() => {
    const cache = wallSetsRef.current;
    let changed = false;
    for (const presetId of overrideIdsKey ? overrideIdsKey.split(",") : []) {
      if (cache.has(presetId)) continue;
      cache.set(presetId, bakeWallTextures(gl, presetId));
      changed = true;
    }
    if (!changed) return;
    // 與上面同一個理由:effect 裡不同步 setState。快取本身是 ref,所以
    // 這裡交出去的是一份複本 —— 直接把 ref 的 Map 放進 state 會讓下一次
    // 變更在同一個物件上發生,React 看不出差別。
    const snapshot = new Map(cache);
    queueMicrotask(() => {
      setWallSets(snapshot);
    });
  }, [gl, overrideIdsKey]);

  // 覆寫用的烘焙同樣在卸載時整批釋放 —— 與預設那份一致,不在切換款式時釋放
  // (使用者來回比較兩種木紋是很自然的操作)。
  useEffect(() => {
    const cache = wallSetsRef.current;
    return () => {
      for (const set of cache.values()) disposeWallTextureSet(set);
      cache.clear();
    };
  }, []);

  // --- 檔案來源的貼圖 ---------------------------------------------------
  //
  // 兩種來路:使用者上傳(單張 baseColor)與實拍貼圖包(diffuse + normal +
  // roughness)。上傳優先於 preset:使用者剛丟進來的圖比選單上的選擇更能代表
  // 當下的意圖。
  //
  // 兩者共用同一條非同步載入路徑,載完才換上去,所以切換的瞬間看到的仍是
  // 原本的材質,不會閃一下空白。
  const floorPack = floorPreset(selection.floor).textures ?? null;
  const floorRequest: LoadedSurfaceRequest | null = uploads.floor
    ? { kind: "upload", map: uploads.floor, tileM: FLOOR_TILE_M }
    : floorPack
      ? { kind: "pack", ...floorPack }
      : null;
  const floorRequestKey = requestKey(floorRequest);

  /** 牆面材質的來源表:材質快取鍵 → 來源。含預設那一份(key 為 null 的解析)。 */
  const wallSources = useMemo(() => {
    const map = new Map<string, WallMaterialSource>();
    const addFor = (wallId: string | null) => {
      const { key, source } = resolveWallSource(selection, uploads, wallId);
      map.set(key, source);
    };
    addFor(null);
    for (const wallId of wallIds) addFor(wallId);
    return map;
  }, [selection, uploads, wallIds]);

  /** 需要非同步載入的牆面來源(上傳圖與實拍貼圖包)。 */
  const wallFileRequests = useMemo(() => {
    const map = new Map<string, LoadedSurfaceRequest>();
    for (const [key, source] of wallSources) {
      if (source.kind === "upload") {
        map.set(key, { kind: "upload", map: source.map, tileM: WALL_TILE_M });
      } else if (source.kind === "pack") {
        map.set(key, { kind: "pack", ...source.pack });
      }
    }
    return map;
  }, [wallSources]);
  const wallFileRequestsKey = [...wallFileRequests.keys()].sort().join("|");

  const [fileTextures, setFileTextures] = useState<{
    floor: LoadedSurfaceTextures | null;
    walls: Map<string, LoadedSurfaceTextures>;
  }>({ floor: null, walls: new Map() });

  useEffect(() => {
    const loader = new THREE.TextureLoader();
    let cancelled = false;
    const created: THREE.Texture[] = [];

    function configure(texture: THREE.Texture, tileM: number, srgb: boolean) {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(1 / tileM, 1 / tileM);
      // normal / roughness 是資料不是顏色 —— 當成 sRGB 解讀會讓凹凸與
      // 粗糙度整體偏掉。
      texture.colorSpace = srgb
        ? THREE.SRGBColorSpace
        : THREE.NoColorSpace;
      texture.anisotropy = MAX_ANISOTROPY;
      created.push(texture);
    }

    async function load(
      request: LoadedSurfaceRequest | null,
    ): Promise<LoadedSurfaceTextures | null> {
      if (!request) return null;
      const map = await loader.loadAsync(request.map);
      configure(map, request.tileM, true);
      if (request.kind === "upload") {
        return { map, normalMap: null, roughnessMap: null };
      }
      const [normalMap, roughnessMap] = await Promise.all([
        loader.loadAsync(request.normalMap),
        loader.loadAsync(request.roughnessMap),
      ]);
      configure(normalMap, request.tileM, false);
      configure(roughnessMap, request.tileM, false);
      return { map, normalMap, roughnessMap };
    }

    const wallEntries = [...wallFileRequests.entries()];
    void Promise.all([
      load(floorRequest),
      Promise.all(
        wallEntries.map(([key, request]) =>
          load(request).then((loaded) => [key, loaded] as const),
        ),
      ),
    ]).then(([floor, walls]) => {
      if (cancelled) return;
      const map = new Map<string, LoadedSurfaceTextures>();
      for (const [key, loaded] of walls) if (loaded) map.set(key, loaded);
      setFileTextures({ floor, walls: map });
    });

    return () => {
      cancelled = true;
      for (const texture of created) texture.dispose();
    };
    // request 物件每次 render 都是新的,所以依 key 而不是依物件。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floorRequestKey, wallFileRequestsKey]);

  // --- 材質:地板與柱子 --------------------------------------------------
  //
  // 只依自己的輸入。改某一面牆的款式時這兩份**不該被重建** —— 重建一次就是
  // 一次 dispose + new,而畫面上完全沒有理由改變。
  const baseMaterials = useMemo(() => {
    if (!textureSet) return null;

    // D5: `color: 0xffffff` on every surface — the baked albedo texture is
    // the sole source of both base tone and its variation (task 2's
    // anti-overexposure tuning of REFINED_SURFACE.*.color is baked into
    // the texture's mean, see surfaceTextures.ts baseColorFor()). Floor
    // additionally omits an explicit `roughness` (defaults to 1), so its
    // roughnessMap is the sole source there too (D6).
    // 檔案來源的材質。上傳的只有 baseColor:normal / roughness / ao 全部不掛,
    // 也不從亮度推 normal —— 上傳的材質因此比內建的平,但不會出現與圖案對
    // 不上的假陰影。實拍貼圖包三張都有,所以該掛的都掛上。
    const floor = fileTextures.floor
      ? new THREE.MeshStandardMaterial({
          map: fileTextures.floor.map,
          normalMap: fileTextures.floor.normalMap ?? undefined,
          roughnessMap: fileTextures.floor.roughnessMap ?? undefined,
          color: 0xffffff,
          roughness: fileTextures.floor.roughnessMap
            ? 1
            : REFINED_SURFACE.floor.roughness,
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

    const column = new THREE.MeshStandardMaterial({
      map: textureSet.column.map,
      normalMap: textureSet.column.normalMap,
      color: 0xffffff,
      roughness: REFINED_SURFACE.column.roughness,
      metalness: REFINED_SURFACE.column.metalness,
      normalScale: new THREE.Vector2(NORMAL_SCALE.column, NORMAL_SCALE.column),
    });

    return { floor, column };
  }, [textureSet, fileTextures.floor]);

  useEffect(() => {
    if (!baseMaterials) return;
    return () => {
      baseMaterials.floor.dispose();
      baseMaterials.column.dispose();
    };
  }, [baseMaterials]);

  // --- 材質:每一種牆面來源一份 ------------------------------------------
  //
  // 先算出「每個來源該掛哪些貼圖」,再由下面的 effect 決定要不要真的重建。
  // 分兩步的理由是 T9 條件 2:改甲牆不得動到乙牆。整段用一個 useMemo 產生
  // 全部材質的話,任何一次選擇變更都會把**所有**牆的材質換成新物件 ——
  // 畫面上看不出來,但探針看得出來,而且那確實是不必要的 GPU 資源翻攪。
  const wallSpecs = useMemo(() => {
    if (!textureSet) return new Map<string, WallMaterialSpec>();
    const specs = new Map<string, WallMaterialSpec>();
    const defaultPresetId = wallPreset(selection.wall).id;

    for (const [key, source] of wallSources) {
      if (source.kind === "proc") {
        const set =
          source.presetId === defaultPresetId
            ? null
            : wallSets.get(source.presetId);
        // 覆寫款式的烘焙還沒回來時退回預設那一份 —— 只有一個 commit 的空窗,
        // 而且畫面上是「還沒換過去」而不是空白或黑掉。
        const textures = set ? set.wall : textureSet.wall;
        specs.set(key, {
          map: textures.map,
          normalMap: textures.normalMap,
          roughnessMap: null,
          albedoTarget: set ? set.wallAlbedoTarget : textureSet.wallAlbedoTarget,
        });
        continue;
      }

      const loaded = fileTextures.walls.get(key);
      if (!loaded) {
        // 檔案還沒載完:先用預設的烘焙貼圖頂著,載完這個 memo 會重跑。
        specs.set(key, {
          map: textureSet.wall.map,
          normalMap: textureSet.wall.normalMap,
          roughnessMap: null,
          albedoTarget: textureSet.wallAlbedoTarget,
        });
        continue;
      }
      specs.set(key, {
        map: loaded.map,
        normalMap: loaded.normalMap,
        roughnessMap: loaded.roughnessMap,
        // 檔案貼圖不是烘出來的,沒有 render target 可讀。
        albedoTarget: null,
      });
    }
    return specs;
  }, [textureSet, fileTextures.walls, wallSets, wallSources, selection.wall]);

  /**
   * 這一批來源的指紋:貼圖物件換了才需要換材質。
   *
   * 拿貼圖的 uuid 當依據而不是「選擇有沒有變」—— 上傳的圖是非同步載入的,
   * 選擇一變就重建的話,會在貼圖還沒載好時先建一份、載好再建一份。
   */
  const wallSpecsKey = [...wallSpecs.entries()]
    .map(
      ([key, spec]) =>
        `${key}=${spec.map.uuid},${spec.normalMap?.uuid ?? ""},${spec.roughnessMap?.uuid ?? ""}`,
    )
    .sort()
    .join("|");

  const wallMaterialsRef = useRef(
    new Map<string, { signature: string; material: THREE.MeshStandardMaterial }>(),
  );
  const [wallMaterials, setWallMaterials] = useState<
    Map<string, THREE.MeshStandardMaterial>
  >(new Map());

  useLayoutEffect(() => {
    const cache = wallMaterialsRef.current;
    let changed = false;

    for (const [key, spec] of wallSpecs) {
      const signature = `${spec.map.uuid},${spec.normalMap?.uuid ?? ""},${spec.roughnessMap?.uuid ?? ""}`;
      const existing = cache.get(key);
      if (existing && existing.signature === signature) continue;
      existing?.material.dispose();
      cache.set(key, {
        signature,
        material: new THREE.MeshStandardMaterial({
          map: spec.map,
          normalMap: spec.normalMap ?? undefined,
          roughnessMap: spec.roughnessMap ?? undefined,
          color: 0xffffff,
          roughness: spec.roughnessMap ? 1 : REFINED_SURFACE.wall.roughness,
          metalness: REFINED_SURFACE.wall.metalness,
          normalScale: new THREE.Vector2(NORMAL_SCALE.wall, NORMAL_SCALE.wall),
        }),
      });
      changed = true;
    }

    // 不再有人用的來源(牆被刪掉、覆寫被清掉)要釋放,否則整段造訪期間會
    // 一直累積。
    for (const key of [...cache.keys()]) {
      if (wallSpecs.has(key)) continue;
      cache.get(key)!.material.dispose();
      cache.delete(key);
      changed = true;
    }

    if (!changed) return;
    const snapshot = new Map(
      [...cache].map(([key, entry]) => [key, entry.material] as const),
    );
    // 與上面的烘焙同一個理由:effect 裡不同步 setState。
    queueMicrotask(() => {
      setWallMaterials(snapshot);
    });
    // wallSpecs 每次 render 都是新的 Map,所以依指紋而不是依物件。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallSpecsKey]);

  useEffect(() => {
    const cache = wallMaterialsRef.current;
    return () => {
      for (const entry of cache.values()) entry.material.dispose();
      cache.clear();
    };
  }, []);

  const defaultWallKey = resolveWallSource(selection, uploads, null).key;
  const defaultWallMaterial = wallMaterials.get(defaultWallKey) ?? null;

  /** 材質 uuid → 該材質的 albedo render target(探針用,見型別上的說明)。 */
  const wallAlbedoTargets = useMemo(() => {
    const map = new Map<string, THREE.WebGLRenderTarget>();
    for (const [key, material] of wallMaterials) {
      const target = wallSpecs.get(key)?.albedoTarget;
      if (target) map.set(material.uuid, target);
    }
    return map;
  }, [wallMaterials, wallSpecs]);

  // 地板烘好、而且**預設牆面的材質也已經建好**才算 ready。牆面材質晚一個
  // commit(上面那個 effect),只看地板的話會在牆還沒掛材質的那一幀就宣告
  // 完成,而測試正是靠這個旗標決定何時開始量。
  const ready = baseMaterials !== null && defaultWallMaterial !== null;

  useEffect(() => {
    onReady?.(ready);
  }, [ready, onReady]);

  const wallMaterialFor = useCallback(
    (wallId: string) => {
      const { key } = resolveWallSource(selection, uploads, wallId);
      return wallMaterials.get(key) ?? defaultWallMaterial;
    },
    [wallMaterials, defaultWallMaterial, selection, uploads],
  );

  const value = useMemo<SurfaceMaterialsValue>(
    () => ({
      floor: baseMaterials?.floor ?? null,
      wall: defaultWallMaterial,
      column: baseMaterials?.column ?? null,
      ready,
      textureSet,
      wallMaterialFor,
      wallAlbedoTargets,
    }),
    [
      baseMaterials,
      defaultWallMaterial,
      ready,
      textureSet,
      wallMaterialFor,
      wallAlbedoTargets,
    ],
  );

  return (
    <SurfaceMaterialsContext.Provider value={value}>{children}</SurfaceMaterialsContext.Provider>
  );
}
