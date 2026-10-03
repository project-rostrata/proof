import { cropPixels } from "../geometry.js";
import { WARP } from "./geometry-shader.js";

// Crop: a rectangle normalised to the step's input ([x, y, w, h], 0..1), plus the aspect it's
// constrained to while editing (kept in the recipe, so reopening restores the constraint). The
// rectangle is rounded to whole pixels and copied: no resampling, so a crop is lossless.
export const ASPECT_OPTIONS = ["free", "original", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16"];

export const crop = {
  id: "crop",
  label: "Crop",
  geometry: "input", // the editor shows this step's input with a crop box while it's selected
  params: [
    { id: "rect", label: "Crop", kind: "rect", default: [0, 0, 1, 1] },
    { id: "aspect", label: "Aspect", kind: "choice", options: ASPECT_OPTIONS, default: "free" },
  ],
  isIdentity: (p) => p.rect[0] === 0 && p.rect[1] === 0 && p.rect[2] === 1 && p.rect[3] === 1,
  apply(ctx, input, p) {
    const r = cropPixels(p.rect, input.width, input.height);
    return ctx.pass(WARP, {
      inputs: { u_image: input },
      uniforms: { u_map: [1, 0, r.x, 0, 1, r.y, 0, 0, 1], u_cubic: 0 },
      target: ctx.target(r.width, r.height),
    });
  },
};
