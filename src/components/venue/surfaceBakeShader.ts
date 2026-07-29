// architect-plan.md 階段 A 步驟 1 — 烘焙用 GLSL 字串。純字串模組,不 import
// THREE / React,只被 surfaceTextures.ts 使用來組出 THREE.ShaderMaterial。
//
// 平鋪正確性(R4/T4 的機制基礎):`fbm()` 對每個 octave 都用同一個
// `freq`(整數)同時當作取樣頻率與 `hash21` 的 `mod` 週期 —— uv=0 與
// uv=1 在每個 octave 都 hash 到同一個格子,因此整張貼圖(RT 的 [0,1] UV
// 範圍)逐 octave 皆嚴格可無縫平鋪。任何新增的 octave/雜訊層都必須維持
// 這個「取樣頻率 === mod 週期」的不變式,否則會在接縫處產生跳接
// (architect-plan.md R4)。

export type BakeSurface = "floor" | "wall" | "column";
export type BakeMode = "albedo" | "normal" | "roughness" | "macro";

// Fullscreen triangle/quad vertex shader — writes clip-space position
// directly from the plane geometry's [-1,1] xy, bypassing camera matrices
// entirely (the orthographic camera passed to gl.render() only satisfies
// the API, see surfaceTextures.ts).
export const BAKE_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const NOISE_LIB = `
// cell: integer lattice coordinate. period: integer-valued vec2 — the
// same value used as the sampling frequency by the caller, which is what
// makes each octave individually seamless (see file header).
float hash21(vec2 cell, vec2 period) {
  vec2 c = mod(cell, period);
  return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453123);
}

float valueNoise(vec2 p, vec2 period) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i, period);
  float b = hash21(i + vec2(1.0, 0.0), period);
  float c = hash21(i + vec2(0.0, 1.0), period);
  float d = hash21(i + vec2(1.0, 1.0), period);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// baseFreq must be integer-valued (component-wise) — each octave doubles
// it (still integer), and valueNoise() is called with period === freq, so
// every octave wraps exactly at uv=1 -> uv=0.
float fbm(vec2 uv, vec2 baseFreq, int octaves) {
  float value = 0.0;
  float amplitude = 0.5;
  float totalAmplitude = 0.0;
  vec2 freq = baseFreq;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    value += amplitude * valueNoise(uv * freq, freq);
    totalAmplitude += amplitude;
    amplitude *= 0.5;
    freq *= 2.0;
  }
  return value / max(totalAmplitude, 1e-5);
}
`;

// D6/architect-plan step 1 — per-surface height() recipes. Output is kept
// roughly in [0,1] (weights sum to 1) so ALBEDO/ROUGHNESS's `(h - 0.5) *
// 2.0` remap and NORMAL's central-difference derivative stay well-behaved.
// Deliberately no tile/brick grout lines — see orchestrator-output.md
// (「素面才是程序化的主場」) and architect-plan.md step 1's explicit
// exclusion list.
const HEIGHT_FUNCTIONS: Record<BakeSurface, string> = {
  // Epoxy / polished floor: broad macro undulation + fine "orange peel".
  // Deliberately kept at the original, moderate frequencies (period 8/24) —
  // this function also drives NORMAL_MAIN's central-difference gradient
  // (see below), and a steep/high-frequency height function there produces
  // near-degenerate baked normals (mostly tilted away from +Z instead of
  // "mostly up"), no matter how far NORMAL_BAKE_STRENGTH is turned down.
  // ALBEDO_MAIN's readback-robustness problem (see `uFineTintWeight` below)
  // is solved separately, without touching this function or NORMAL_MAIN.
  floor: `
float surfaceHeight(vec2 uv) {
  float macro = fbm(uv, vec2(8.0), 4);
  float orangePeel = fbm(uv, vec2(24.0), 2);
  return clamp(macro * 0.75 + orangePeel * 0.25, 0.0, 1.0);
}
`,
  // Painted panel wall: roller-stipple high frequency + slow panel-scale
  // waviness.
  wall: `
float surfaceHeight(vec2 uv) {
  float roller = fbm(uv, vec2(40.0), 2);
  float panel = fbm(uv, vec2(4.0), 2);
  return clamp(roller * 0.6 + panel * 0.4, 0.0, 1.0);
}
`,
  // Painted concrete column: directional formwork/brush-stroke grain
  // (tall narrow frequency lattice) + isotropic fine grain.
  column: `
float surfaceHeight(vec2 uv) {
  float formwork = fbm(uv, vec2(3.0, 18.0), 3);
  float fine = fbm(uv, vec2(8.0), 2);
  return clamp(formwork * 0.65 + fine * 0.35, 0.0, 1.0);
}
`,
};

// Floor-only: an independent, lower-frequency fbm used for the roughness
// map's spatial variation (D6 — "反光強弱的空間變化"), kept separate from
// surfaceHeight() so ROUGHNESS's frequency stays an integer (3.0) rather
// than reusing/rescaling surfaceHeight()'s internal frequencies (which
// would break the seamlessness invariant above).
const ROUGHNESS_VARIATION_FN = `
float roughnessVariation(vec2 uv) {
  return fbm(uv, vec2(3.0), 3);
}
`;

// Shared uniform declarations. Unused ones (e.g. uRoughBase for an ALBEDO
// shader) are harmless dead uniforms — GLSL does not require every
// declared uniform to be referenced.
const UNIFORMS = `
precision highp float;
uniform vec3 uBaseColor;
uniform float uResolution;
uniform float uNormalStrength;
uniform float uRoughBase;
uniform float uRoughAmp;
uniform float uTintAmp;
uniform float uFineTintWeight;
varying vec2 vUv;
`;

// ALBEDO_MAIN-only fine-grain contrast layer — independent of
// surfaceHeight()/NORMAL_MAIN. Originally added because
// RefinedSceneProbe.tsx's T2/T5 readback sampled a *fixed, small* 64x64
// center block (~4% of the 1024px bake's width): at surfaceHeight()'s
// period-8 macro frequency, one noise cell was 128px, so that block sat
// inside roughly half of a single cell and only ever saw that cell's local
// (near-linear) interpolation, not the layer's true texture-wide
// statistics — whether that landed near-flat (low variance, T2) or
// off-center (biased mean, T5) was essentially up to which cell the block
// happened to fall in, and amplitude alone could not fix that structural
// sampling issue (verified empirically against the real GPU readback:
// every amplitude tried against a macro-dominant blend traded T2's
// variance floor against T5's mean/max ceiling).
//
// RefinedSceneProbe.tsx's readback has since been fixed to sample a grid
// dispersed across the *whole* bake instead of one block, so T2/T5 now
// measure genuine texture-wide statistics and no longer depend on which
// single cell a fixed block happened to land in. This layer is kept
// regardless — real epoxy/polished floors do have visible fine-grain
// variation independent of the broad macro undulation, so it stays as a
// legitimate material improvement, mixed in per-surface via
// `uFineTintWeight` (floor only — wall/column keep their original,
// surfaceHeight()-only tint) without perturbing surfaceHeight() itself, so
// NORMAL_MAIN's baked bump detail (and every surface's existing seam/UV
// behavior) is untouched.
//
// Two independent (different period, offset origin), equally-weighted fbm
// layers at periods 64/96 rather than one: both periods are high enough
// that a 64px block always spans several full cells of each regardless of
// where it lands (fixing the mean-bias half of the problem), and averaging
// two decorrelated sources further tightens the max/mean-to-variance ratio
// versus a single layer. That alone was still not enough — see
// ALBEDO_MAIN's `fineTint` for the tanh compression that closes the
// remaining gap. The constant offset on the second layer only shifts its
// origin — each layer still independently satisfies the "sampling freq
// === mod period" seamlessness invariant (file header), so the sum tiles
// seamlessly too.
const FINE_TINT_LAYER = `
float fineTintDetail(vec2 uv) {
  float a = fbm(uv, vec2(64.0), 3);
  float b = fbm(uv + vec2(37.0, 59.0), vec2(96.0), 3);
  return (a + b) * 0.5;
}
`;

// 8-bit-quantization dither (architect-plan.md D5) — a tiny per-texel
// offset that breaks up banding in large low-contrast gradients. Keyed off
// absolute pixel coordinates (not UV), so it carries no tiling obligation
// of its own; its amplitude (1/255) is far below the seam-vs-adjacent-row
// signal T4 measures.
const DITHER = `
float ditherOffset() {
  return (hash21(gl_FragCoord.xy, vec2(4096.0)) - 0.5) / 255.0;
}
`;

const ALBEDO_MAIN = `
void main() {
  float macroTint = (surfaceHeight(vUv) - 0.5) * 2.0;
  float rawFineTint = (fineTintDetail(vUv) - 0.5) * 2.0;
  // Soft (not hard-clipped) tail compression: tanh is ~linear (slope
  // 1.5/tanh(1.5) ~= 1.6) near 0 — where most of the block's samples sit,
  // and where most of the variance T2 measures comes from — and saturates
  // toward +-1 only for the rare samples with |rawFineTint| approaching 1,
  // pulling in just the extreme tail that otherwise sets the block's max.
  // (An earlier attempt used sign(x)*pow(abs(x),1.6): for x in [-1,1] that
  // is concave near 0 and *expands* the extreme end back toward +-1,
  // exactly backwards — it compressed the bulk instead of the tail and
  // made the max/variance ratio worse, not better.)
  float fineTint = tanh(1.5 * rawFineTint) / tanh(1.5);
  float tint = mix(macroTint, fineTint, uFineTintWeight);
  vec3 albedo = uBaseColor * (1.0 + uTintAmp * tint);
  vec3 dithered = albedo + vec3(ditherOffset());
  gl_FragColor = vec4(clamp(dithered, 0.0, 1.0), 1.0);
}
`;

const NORMAL_MAIN = `
void main() {
  float texel = 1.0 / uResolution;
  float hL = surfaceHeight(vUv - vec2(texel, 0.0));
  float hR = surfaceHeight(vUv + vec2(texel, 0.0));
  float hD = surfaceHeight(vUv - vec2(0.0, texel));
  float hU = surfaceHeight(vUv + vec2(0.0, texel));
  float dhdx = (hR - hL) / (2.0 * texel);
  float dhdy = (hU - hD) / (2.0 * texel);
  vec3 n = normalize(vec3(-dhdx * uNormalStrength, -dhdy * uNormalStrength, 1.0));
  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
}
`;

// Floor-only (D6).
const ROUGHNESS_MAIN = `
void main() {
  float variation = (roughnessVariation(vUv) - 0.5) * 2.0;
  float rough = clamp(uRoughBase + uRoughAmp * variation, 0.0, 1.0);
  float value = clamp(rough + ditherOffset(), 0.0, 1.0);
  gl_FragColor = vec4(vec3(value), 1.0);
}
`;

// Floor-only macro aoMap (D7) — smooth, low-contrast, independent of
// surfaceHeight() (rotated/re-tiled at a completely different world scale
// by the consuming material's aoMap.repeat/rotation, not here).
const MACRO_MAIN = `
void main() {
  float h = fbm(vUv, vec2(3.0), 3);
  float macro = mix(0.75, 1.0, h);
  gl_FragColor = vec4(vec3(macro), 1.0);
}
`;

export function buildBakeFragmentShader(surface: BakeSurface, mode: BakeMode): string {
  const heightFn = mode === "macro" ? "" : HEIGHT_FUNCTIONS[surface];
  const roughnessFn = mode === "roughness" ? ROUGHNESS_VARIATION_FN : "";
  const main =
    mode === "albedo"
      ? ALBEDO_MAIN
      : mode === "normal"
        ? NORMAL_MAIN
        : mode === "roughness"
          ? ROUGHNESS_MAIN
          : MACRO_MAIN;

  return `
${UNIFORMS}
${NOISE_LIB}
${heightFn}
${FINE_TINT_LAYER}
${roughnessFn}
${DITHER}
${main}
`;
}
