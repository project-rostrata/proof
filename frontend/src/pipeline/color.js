/*
*  proof — colour science shared by the pipeline's JavaScript and GLSL.
*
*  Contains code ported from darktable (https://github.com/darktable-org/darktable) at commit
*  3fc4cfb252231edc687fefc469b3f7b7e2cade0a, data/kernels/colorspace.h:
*    Copyright (C) 2009-2026 darktable developers.
*    darktable is free software: you can redistribute it and/or modify it under the terms of the
*    GNU General Public License as published by the Free Software Foundation, either version 3 of
*    the License, or (at your option) any later version.
*  The ported parts are the CIE 2006 LMS and Filmlight Yrg/Ych conversions and the Yrg gamut check
*  (colorbalancergb's colour model), and the CAT16 matrices. See frontend/src/pipeline/LICENSES.md.
*
*  Working space: proof's pipeline is linear sRGB (Rec.709 primaries, D65), because that's what an
*  sRGB JPEG decodes to. darktable's pipeline is linear Rec.2020, so its RGB-dependent constants
*  aren't copied. Everything here goes through CIE XYZ (D65), which is primaries-independent.
*/

// Row-major 3x3 matrices: out[i] = sum_j M[i][j] * in[j] (darktable's matrix_dot convention).
export const SRGB_TO_XYZ = [
  0.4124564, 0.3575761, 0.1804375,
  0.2126729, 0.7151522, 0.0721750,
  0.0193339, 0.1191920, 0.9503041,
];
export const XYZ_TO_SRGB = [
  3.2404542, -1.5371385, -0.4985314,
  -0.9692660, 1.8760108, 0.0415560,
  0.0556434, -0.2040259, 1.0572252,
];
// darktable colorspace.h: XYZ_to_LMS / LMS_to_XYZ (CIE 2006 LMS, D65).
const XYZ_TO_LMS2006 = [
  0.257085, 0.859943, -0.031061,
  -0.394427, 1.175800, 0.106423,
  0.064856, -0.076250, 0.559067,
];
const LMS2006_TO_XYZ = [
  1.80794659, -1.29971660, 0.34785879,
  0.61783960, 0.39595453, -0.04104687,
  -0.12546960, 0.20478038, 1.74274183,
];
// darktable colorspace.h: Filmlight grading RGB <-> LMS (Kirk 2019).
const GRADING_RGB_TO_LMS = [
  0.95, 0.38, 0.00,
  0.05, 0.62, 0.03,
  0.00, 0.00, 0.97,
];
const LMS_TO_GRADING_RGB = [
  1.0877193, -0.66666667, 0.02061856,
  -0.0877193, 1.66666667, -0.05154639,
  0.0, 0.0, 1.03092784,
];
// darktable colorspace.h: CAT16 chromatic adaptation.
const XYZ_TO_CAT16 = [
  0.401288, 0.650173, -0.051461,
  -0.250268, 1.204414, 0.045854,
  -0.002079, 0.048952, 0.953127,
];
const CAT16_TO_XYZ = [
  1.862068, -1.011255, 0.149187,
  0.38752, 0.621447, -0.008974,
  -0.015841, -0.034123, 1.049964,
];

export const D65_XY = [0.31271, 0.32902];

export function mul(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function matmul(a, b) {
  const out = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    out[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  }
  return out;
}

// GLSL's mat3 constructor is column-major. Passing a row-major matrix *as is* and multiplying
// `v * M` in GLSL gives the row-major product M·v. Every matrix uniform and constant follows that
// convention.
export function glslMat3(m) {
  return `mat3(${m.map((x) => x.toFixed(10)).join(", ")})`;
}

// darktable LMS_to_Yrg: luminance plus normalised Filmlight rg chromaticity.
function lmsToYrg(lms) {
  const Y = 0.68990272 * lms[0] + 0.34832189 * lms[1];
  const a = lms[0] + lms[1] + lms[2];
  const rgb = mul(LMS_TO_GRADING_RGB, a === 0 ? [0, 0, 0] : lms.map((x) => x / a));
  return [Y, rgb[0], rgb[1]];
}

// The rg chromaticity of sRGB white (1, 1, 1) in this pipeline. darktable subtracts its own D65
// white (0.21902143, 0.54371398, computed through its D50 pipeline); recomputing it for proof's
// matrices keeps neutral greys at exactly zero chroma.
const WHITE_YRG = lmsToYrg(mul(XYZ_TO_LMS2006, mul(SRGB_TO_XYZ, [1, 1, 1])));
export const WHITE_RG = [WHITE_YRG[1], WHITE_YRG[2]];

// Yrg luminance of sRGB white. The Kirk/CIE 2006 luminance puts it near 1.058, not 1, so tone
// curves that must keep white at white work on Y / WHITE_Y.
export const WHITE_Y = WHITE_YRG[0];

// ---- white balance --------------------------------------------------------------------------

// CIE daylight locus chromaticity for a correlated colour temperature (CIE 15, valid 4000-25000 K).
function daylightXy(T) {
  const t = Math.min(25000, Math.max(4000, T));
  const x = t <= 7000
    ? -4.6070e9 / t ** 3 + 2.9678e6 / t ** 2 + 0.09911e3 / t + 0.244063
    : -2.0064e9 / t ** 3 + 1.9018e6 / t ** 2 + 0.24748e3 / t + 0.237040;
  return [x, -3 * x * x + 2.870 * x - 0.275];
}

const xyToUv = ([x, y]) => { const d = -2 * x + 12 * y + 3; return [4 * x / d, 6 * y / d]; };
const uvToXy = ([u, v]) => { const d = 2 * u - 8 * v + 4; return [3 * u / d, 2 * v / d]; };

// A point on the daylight locus, offset perpendicular to it in CIE 1960 uv by `duv` (positive is
// towards green).
function illuminantXy(T, duv) {
  const uv = xyToUv(daylightXy(T));
  const ahead = xyToUv(daylightXy(T + 50));
  const behind = xyToUv(daylightXy(T - 50));
  const tangent = [ahead[0] - behind[0], ahead[1] - behind[1]];
  const length = Math.hypot(tangent[0], tangent[1]);
  // Rotate the tangent a quarter turn towards +v (green).
  let normal = [-tangent[1] / length, tangent[0] / length];
  if (normal[1] < 0) normal = [-normal[0], -normal[1]];
  return uvToXy([uv[0] + normal[0] * duv, uv[1] + normal[1] * duv]);
}

const xyToXYZ = ([x, y]) => [x / y, 1, (1 - x - y) / y];

// A linear-sRGB 3x3 matrix that adapts the photo as if it had been lit by an illuminant `mired`
// mireds away from D65 (positive is bluer) with a green/magenta offset `duv`, using CAT16 (von
// Kries scaling in CAT16 LMS, as darktable's color calibration does).
//
// Correcting for a bluer illuminant warms the photo, so positive warmth is a positive mired shift.
// The source chromaticity is taken relative to the locus at D65, so zero shift is exactly the
// identity.
export function whiteBalanceMatrix(mired, duv) {
  const t0 = 1e6 / 6504;
  const target = xyToXYZ(D65_XY);
  const shifted = illuminantXy(1e6 / Math.max(10, t0 - mired), duv);
  const base = illuminantXy(6504, 0);
  const source = xyToXYZ([D65_XY[0] + shifted[0] - base[0], D65_XY[1] + shifted[1] - base[1]]);
  const lmsSource = mul(XYZ_TO_CAT16, source);
  const lmsTarget = mul(XYZ_TO_CAT16, target);
  const gains = [lmsTarget[0] / lmsSource[0], 0, 0, 0, lmsTarget[1] / lmsSource[1], 0, 0, 0, lmsTarget[2] / lmsSource[2]];
  return matmul(XYZ_TO_SRGB, matmul(CAT16_TO_XYZ, matmul(gains, matmul(XYZ_TO_CAT16, SRGB_TO_XYZ))));
}

// ---- GLSL library --------------------------------------------------------------------------

// Prepended to every fragment shader. Values are linear sRGB unless a name says otherwise.
export const GLSL_LIBRARY = `
const mat3 SRGB_TO_XYZ = ${glslMat3(SRGB_TO_XYZ)};
const mat3 XYZ_TO_SRGB = ${glslMat3(XYZ_TO_SRGB)};
const mat3 XYZ_TO_LMS2006 = ${glslMat3(XYZ_TO_LMS2006)};
const mat3 LMS2006_TO_XYZ = ${glslMat3(LMS2006_TO_XYZ)};
const mat3 GRADING_RGB_TO_LMS = ${glslMat3(GRADING_RGB_TO_LMS)};
const mat3 LMS_TO_GRADING_RGB = ${glslMat3(LMS_TO_GRADING_RGB)};
const vec2 WHITE_RG = vec2(${WHITE_RG[0].toFixed(10)}, ${WHITE_RG[1].toFixed(10)});
const float WHITE_Y = ${WHITE_Y.toFixed(10)};
const vec3 LAB_WHITE = vec3(0.95047, 1.0, 1.08883);

float luminance(vec3 rgb) { return dot(rgb, vec3(0.2126729, 0.7151522, 0.0721750)); }

float srgbEncode(float c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1.0 / 2.4) - 0.055; }
float srgbDecode(float c) { return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); }
vec3 srgbEncode(vec3 c) { return vec3(srgbEncode(c.r), srgbEncode(c.g), srgbEncode(c.b)); }
vec3 srgbDecode(vec3 c) { return vec3(srgbDecode(c.r), srgbDecode(c.g), srgbDecode(c.b)); }

// ---- darktable colorspace.h: CIE 2006 LMS -> Filmlight Yrg -> polar Ych ----
vec3 rgbToYrg(vec3 rgb) {
  vec3 lms = (rgb * SRGB_TO_XYZ) * XYZ_TO_LMS2006;
  float Y = 0.68990272 * lms.x + 0.34832189 * lms.y;
  float a = lms.x + lms.y + lms.z;
  vec3 g = a == 0.0 ? vec3(0.0) : (lms / a) * LMS_TO_GRADING_RGB;
  return vec3(Y, g.x, g.y);
}
vec3 yrgToRgb(vec3 Yrg) {
  vec3 lms = vec3(Yrg.y, Yrg.z, 1.0 - Yrg.y - Yrg.z) * GRADING_RGB_TO_LMS;
  float denom = 0.68990272 * lms.x + 0.34832189 * lms.y;
  lms *= denom == 0.0 ? 0.0 : Yrg.x / denom;
  return (lms * LMS2006_TO_XYZ) * XYZ_TO_SRGB;
}
// Ych: x = luminance, y = chroma, zw = (cos, sin) of hue.
vec4 yrgToYch(vec3 Yrg) {
  vec2 rg = Yrg.yz - WHITE_RG;
  float c = length(rg);
  return vec4(Yrg.x, c, c != 0.0 ? rg / c : vec2(1.0, 0.0));
}
vec3 ychToYrg(vec4 Ych) { return vec3(Ych.x, Ych.y * Ych.zw + WHITE_RG); }
// darktable gamut_check_Yrg: largest chroma at this hue and luminance that keeps r, g, b >= 0.
vec4 gamutCheckYrg(vec4 Ych) {
  vec3 Yrg = ychToYrg(Ych);
  float maxC = Ych.y;
  if (Yrg.y < 0.0) maxC = min(-WHITE_RG.x / Ych.z, maxC);
  if (Yrg.z < 0.0) maxC = min(-WHITE_RG.y / Ych.w, maxC);
  if (Yrg.y + Yrg.z > 1.0) maxC = min((1.0 - WHITE_RG.x - WHITE_RG.y) / (Ych.z + Ych.w), maxC);
  Ych.y = max(maxC, 0.0);
  return Ych;
}

// ---- CIE L*a*b* (D65 white), L in 0..100. Used by darktable's shadhi and sharpen. ----
float labF(float t) { return t > 0.008856452 ? sign(t) * pow(abs(t), 1.0 / 3.0) : (903.2963 * t + 16.0) / 116.0; }
float labFInv(float f) { float f3 = f * f * f; return f3 > 0.008856452 ? f3 : (116.0 * f - 16.0) / 903.2963; }
vec3 rgbToLab(vec3 rgb) {
  vec3 xyz = (rgb * SRGB_TO_XYZ) / LAB_WHITE;
  vec3 f = vec3(labF(xyz.x), labF(xyz.y), labF(xyz.z));
  return vec3(116.0 * f.y - 16.0, 500.0 * (f.x - f.y), 200.0 * (f.y - f.z));
}
vec3 labToRgb(vec3 lab) {
  float fy = (lab.x + 16.0) / 116.0;
  vec3 xyz = vec3(labFInv(fy + lab.y / 500.0), labFInv(fy), labFInv(fy - lab.z / 200.0)) * LAB_WHITE;
  return xyz * XYZ_TO_SRGB;
}
`;
