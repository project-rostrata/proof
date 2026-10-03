import { rotationMapping } from "../geometry.js";
import { WARP } from "./geometry-shader.js";

// Rotate: a horizontal flip, quarter turns clockwise, and a fine straighten angle (positive is
// clockwise), applied in that order. A fine angle crops to the largest rectangle with the image's
// own aspect that fits, so there are never blank corners.
export const rotate = {
  id: "rotate",
  label: "Rotate",
  geometry: "grid", // the editor shows the live result with an alignment grid
  params: [
    { id: "quarterTurns", label: "Rotate", kind: "turns", default: 0 },
    { id: "flip", label: "Flip", kind: "toggle", default: false },
    { id: "angle", label: "Straighten", min: -45, max: 45, step: 0.1, unit: "°", default: 0 },
  ],
  isIdentity: (p) => p.quarterTurns === 0 && !p.flip && p.angle === 0,
  apply(ctx, input, p) {
    const m = rotationMapping(input.width, input.height, p);
    return ctx.pass(WARP, {
      inputs: { u_image: input },
      uniforms: { u_map: m.matrix, u_cubic: p.angle !== 0 ? 1 : 0 },
      target: ctx.target(m.width, m.height),
    });
  },
};
