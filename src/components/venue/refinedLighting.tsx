"use client";

// Step-03-only lighting/IBL/shadow-baking setup for RefinedScene.tsx.
// architect-plan.md D1/D2/D3/D4/D6/D7 — this file is imported ONLY by
// RefinedScene.tsx. Step 02 (VenueScene.tsx) must never import from here.

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import type { PlanBounds } from "@/lib/venue/bounds";

// --- D3: tone mapping / exposure --------------------------------------

export const REFINED_EXPOSURE = 1.1;
// Module-level singleton — must NOT be recreated as an inline object
// literal inside render (would make @react-three/fiber's `applyProps` on
// `gl` re-run every re-render).
export const REFINED_GL = {
  toneMapping: THREE.ACESFilmicToneMapping,
  toneMappingExposure: REFINED_EXPOSURE,
};

// --- D2: shadow camera / D5: bias -------------------------------------
//
// Shadow map mechanism: THREE.VSMShadowMap (see the useEffect below for
// why — PCFSoftShadowMap is deprecated in three r185 and silently coerced
// to PCFShadowMap at render time, three.module.js:9148-9153).
//
// VSM computes shadow visibility from a blurred mean/variance pair
// (three.module.js's VSM `getShadow()`) instead of a binary depth
// comparison, so its bias needs are different from PCF's:
//   - `bias` still shifts the compared depth the same way as PCF
//     (shadowCoord.z += shadowBias before the variance test) and mainly
//     guards against the same self-shadow acne.
//   - `normalBias` is bumped up from PCF's 0.03 to 0.06. VSM's blur pass
//     (see VSM_RADIUS/VSM_BLUR_SAMPLES below) spreads the penumbra across
//     neighbouring texels, which — verified empirically against this
//     scene's flush-against-wall furniture and the 2.0m bannerStand — was
//     enough to bleed light through the contact edge at normalBias=0.03
//     (the classic VSM light-bleeding artifact). 0.06 removed the bleed
//     at the flush-wall contact line without visibly detaching the
//     shadow from the object base (Peter-panning) on either test object.
export const SHADOW_MAP_SIZE = 2048;
export const SHADOW_BIAS = -0.0005;
export const SHADOW_NORMAL_BIAS = 0.06;
// VSM blur kernel — texel radius (`light.shadow.radius`) and sample count
// (`light.shadow.blurSamples`) used by the two-pass box blur in
// WebGLShadowMap's VSMPass (three.module.js:9406-9463). Kept modest
// (three's own defaults are radius=1/blurSamples=8): a larger radius
// softens edges further but widens the variance spread that drives light
// bleeding at contact points (see VSM `getShadow()`,
// three.module.js:477 `p_max` clamp) — radius=3/blurSamples=12 gave a
// visibly soft (non-aliased) edge on both test objects while keeping the
// flush-wall contact line bleed-free at normalBias=0.06.
export const VSM_RADIUS = 3;
export const VSM_BLUR_SAMPLES = 12;
export const SHADOW_MARGIN_M = 4;
// = WALL_HEIGHT_M (3) > tallest FURNITURE_DEFAULTS.height3d (bannerStand, 2.0).
export const MAX_OBJECT_HEIGHT_M = 3;

// --- D4: procedural IBL --------------------------------------------------

export const ENV_RESOLUTION = 128;
export const ENV_INTENSITY = 0.35;

// --- D1: hall light group --------------------------------------------

export const HEMI_SKY = "#e6ecf7";
export const HEMI_GROUND = "#8a837c";
export const HEMI_INTENSITY = 0.45;

export const KEY_COLOR = "#f4f7ff";
export const KEY_INTENSITY = 2.4;
export const KEY_DIR = new THREE.Vector3(-0.5, 1.0, 0.5).normalize();

export const FILL_COLOR = "#e8eefc";
export const FILL_INTENSITY = 0.8;
export const FILL_DIR = new THREE.Vector3(0.7, 0.6, -0.6).normalize();

export const RIM_COLOR = "#ffeedd";
export const RIM_INTENSITY = 0.5;
export const RIM_DIR = new THREE.Vector3(-0.8, 0.35, -0.8).normalize();

// --- D3: 03-only surface overrides ------------------------------------
//
// Only the floor color is overridden here — walls/columns/furniture keep
// their step-02 colors (shared with the 2D editor). Do NOT add more color
// overrides here without an objective reason (see architect-plan.md
// Architecture Notes: "顏色只改一處是刻意的").

export const REFINED_SURFACE = {
  floor: { color: "#e7e5e4", roughness: 0.55, metalness: 0 },
  wall: { roughness: 0.85, metalness: 0 },
  column: { roughness: 0.7, metalness: 0.05 },
  furniture: { roughness: 0.6, metalness: 0 },
};

function lightDistanceM(radiusM: number): number {
  return Math.max(radiusM * 2, 20);
}

interface HallLightingProps {
  bounds: PlanBounds;
  revision: number;
}

// Fixed 4-light group (1 hemisphere + 3 directional), only the key light
// casts shadows — architect-plan.md D1. Lights are declared as JSX (not
// `useMemo` + `<primitive>`) so R3F disposes them (and the key light's
// shadow map) automatically on unmount.
export function HallLighting({ bounds, revision }: HallLightingProps) {
  const gl = useThree((state) => state.gl);
  const keyRef = useRef<THREE.DirectionalLight>(null);
  // Shared aim target for all three directional lights. A THREE.Object3D
  // holds no GPU resources, so it needs no dispose() — it must simply be
  // mounted into the scene graph (via <primitive>), otherwise
  // LightShadow.updateMatrices() resolves target.matrixWorld as identity
  // (world origin) instead of the floor's actual center.
  const target = useMemo(() => new THREE.Object3D(), []);

  const distanceM = lightDistanceM(bounds.radiusM);
  const keyPosition: [number, number, number] = [
    bounds.centerX + KEY_DIR.x * distanceM,
    KEY_DIR.y * distanceM,
    bounds.centerY + KEY_DIR.z * distanceM,
  ];
  const fillPosition: [number, number, number] = [
    bounds.centerX + FILL_DIR.x * distanceM,
    FILL_DIR.y * distanceM,
    bounds.centerY + FILL_DIR.z * distanceM,
  ];
  const rimPosition: [number, number, number] = [
    bounds.centerX + RIM_DIR.x * distanceM,
    RIM_DIR.y * distanceM,
    bounds.centerY + RIM_DIR.z * distanceM,
  ];

  // D2: fit the key light's orthographic shadow frustum to the actual
  // scene content (not the 200m plannable upper bound), so a 10m default
  // floor doesn't get a shadow map blurred to ~10cm/texel.
  useLayoutEffect(() => {
    const light = keyRef.current;
    if (!light) return;
    const camera = light.shadow.camera;
    const radius = bounds.radiusM + SHADOW_MARGIN_M;
    const distance = lightDistanceM(bounds.radiusM);
    camera.left = -radius;
    camera.right = radius;
    camera.top = radius;
    camera.bottom = -radius;
    camera.near = Math.max(0.5, distance - radius - MAX_OBJECT_HEIGHT_M - 2);
    camera.far = distance + radius + 2;
    // three r185's LightShadow.updateMatrices() does not call
    // updateProjectionMatrix() itself (only WebGLShadowMap.render() does,
    // and only once at first configuration) — without this explicit call,
    // an AI resize_floor while sitting on step 03 leaves a stale frustum.
    camera.updateProjectionMatrix();
    light.target.updateMatrixWorld();
  }, [bounds]);

  // D6: shadows are only re-baked when the scene actually changes, not
  // every frame — 03 is a read-only, camera-orbit-only view, so a
  // direction light's shadow map is invariant under camera movement.
  useEffect(() => {
    // `gl` is imperative Three.js renderer state, not a React-owned value —
    // mutating its WebGLShadowMap flags here (inside an effect, never
    // during render) is the standard R3F pattern (mirrored by drei's own
    // <BakeShadows>). The project's react-hooks/immutability rule flags
    // the initial assignment (it can't see the mutation is safe); disabled
    // for that one line only.
    //
    // No explicit `gl.shadowMap.type` assignment here — the Canvas
    // `shadows="variance"` prop (RefinedScene.tsx) is sufficient and is
    // NOT subject to the ordering race the previous (incorrect) version of
    // this file assumed. Traced through @react-three/fiber's root
    // implementation (events-b389eeca.esm.js): `root.render()` calls
    // `configure()` — which applies the `shadows` prop to `gl.shadowMap`
    // (:15767-15784) — and only calls `reconciler.updateContainer()` (the
    // step that mounts children, e.g. this component) inside
    // `pending.then(...)` (:15816-15823), i.e. strictly after `configure()`
    // has finished. So by the time this effect (or RefinedSceneProbe's
    // frame-based read) ever runs, `gl.shadowMap.type` is already
    // `THREE.VSMShadowMap` — deterministically, not by timing luck.
    //
    // This also sidesteps the actual bug in the previous version: three
    // r185's `WebGLShadowMap.render()` unconditionally coerces
    // `PCFSoftShadowMap` -> `PCFShadowMap` and warns (deprecated,
    // three.module.js:9148-9153), so re-asserting `PCFSoftShadowMap` here
    // every mount produced a setting that read back as "soft" while the
    // renderer had already silently downgraded to hard-edged PCF for the
    // actual shadow pass. `VSMShadowMap` has no such coercion (verified:
    // no `VSMShadowMap` branch exists in that deprecation check), so this
    // failure mode does not apply to it.
    // eslint-disable-next-line react-hooks/immutability
    gl.shadowMap.autoUpdate = false;
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl]);

  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    gl.shadowMap.needsUpdate = true;
    // `revision` intentionally participates only as a dependency (its
    // value is never read) — RefinedScene bumps it whenever
    // polygon/walls/columns/furniture identity changes, which is the only
    // signal precise enough to catch a same-count-different-position edit
    // (e.g. an AI move_item call).
  }, [gl, bounds, revision]);

  return (
    <>
      <primitive object={target} position={[bounds.centerX, 0, bounds.centerY]} />
      <hemisphereLight args={[HEMI_SKY, HEMI_GROUND, HEMI_INTENSITY]} />
      <directionalLight
        ref={keyRef}
        color={KEY_COLOR}
        intensity={KEY_INTENSITY}
        position={keyPosition}
        target={target}
        castShadow
        shadow-mapSize-width={SHADOW_MAP_SIZE}
        shadow-mapSize-height={SHADOW_MAP_SIZE}
        shadow-bias={SHADOW_BIAS}
        shadow-normalBias={SHADOW_NORMAL_BIAS}
        shadow-radius={VSM_RADIUS}
        shadow-blurSamples={VSM_BLUR_SAMPLES}
      />
      <directionalLight
        color={FILL_COLOR}
        intensity={FILL_INTENSITY}
        position={fillPosition}
        target={target}
      />
      <directionalLight
        color={RIM_COLOR}
        intensity={RIM_INTENSITY}
        position={rimPosition}
        target={target}
      />
    </>
  );
}

// D4: zero-download procedural IBL. Coordinates below are in the
// EnvironmentPortal's own virtual scene (captured by an origin-centered
// cube camera) — they are NOT plan meters and must not be scaled by
// bounds.radiusM/fit; an environment map only records direction, so
// scaling it only risks pushing a Lightformer past the cube camera's far
// plane for no visual benefit.
export function HallEnvironment() {
  return (
    <Environment
      frames={1}
      resolution={ENV_RESOLUTION}
      background={false}
      environmentIntensity={ENV_INTENSITY}
    >
      <Lightformer
        form="rect"
        intensity={2}
        color="#ffffff"
        scale={[10, 1.2, 1]}
        position={[0, 6, -3]}
        rotation-x={Math.PI / 2}
      />
      <Lightformer
        form="rect"
        intensity={2}
        color="#ffffff"
        scale={[10, 1.2, 1]}
        position={[0, 6, 3]}
        rotation-x={Math.PI / 2}
      />
      <Lightformer
        form="rect"
        intensity={1}
        color="#dfe8ff"
        scale={[1, 4, 1]}
        position={[-8, 2, 0]}
        rotation-y={Math.PI / 2}
      />
      <Lightformer
        form="rect"
        intensity={1}
        color="#dfe8ff"
        scale={[1, 4, 1]}
        position={[8, 2, 0]}
        rotation-y={-Math.PI / 2}
      />
      <Lightformer
        form="rect"
        intensity={0.6}
        color="#f5e3cd"
        scale={[12, 12, 1]}
        position={[0, -4, 0]}
        rotation-x={-Math.PI / 2}
      />
    </Environment>
  );
}
