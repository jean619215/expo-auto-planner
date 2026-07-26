"use client";

// architect-plan.md D8 — a scene-internal probe that reads the *actual*
// renderer/scene state (not source-literal values) so Playwright can assert
// shadows are genuinely running. In particular, `shadowMapAllocatedWidth`
// reads `keyLight.shadow.map?.width`, a WebGLRenderTarget that only
// `WebGLShadowMap.render()` ever allocates — its presence at the expected
// size is the strongest available proof, short of pixel inspection, that
// the shadow pass actually executed for that light.

import { useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

// The floor mesh tags itself with this name (RefinedScene.tsx) so the probe
// can report the floor's *actual* castShadow/receiveShadow flags instead of
// a source-code literal — see architect-plan.md D5 (floor receives but must
// never cast, it is the only DoubleSide surface and thus the sole real acne
// source).
export const REFINED_FLOOR_NAME = "refined-floor";

// Diagnostics are only collected for this many frames after mount / after a
// `resetKey` change. Long enough for the shadow pass, the environment cube
// render and gl.info.memory to settle (~2s at 60fps), short enough that the
// probe does not traverse the scene + JSON.stringify on every frame forever
// while the user orbits — 03 is judged on staying smooth with dozens of
// furniture items.
const PROBE_ACTIVE_FRAMES = 120;

export interface RefinedDiagnostics {
  lightCount: number;
  shadowCastingLightCount: number;
  shadowCasterMeshCount: number;
  floorReceivesShadow: boolean;
  floorCastsShadow: boolean;
  shadowsEnabled: boolean;
  shadowMapType: "Basic" | "PCF" | "PCFSoft" | "VSM" | "unknown";
  shadowMapSize: number | null;
  shadowMapAllocatedWidth: number | null;
  shadowCameraSpanM: number | null;
  shadowCameraNearM: number | null;
  shadowCameraFarM: number | null;
  toneMapping:
    | "None"
    | "Linear"
    | "Reinhard"
    | "Cineon"
    | "ACESFilmic"
    | "AgX"
    | "Neutral"
    | "unknown";
  toneMappingExposure: string;
  outputColorSpace: string;
  environmentSet: boolean;
  rendererTextures: number;
  rendererGeometries: number;
}

const TONE_MAPPING_LABELS: Record<number, RefinedDiagnostics["toneMapping"]> = {
  [THREE.NoToneMapping]: "None",
  [THREE.LinearToneMapping]: "Linear",
  [THREE.ReinhardToneMapping]: "Reinhard",
  [THREE.CineonToneMapping]: "Cineon",
  [THREE.ACESFilmicToneMapping]: "ACESFilmic",
  [THREE.AgXToneMapping]: "AgX",
  [THREE.NeutralToneMapping]: "Neutral",
};

const SHADOW_MAP_TYPE_LABELS: Record<number, RefinedDiagnostics["shadowMapType"]> = {
  [THREE.BasicShadowMap]: "Basic",
  [THREE.PCFShadowMap]: "PCF",
  [THREE.PCFSoftShadowMap]: "PCFSoft",
  [THREE.VSMShadowMap]: "VSM",
};

// `gl.shadowMap.type` is a *setting*, not proof of what the shadow pass
// actually rendered with — three r185's WebGLShadowMap.render() silently
// coerces the (now-deprecated) PCFSoftShadowMap to PCFShadowMap the first
// time it runs (three.module.js:9148-9153), so reading the setting alone
// can report a mechanism the renderer already abandoned. Once a light's
// shadow map has actually been allocated, its GPU resource shape is real,
// render-time evidence instead: VSM allocates its `shadow.map` render
// target itself with `{ format: RGFormat, type: HalfFloatType }`
// (three.module.js:9243-9247), whereas PCF/Basic leave `shadow.map`'s own
// texture at the WebGLRenderTarget default and instead attach a
// `depthTexture` with `compareFunction` set only for PCF
// (three.module.js:9301-9319). Preferring this over the raw setting is
// what makes this diagnostic tell the truth even if a future regression
// reintroduces a deprecated/coerced type.
function resolveShadowMapType(
  gl: THREE.WebGLRenderer,
  key: THREE.DirectionalLight | null,
): RefinedDiagnostics["shadowMapType"] {
  const map = key?.shadow.map ?? null;
  if (map) {
    if (map.texture.type === THREE.HalfFloatType && map.texture.format === THREE.RGFormat) {
      return "VSM";
    }
    if (map.depthTexture?.compareFunction != null) {
      return "PCF";
    }
    return "Basic";
  }
  // No shadow pass has allocated a map yet (only possible on the very
  // first probed frames) — fall back to the setting.
  return SHADOW_MAP_TYPE_LABELS[gl.shadowMap.type] ?? "unknown";
}

interface RefinedSceneProbeProps {
  resetKey: number;
  onReport: (diagnostics: RefinedDiagnostics) => void;
}

export default function RefinedSceneProbe({ resetKey, onReport }: RefinedSceneProbeProps) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const frameRef = useRef(0);
  const lastReportRef = useRef<string | null>(null);

  // `resetKey` changes whenever RefinedScene's geometry props change
  // identity (a new revision) — re-arm the frame counter so the probe
  // waits for a fresh shadow pass before reporting again.
  useLayoutEffect(() => {
    frameRef.current = 0;
  }, [resetKey]);

  useFrame(() => {
    frameRef.current += 1;
    // Wait until at least the second frame so the shadow pass (which runs
    // once autoUpdate/needsUpdate settle after mount/revision change) has
    // had a chance to allocate `shadow.map`.
    if (frameRef.current < 2) return;
    if (frameRef.current > PROBE_ACTIVE_FRAMES) return;

    let lightCount = 0;
    let shadowCastingLightCount = 0;
    let shadowCasterMeshCount = 0;
    // Held on an object rather than in `let` bindings: TypeScript's control
    // flow analysis cannot see assignments made inside the traverse callback
    // and would otherwise narrow the locals to `null` (then to `never` at every
    // use site), forcing a cast on each read.
    const found: { key: THREE.DirectionalLight | null; floor: THREE.Mesh | null } = {
      key: null,
      floor: null,
    };

    scene.traverse((object) => {
      if ((object as THREE.Light).isLight) {
        lightCount += 1;
        if (object.castShadow) {
          shadowCastingLightCount += 1;
          if (!found.key && (object as THREE.DirectionalLight).isDirectionalLight) {
            found.key = object as THREE.DirectionalLight;
          }
        }
      }
      if ((object as THREE.Mesh).isMesh) {
        if (object.castShadow) {
          shadowCasterMeshCount += 1;
        }
        if (!found.floor && object.name === REFINED_FLOOR_NAME) {
          found.floor = object as THREE.Mesh;
        }
      }
    });

    const key = found.key;
    const floor = found.floor;
    const shadowCamera = key ? key.shadow.camera : null;

    const diagnostics: RefinedDiagnostics = {
      lightCount,
      shadowCastingLightCount,
      shadowCasterMeshCount,
      floorReceivesShadow: floor ? floor.receiveShadow : false,
      floorCastsShadow: floor ? floor.castShadow : false,
      shadowsEnabled: gl.shadowMap.enabled,
      shadowMapType: resolveShadowMapType(gl, key),
      shadowMapSize: key ? key.shadow.mapSize.width : null,
      // `shadow.map` is a WebGLRenderTarget that only WebGLShadowMap.render()
      // ever allocates (three r185, WebGLShadowMap.js:227) — unlike
      // `mapSize.width`, which is a mere setting, a non-null width here proves
      // the shadow pass actually ran for this light.
      shadowMapAllocatedWidth: key ? (key.shadow.map?.width ?? null) : null,
      shadowCameraSpanM: shadowCamera
        ? Math.round(shadowCamera.right - shadowCamera.left)
        : null,
      shadowCameraNearM: shadowCamera ? Math.round(shadowCamera.near) : null,
      shadowCameraFarM: shadowCamera ? Math.round(shadowCamera.far) : null,
      toneMapping: TONE_MAPPING_LABELS[gl.toneMapping] ?? "unknown",
      toneMappingExposure: gl.toneMappingExposure.toFixed(2),
      outputColorSpace: gl.outputColorSpace,
      environmentSet: scene.environment !== null,
      rendererTextures: gl.info.memory.textures,
      rendererGeometries: gl.info.memory.geometries,
    };

    const serialized = JSON.stringify(diagnostics);
    if (serialized !== lastReportRef.current) {
      lastReportRef.current = serialized;
      onReport(diagnostics);
    }
  });

  return null;
}
