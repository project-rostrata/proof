import { whiteBalanceMatrix } from "../color.js";
import { shape, slider, allZero } from "./shared.js";

// Linear sRGB in, linear sRGB out: one 3x3 matrix (sRGB -> XYZ -> CAT16 LMS, von Kries gains,
// back), precomputed per parameter change in color.js.
const WHITE_BALANCE_GLSL = `
uniform sampler2D u_image;
uniform mat3 u_matrix;
void main() { outColor = vec4(texture(u_image, v_uv).rgb * u_matrix, 1.0); }`;

// Temperature ±100 shifts the assumed illuminant by up to ±80 mired along the daylight locus.
// Tint ±100 moves it up to ±0.02 duv across the locus (+ is magenta, as in Lightroom).
const whiteBalanceFor = (temperature, tint) => whiteBalanceMatrix(80 * shape(temperature), 0.02 * shape(tint));

export const whitebalance = {
  id: "whitebalance",
  label: "White Balance",
  params: [slider("temperature", "Temperature"), slider("tint", "Tint")],
  isIdentity: (p) => allZero(p, ["temperature", "tint"]),
  apply(ctx, input, p) {
    return ctx.pass(WHITE_BALANCE_GLSL, {
      inputs: { u_image: input },
      uniforms: { u_matrix: whiteBalanceFor(p.temperature, p.tint) },
      target: ctx.target(),
    });
  },
};
