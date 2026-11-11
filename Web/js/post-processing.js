import * as THREE from 'three/webgpu';
import {
  Fn,
  uniform,
  float,
  vec2,
  vec3,
  vec4,
  dot,
  mix,
  min,
  max,
  pow,
  smoothstep,
  length,
  screenUV,
  screenSize,
  int
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { boxBlur } from 'three/addons/tsl/display/boxBlur.js';

// Scene-linear color grading and lens bloom, composed in the existing final render pass.

// Exposure and white balance belong to the camera, independently of the physical lighting presets.
// Keep exposure restrained for ACES; stronger bloom stays selective so midtones retain their contrast.
// Lamp: brighter than the original (the person found the game too dark), most of all after dark
const LOOKS = {
  golden:   { exposure: 1.42, contrast: 1.05, saturation: 1.08, balance: [1.045, 1.00, 0.955], bloom: 0.24, threshold: 1.30 },
  midday:   { exposure: 1.2, contrast: 1.06, saturation: 0.97, balance: [1.015, 1.00, 0.985], bloom: 0.18, threshold: 1.45 },
  twilight: { exposure: 1.85, contrast: 1.03, saturation: 1.08, balance: [1.025, 0.995, 1.015], bloom: 0.28, threshold: 1.20 },
  midnight: { exposure: 2.1, contrast: 1.02, saturation: 1.06, balance: [0.985, 1.00, 1.035], bloom: 0.30, threshold: 1.15 }
};

function createPostProcessing(renderer, sceneColor, reflections, options = {}) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Exposure is applied before bloom so its threshold follows the image's exposed brightness.
  // RenderPipeline performs ACES and the output color-space conversion exactly once, after this graph.
  renderer.toneMappingExposure = 1.0;

  const exposure = uniform(1.0);
  const contrast = uniform(1.0);
  const saturation = uniform(1.0);
  const balance = uniform(new THREE.Vector3(1, 1, 1));
  const lit = max(sceneColor.rgb.add(reflections.rgb), vec3(0)).mul(exposure).mul(balance);
  // Lamp: ambient occlusion (main.js, `options.ao`: GTAO at half size): its 5x5 noise averaged out over 5x5 of its
  // texels, then laid on at three quarters, less on what's brightly lit (the sun's light isn't the sky's, which is
  // what the occlusion takes away), before the glow so the glow follows it
  let exposed = lit;
  if (options.ao) {
    const occlusion = boxBlur(options.ao, { size: int(2) }).r;
    const litLuma = dot(lit, vec3(0.2126, 0.7152, 0.0722));
    exposed = lit.mul(mix(float(1), occlusion, float(0.75).mul(float(1).sub(smoothstep(0.5, 2.5, litLuma).mul(0.6)))));
  }

  // Limit only bloom's peak radiance, scaling RGB together to retain neon and lamp colors.
  // The original HDR image keeps its full range for the tone mapper's highlight shoulder.
  const peak = max(max(exposed.r, exposed.g), exposed.b);
  const bloomInput = vec4(exposed.mul(float(8.0).div(max(peak, 8.0))), 1.0);
  // Lamp: bloom can be left out to spare a weaker GPU
  const useBloom = options.bloom !== false;
  const bloomPass = useBloom ? bloom(bloomInput, 0.24, 0.40, 1.20) : null;
  if (bloomPass) {
    bloomPass.smoothWidth.value = 0.30;
    bloomPass.setResolutionScale(0.35);
  }

  const outputNode = Fn(() => {
    const color = (bloomPass ? exposed.add(bloomPass.rgb) : exposed).toVar();
    const luma = dot(color, vec3(0.2126, 0.7152, 0.0722)).toVar();

    // Gentle cool shadow / warm highlight separation; multiply rather than lifting the black level.
    const shadows = mix(vec3(0.985, 1.0, 1.015), vec3(1), smoothstep(0.02, 0.60, luma));
    const highlights = mix(vec3(1), vec3(1.035, 1.005, 0.965), smoothstep(0.60, 3.0, luma));
    color.mulAssign(shadows.mul(highlights));

    // Contrast pivots around middle gray and scales RGB together, avoiding per-channel gamma shifts.
    color.mulAssign(pow(max(luma, 0.0001).div(0.18), contrast.sub(1.0)));
    const gray = dot(color, vec3(0.2126, 0.7152, 0.0722));
    const chroma = max(max(color.r, color.g), color.b).sub(min(min(color.r, color.g), color.b));
    const vibrance = float(0.10).mul(float(1).sub(chroma.div(max(max(max(color.r, color.g), color.b), 0.0001))));
    color.assign(max(mix(vec3(gray), color, saturation.add(vibrance)), vec3(0)));

    // Normalize by the corner radius so the lens falloff remains subtle in portrait and landscape.
    const aspect = screenSize.x.div(screenSize.y);
    const radius = length(screenUV.sub(0.5).mul(vec2(aspect, 1))).div(length(vec2(aspect, 1).mul(0.5)));
    const vignette = float(1).sub(smoothstep(0.35, 1.0, radius).mul(0.12));
    return vec4(color.mul(vignette), 1.0);
  })();

  // (`blend`: [from, to, t], two looks mixed, so "Now" eases from one to the next as the sun moves rather than jumping)
  function applyPreset(id, blend = null) {
    const a = LOOKS[blend ? blend[0] : id] || LOOKS.golden, b = (blend && LOOKS[blend[1]]) || a, t = blend ? blend[2] : 0;
    const at = (x, y) => x + (y - x) * t;
    exposure.value = at(a.exposure, b.exposure);
    contrast.value = at(a.contrast, b.contrast);
    saturation.value = at(a.saturation, b.saturation);
    balance.value.set(...a.balance.map((v, i) => at(v, b.balance[i])));
    if (bloomPass) {
      bloomPass.strength.value = at(a.bloom, b.bloom);
      bloomPass.threshold.value = at(a.threshold, b.threshold);
    }
  }

  applyPreset('golden');
  return { outputNode, applyPreset, dispose() { bloomPass?.dispose(); } };
}

export { createPostProcessing };
