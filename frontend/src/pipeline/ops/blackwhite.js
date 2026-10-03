/*
*  proof — Black & White: a film's colour response, an optional lens colour filter, brightness,
*  contrast, and grain.
*
*  Contains code ported from darktable (https://github.com/darktable-org/darktable) at commit
*  3fc4cfb252231edc687fefc469b3f7b7e2cade0a:
*   - film responses: src/iop/channelmixerrgb.c's monochrome presets. darktable integrated the
*     manufacturers' spectral sensitivity curves against the CIE 1931 colour matching functions,
*     giving weights on CIE XYZ;
*   - colour filters: src/iop/monochrome.c (_color_filter): a Gaussian weight around the filter's
*     colour in Lab, applied to lightness after a blur so it follows areas, not pixel noise;
*   - grain: src/iop/grain.c: 3-octave simplex noise with darktable's grain power spectrum, applied
*     to lightness through its "paper response" curve, and averaged over the pixel's footprint when
*     the image is shown smaller than full size.
*    Copyright (C) 2009-2026 darktable developers.
*    darktable is free software: you can redistribute it and/or modify it under the terms of the
*    GNU General Public License as published by the Free Software Foundation, either version 3 of
*    the License, or (at your option) any later version.
*  The simplex noise is Stefan Gustavson's reference implementation as darktable carries it.
*  See frontend/src/pipeline/LICENSES.md.
*
*  proof's differences:
*   - the colour filter is normalised so neutral greys keep their tone (darktable's monochrome only
*     darkens), which behaves like a real filter with exposure compensation;
*   - darktable presets the film weights for D50, and they're used here on D65 XYZ;
*   - the blur of the filter mask is a Gaussian (darktable uses a bilateral with a range wide enough
*     to act like one), with a size relative to the image;
*   - grain is seeded the same for every photo (darktable seeds it from the filename), so a
*     recipe renders identically wherever it's opened.
*  Colour space: linear sRGB in, neutral linear sRGB out.
*/
import { shape } from "./shared.js";
import { TONE_FUNCTIONS, brightnessExponent, contrastExponent } from "./tune.js";

// darktable channelmixerrgb monochrome presets: weights on CIE XYZ.
const FILMS = {
  luminance: { label: "Neutral", weights: [0, 1, 0] },
  hp5: { label: "Ilford HP5+", weights: [0.25304098, 0.25958747, 0.48737156] },
  delta100: { label: "Ilford Delta 100", weights: [0.24552374, 0.25366007, 0.50081619] },
  delta400: { label: "Ilford Delta 400", weights: [0.24376712, 0.23613559, 0.52009729] },
  fp4: { label: "Ilford FP4+", weights: [0.24149085, 0.22149272, 0.53701643] },
  acros: { label: "Fuji Acros 100", weights: [0.333, 0.313, 0.353] },
};

// Lens filters as a colour in Lab (hue angle in degrees, chroma 80), as in darktable's monochrome
// colour picker. "none" skips the filter.
const FILTERS = {
  none: { label: "None" },
  red: { label: "Red", hue: 40 },
  orange: { label: "Orange", hue: 62 },
  yellow: { label: "Yellow", hue: 92 },
  green: { label: "Green", hue: 145 },
  blue: { label: "Blue", hue: 275 },
};
const FILTER_CHROMA = 80;
const FILTER_SIZE = 1.2; // darktable's "filter size"; its default 2.0 is very broad

// darktable monochrome _color_filter: exp(-clamp(|ab - filter|^2 / (2 * (size * 128)^2), 0, 1)).
// Stored normalised by the filter's response to grey, so neutral tones keep their lightness.
const FILTER_MASK = `
uniform sampler2D u_image;
uniform vec2 u_filter;
uniform float u_sigma2;
float response(vec2 ab) { return exp(-clamp(dot(ab - u_filter, ab - u_filter) / u_sigma2, 0.0, 1.0)); }
void main() {
  vec3 lab = rgbToLab(texture(u_image, v_uv).rgb);
  outColor = vec4(response(lab.yz) / response(vec2(0.0)), 0.0, 0.0, 1.0);
}`;

const BLACK_WHITE = TONE_FUNCTIONS + `
uniform sampler2D u_image;
uniform sampler2D u_filterMask;
uniform sampler2D u_perm;          // simplex noise permutation table, 256 entries
uniform sampler2D u_paper;         // darktable grain paper-response LUT, 128 x 128
uniform vec3 u_film;               // weights on XYZ
uniform float u_filterOn;
uniform float u_brightness;        // exponent; 1.0 = none
uniform float u_contrast;          // exponent; 1.0 = none
uniform float u_grain;             // darktable grain strength, 0..1
uniform float u_zoom;              // darktable grain coarseness
uniform vec2 u_size;               // image size in pixels
uniform float u_samples;           // grain samples per pixel (footprint averaging)

// ---- darktable grain.c: Gustavson simplex noise and its 3 octaves ----
int perm(int i) { return int(texelFetch(u_perm, ivec2(i & 255, 0), 0).r + 0.5); }
const vec3 GRAD3[12] = vec3[12](vec3(1,1,0), vec3(-1,1,0), vec3(1,-1,0), vec3(-1,-1,0), vec3(1,0,1), vec3(-1,0,1),
                                vec3(1,0,-1), vec3(-1,0,-1), vec3(0,1,1), vec3(0,-1,1), vec3(0,1,-1), vec3(0,-1,-1));
float corner(vec3 d, int gi) { float t = 0.6 - dot(d, d); if (t < 0.0) return 0.0; t *= t; return t * t * dot(GRAD3[gi], d); }
float simplex(vec3 v) {
  float s = (v.x + v.y + v.z) / 3.0;
  ivec3 ijk = ivec3(floor(v + s));
  float t = float(ijk.x + ijk.y + ijk.z) / 6.0;
  vec3 d0 = v - (vec3(ijk) - t);
  ivec3 o1, o2;
  if (d0.x >= d0.y) {
    if (d0.y >= d0.z) { o1 = ivec3(1,0,0); o2 = ivec3(1,1,0); }
    else if (d0.x >= d0.z) { o1 = ivec3(1,0,0); o2 = ivec3(1,0,1); }
    else { o1 = ivec3(0,0,1); o2 = ivec3(1,0,1); }
  } else {
    if (d0.y < d0.z) { o1 = ivec3(0,0,1); o2 = ivec3(0,1,1); }
    else if (d0.x < d0.z) { o1 = ivec3(0,1,0); o2 = ivec3(0,1,1); }
    else { o1 = ivec3(0,1,0); o2 = ivec3(1,1,0); }
  }
  vec3 d1 = d0 - vec3(o1) + 1.0 / 6.0;
  vec3 d2 = d0 - vec3(o2) + 2.0 / 6.0;
  vec3 d3 = d0 - 1.0 + 0.5;
  int ii = ijk.x & 255, jj = ijk.y & 255, kk = ijk.z & 255;
  int g0 = perm(ii + perm(jj + perm(kk))) % 12;
  int g1 = perm(ii + o1.x + perm(jj + o1.y + perm(kk + o1.z))) % 12;
  int g2 = perm(ii + o2.x + perm(jj + o2.y + perm(kk + o2.z))) % 12;
  int g3 = perm(ii + 1 + perm(jj + 1 + perm(kk + 1))) % 12;
  return 32.0 * (corner(d0, g0) + corner(d1, g1) + corner(d2, g2) + corner(d3, g3));
}
// darktable _simplex_2d_noise: octaves tuned to the power spectrum of real grain scans.
float grainNoise(vec2 p) {
  return simplex(vec3(p * 0.4910 / u_zoom, 0.0)) * 0.2340
       + simplex(vec3(p * 0.9441 / u_zoom, 1.0)) * 0.7850
       + simplex(vec3(p * 1.7280 / u_zoom, 2.0)) * 1.2150;
}
// darktable dt_lut_lookup_2d_1c on the 128 x 128 paper-response table.
float paper(float x, float y) {
  vec2 at = vec2(clamp((x + 0.5) * 127.0, 0.0, 127.0), clamp(y * 127.0, 0.0, 127.0));
  return texture(u_paper, (at + 0.5) / 128.0).r;
}

void main() {
  vec3 rgb = texture(u_image, v_uv).rgb;
  vec3 xyz = rgb * SRGB_TO_XYZ;
  float Y = max(dot(u_film, xyz) / dot(u_film, LAB_WHITE), 0.0); // the film's response, white = 1
  float L = rgbToLab(vec3(Y)).x;
  if (u_filterOn > 0.5) L *= texture(u_filterMask, v_uv).r;      // darktable monochrome: L * filter
  Y = labToRgb(vec3(L, 0.0, 0.0)).g / 1.0;
  if (u_brightness != 1.0) Y = brightnessCurve(Y, u_brightness);
  if (u_contrast != 1.0) Y = contrastCurve(Y, u_contrast);
  if (u_grain > 0.0) {
    // Resolution-independent coordinates: pixels normalised to the shorter side, as darktable does.
    float shortSide = min(u_size.x, u_size.y);
    vec2 p = gl_FragCoord.xy / shortSide;
    float noise = 0.0;
    // Footprint averaging (darktable's rank-1 lattice when zoomed out), with fewer samples.
    for (int k = 0; k < 8; k++) {
      if (float(k) >= u_samples) break;
      vec2 jitter = vec2(fract(float(k) * 0.618034), fract(float(k) * 0.381966 + 0.5)) - 0.5;
      noise += grainNoise(p + jitter / shortSide);
    }
    noise /= u_samples;
    float l = rgbToLab(vec3(Y)).x;
    l += paper(noise * u_grain * 0.15, l / 100.0);                   // GRAIN_LIGHTNESS_STRENGTH_SCALE
    Y = labToRgb(vec3(l, 0.0, 0.0)).g;
  }
  outColor = vec4(vec3(Y), 1.0);
}`;

// darktable grain.c: the permutation table of its simplex noise.
const PERMUTATION = [151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30,
  69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62,
  94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136,
  171, 168, 68, 175, 74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122,
  60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161,
  1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86,
  164, 100, 109, 198, 173, 186, 3, 64, 52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126,
  255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213,
  119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253,
  19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193,
  238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31,
  181, 199, 106, 157, 184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93,
  222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180];

// darktable grain.c paper_resp / paper_resp_inverse / evaluate_grain_lut, mid-tones bias 100 %.
const LUT_SIZE = 128;
function paperLut() {
  const delta = 2.0 * Math.exp(1.0 * Math.log(0.0001));
  const resp = (exposure) => (1 + 2 * delta) / (1 + Math.exp((4 * (0.5 - exposure)) / (1 + 2 * delta))) - delta;
  const inverse = (density) => -Math.log((1 + 2 * delta) / (density + delta) - 1) * (1 + 2 * delta) / 4 + 0.5;
  const data = new Float32Array(LUT_SIZE * LUT_SIZE * 4);
  for (let j = 0; j < LUT_SIZE; j++) for (let i = 0; i < LUT_SIZE; i++) {
    const gu = i / (LUT_SIZE - 1) - 0.5;
    const l = j / (LUT_SIZE - 1);
    data[(j * LUT_SIZE + i) * 4] = 100 * (resp(gu + inverse(l)) - l);
  }
  return data;
}

// darktable's default coarseness, 1600 (ISO-like): zoom = (1 + 8 * scale / 100) / 800, with
// scale = 1600 / 213.2.
const GRAIN_ZOOM = (1 + (8 * (1600 / 213.2)) / 100) / 800;

export const blackwhite = {
  id: "blackwhite",
  label: "Black & White",
  params: [
    { id: "film", label: "Film", kind: "choice", options: Object.keys(FILMS), labels: Object.fromEntries(Object.entries(FILMS).map(([k, v]) => [k, v.label])), default: "luminance" },
    { id: "filter", label: "Colour filter", kind: "choice", options: Object.keys(FILTERS), labels: Object.fromEntries(Object.entries(FILTERS).map(([k, v]) => [k, v.label])), default: "none" },
    { id: "brightness", label: "Brightness", min: -100, max: 100, default: 0 },
    { id: "contrast", label: "Contrast", min: -100, max: 100, default: 0 },
    { id: "grain", label: "Grain", min: 0, max: 100, default: 0 },
  ],
  // Turning a photo black and white is the point of the tool, so it's never an identity.
  identityAtDefaults: false,
  isIdentity: () => false,

  apply(ctx, input, p) {
    let mask = null;
    const filter = FILTERS[p.filter];
    if (filter.hue !== undefined) {
      const h = (filter.hue * Math.PI) / 180;
      const raw = ctx.pass(FILTER_MASK, {
        inputs: { u_image: input },
        uniforms: { u_filter: [FILTER_CHROMA * Math.cos(h), FILTER_CHROMA * Math.sin(h)], u_sigma2: 2 * (FILTER_SIZE * 128) ** 2 },
        target: ctx.target(),
      });
      // darktable blurs the filter's contribution (bilateral, sigma 20 px at full size): here 0.5 %
      // of the long edge, at reduced resolution.
      const sigma = 0.005 * ctx.longEdge;
      const factor = 2 ** Math.max(0, Math.floor(Math.log2(sigma / 2)));
      const small = ctx.downsample(raw, factor);
      mask = ctx.gaussian(small, Math.max(0.5, sigma * (small.width / ctx.width)));
      ctx.release(raw, small);
    }
    // Footprint averaging: when the finest grain octave spans fewer than ~4 pixels (a downscaled
    // preview), average 4 samples across the pixel, as darktable does when zoomed out.
    const finestCell = (GRAIN_ZOOM / 1.728) * Math.min(ctx.width, ctx.height);
    const out = ctx.pass(BLACK_WHITE, {
      inputs: {
        u_image: input,
        u_filterMask: mask ?? input,
        u_perm: ctx.lut("grain-permutation", 256, () => Float32Array.from(PERMUTATION.flatMap((v) => [v, 0, 0, 1]))),
        u_paper: ctx.lut("grain-paper", LUT_SIZE, paperLut, LUT_SIZE),
      },
      uniforms: {
        u_film: FILMS[p.film].weights,
        u_filterOn: mask ? 1 : 0,
        u_brightness: brightnessExponent(p.brightness),
        u_contrast: contrastExponent(p.contrast),
        u_grain: Math.max(0, shape(p.grain)),
        u_zoom: GRAIN_ZOOM,
        u_size: [ctx.width, ctx.height],
        u_samples: finestCell < 4 ? 4 : 1,
      },
      target: ctx.target(),
    });
    ctx.release(mask);
    return out;
  },
};
