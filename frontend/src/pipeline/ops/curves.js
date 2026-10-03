import { curveFunction, IDENTITY_CURVE, isIdentityCurve } from "../curve.js";

// Curves: a master curve plus per-channel curves, in perceptual (sRGB-encoded) space, the way
// curve editors are drawn and expected to behave. Interpolation is darktable's monotone Hermite
// (../curve.js). The four curves are baked into one 1024-entry half-float LUT, master then channel.
// Colour space: linear sRGB in and out, curved in sRGB encoding. Values above 1 are clamped,
// since a display curve has nothing beyond white.
const LUT_SIZE = 1024;
const CHANNELS = ["red", "green", "blue"];

const CURVES = `
uniform sampler2D u_image;
uniform sampler2D u_lut;
uniform float u_size;
float lutCoord(float x) { return (x * (u_size - 1.0) + 0.5) / u_size; }
void main() {
  vec3 v = srgbEncode(clamp(texture(u_image, v_uv).rgb, 0.0, 1.0));
  v = vec3(
    texture(u_lut, vec2(lutCoord(v.r), 0.5)).r,
    texture(u_lut, vec2(lutCoord(v.g), 0.5)).g,
    texture(u_lut, vec2(lutCoord(v.b), 0.5)).b);
  outColor = vec4(srgbDecode(v), 1.0);
}`;

export const DEFAULT_CURVES = { rgb: IDENTITY_CURVE, red: IDENTITY_CURVE, green: IDENTITY_CURVE, blue: IDENTITY_CURVE };

export function buildLut(points) {
  const master = curveFunction(points.rgb);
  const channel = CHANNELS.map((c) => curveFunction(points[c]));
  const data = new Float32Array(LUT_SIZE * 4);
  for (let i = 0; i < LUT_SIZE; i++) {
    const m = master(i / (LUT_SIZE - 1));
    for (let c = 0; c < 3; c++) data[i * 4 + c] = channel[c](m);
    data[i * 4 + 3] = 1;
  }
  return data;
}

export const curves = {
  id: "curves",
  label: "Curves",
  params: [{ id: "points", label: "Curves", kind: "curves", default: DEFAULT_CURVES }],
  isIdentity: (p) => ["rgb", ...CHANNELS].every((c) => isIdentityCurve(p.points[c])),
  apply(ctx, input, p) {
    const lut = ctx.lut(`curves:${JSON.stringify(p.points)}`, LUT_SIZE, () => buildLut(p.points));
    return ctx.pass(CURVES, { inputs: { u_image: input, u_lut: lut }, uniforms: { u_size: LUT_SIZE }, target: ctx.target() });
  },
};
