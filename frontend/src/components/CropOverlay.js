import van from "../../lib/van-1.6.1.js";

const { div } = van.tags;

// Which edges each handle moves.
const HANDLES = {
  nw: { l: 1, t: 1 }, n: { t: 1 }, ne: { r: 1, t: 1 }, e: { r: 1 },
  se: { r: 1, b: 1 }, s: { b: 1 }, sw: { l: 1, b: 1 }, w: { l: 1 },
};
const MIN = 0.02; // smallest crop, as a fraction of each side

// The crop box over the crop step's input. It edits `params.rect` ([x, y, w, h], normalised) in
// place. With a fixed aspect, only the corner handles show, and they keep the pixel aspect.
// `size()` returns the input's pixel size (needed to turn an aspect into normalised units).
export function CropOverlay(params, ratio, size, onChange) {
  const rect = van.state([...params.rect]);
  const set = (r) => { params.rect = r; rect.val = r; onChange(); };
  let drag = null;

  const root = div({ class: "crop-overlay" },
    () => {
      const [x, y, w, h] = rect.val;
      const pct = (v) => `${(v * 100).toFixed(3)}%`;
      const fixed = ratio() !== null;
      return div({ class: "crop-layer" },
        div({ class: "crop-shade", style: `left:0;top:0;width:100%;height:${pct(y)}` }),
        div({ class: "crop-shade", style: `left:0;top:${pct(y + h)};width:100%;bottom:0` }),
        div({ class: "crop-shade", style: `left:0;top:${pct(y)};width:${pct(x)};height:${pct(h)}` }),
        div({ class: "crop-shade", style: `left:${pct(x + w)};top:${pct(y)};right:0;height:${pct(h)}` }),
        div({ class: "crop-box", "data-handle": "move", style: `left:${pct(x)};top:${pct(y)};width:${pct(w)};height:${pct(h)}` },
          div({ class: "crop-thirds" }),
          ...Object.keys(HANDLES).filter((k) => !fixed || k.length === 2).map((k) => div({ class: `crop-handle crop-${k}`, "data-handle": k }))));
    });

  const point = (e) => {
    const r = root.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };

  // A drag the box takes is stopped here, so the photo gestures underneath (Editor) never see it.
  // Any other drag, including "moving" a box that already fills the photo, passes through to them.
  root.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest?.("[data-handle]")?.dataset.handle;
    if (!handle) return;
    const [, , w, h] = rect.val;
    if (handle === "move" && w >= 0.999 && h >= 0.999) return; // nowhere to move it
    drag = { handle, start: point(e), rect: [...rect.val] };
    root.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  });
  root.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const [px, py] = point(e);
    const [x0, y0, w0, h0] = drag.rect;
    if (drag.handle === "move") {
      const x = Math.min(1 - w0, Math.max(0, x0 + px - drag.start[0]));
      const y = Math.min(1 - h0, Math.max(0, y0 + py - drag.start[1]));
      set([x, y, w0, h0]);
      return;
    }
    const m = HANDLES[drag.handle];
    let left = m.l ? Math.min(Math.max(0, px), x0 + w0 - MIN) : x0;
    let right = m.r ? Math.max(Math.min(1, px), x0 + MIN) : x0 + w0;
    let top = m.t ? Math.min(Math.max(0, py), y0 + h0 - MIN) : y0;
    let bottom = m.b ? Math.max(Math.min(1, py), y0 + MIN) : y0 + h0;
    const r = ratio();
    if (r !== null) {
      // Keep the pixel aspect: the width drives the height, anchored at the opposite corner. If
      // that runs off the image, the height is clamped and drives the width instead.
      const [W, H] = size();
      const perW = W / (H * r); // normalised height per unit of normalised width
      let w = right - left;
      let h = w * perW;
      const room = m.t ? bottom : 1 - top;
      if (h > room) { h = room; w = h / perW; }
      if (m.l) left = right - w; else right = left + w;
      if (m.t) top = bottom - h; else bottom = top + h;
    }
    set([left, top, right - left, bottom - top]);
  });
  const stop = () => { drag = null; };
  root.addEventListener("pointerup", stop);
  root.addEventListener("pointercancel", stop);

  return { element: root, reset: (r) => { rect.val = [...r]; } };
}
