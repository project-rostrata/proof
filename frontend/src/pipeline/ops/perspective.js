import { keystoneQuad, perspectiveMapping } from "../geometry.js";
import { WARP } from "./geometry-shader.js";
import { shape, slider } from "./shared.js";

// Perspective: vertical and horizontal keystone. The photo is re-projected so that a quad inside it
// fills the frame (the general four-corner homography, so a free-corner mode can be added later).
// The quad is always inside the photo, so the output is fully covered and needs no fill.
export const perspective = {
  id: "perspective",
  label: "Perspective",
  geometry: "grid",
  params: [slider("vertical", "Vertical"), slider("horizontal", "Horizontal")],
  isIdentity: (p) => p.vertical === 0 && p.horizontal === 0,
  apply(ctx, input, p) {
    const quad = keystoneQuad(input.width, input.height, shape(p.vertical), shape(p.horizontal));
    return ctx.pass(WARP, {
      inputs: { u_image: input },
      uniforms: { u_map: perspectiveMapping(input.width, input.height, quad), u_cubic: 1 },
      target: ctx.target(input.width, input.height),
    });
  },
};
