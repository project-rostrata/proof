import van from "../../lib/van-1.6.1.js";
import { curveFunction } from "../pipeline/curve.js";

const { div, button } = van.tags;
const SVG = "http://www.w3.org/2000/svg";
const SIZE = 256;
const MIN_GAP = 0.02;
const CHANNELS = [["rgb", "RGB"], ["red", "Red"], ["green", "Green"], ["blue", "Blue"]];

function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// The curves panel: a master curve and red/green/blue curves, drawn through the same monotone
// interpolation the pipeline bakes into its LUT (pipeline/curve.js), so what's drawn is what's
// applied. Click empty space to add a point, drag to move, double-click a point to remove it.
// The SVG is updated in place while dragging. Re-creating it would drop the pointer capture.
// With `overlay`, it's laid over the photo (phones, as in Snapseed): channels on top, curve filling
// the rest.
export function CurveEditor(curves, onChange, { overlay = false } = {}) {
  const channel = van.state("rgb");
  const root = svg("svg", { viewBox: `0 0 ${SIZE} ${SIZE}`, class: "curve-svg", role: "img", "aria-label": "Tone curve" });
  for (let i = 1; i < 4; i++) {
    root.append(svg("line", { x1: (SIZE * i) / 4, y1: 0, x2: (SIZE * i) / 4, y2: SIZE, class: "curve-grid" }));
    root.append(svg("line", { x1: 0, y1: (SIZE * i) / 4, x2: SIZE, y2: (SIZE * i) / 4, class: "curve-grid" }));
  }
  root.append(svg("line", { x1: 0, y1: SIZE, x2: SIZE, y2: 0, class: "curve-diagonal" }));
  const path = svg("path", { class: "curve-path" });
  const handles = svg("g");
  root.append(path, handles);

  const toSvg = ([x, y]) => [x * SIZE, (1 - y) * SIZE];
  const fromEvent = (e) => {
    const r = root.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))];
  };

  function draw() {
    const points = curves[channel.val];
    const f = curveFunction(points);
    let d = "";
    for (let i = 0; i <= 128; i++) { const [x, y] = toSvg([i / 128, f(i / 128)]); d += `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`; }
    path.setAttribute("d", d);
    path.setAttribute("data-channel", channel.val);
    handles.replaceChildren(...points.map((p, i) => {
      const [x, y] = toSvg(p);
      return svg("circle", { cx: x, cy: y, r: 6, class: "curve-point", "data-index": i });
    }));
  }

  let dragging = -1;
  function move(index, [x, y]) {
    const points = curves[channel.val];
    const lo = index === 0 ? 0 : points[index - 1][0] + MIN_GAP;
    const hi = index === points.length - 1 ? 1 : points[index + 1][0] - MIN_GAP;
    points[index] = [Math.min(hi, Math.max(lo, x)), y];
  }

  root.addEventListener("pointerdown", (e) => {
    const points = curves[channel.val];
    const hit = e.target.closest?.(".curve-point");
    if (hit) {
      dragging = Number(hit.dataset.index);
    } else {
      const [x, y] = fromEvent(e);
      const after = points.findIndex((p) => p[0] > x);
      if (after <= 0 || points.length >= 16) return; // outside the end points, or full
      if (x - points[after - 1][0] < MIN_GAP || points[after][0] - x < MIN_GAP) return;
      points.splice(after, 0, [x, y]);
      dragging = after;
      onChange();
      draw();
    }
    root.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  root.addEventListener("pointermove", (e) => {
    if (dragging < 0) return;
    move(dragging, fromEvent(e));
    onChange();
    draw();
  });
  const stop = () => { dragging = -1; };
  root.addEventListener("pointerup", stop);
  root.addEventListener("pointercancel", stop);
  root.addEventListener("dblclick", (e) => {
    const hit = e.target.closest?.(".curve-point");
    const points = curves[channel.val];
    const index = hit ? Number(hit.dataset.index) : -1;
    if (index <= 0 || index >= points.length - 1) return; // the end points stay
    points.splice(index, 1);
    onChange();
    draw();
  });

  draw();
  return div(
    { class: overlay ? "curve-editor is-overlay" : "curve-editor" },
    div({ class: "curve-channels", role: "tablist" },
      ...CHANNELS.map(([id, text]) => button({
        class: () => `view-tab${channel.val === id ? " is-active" : ""}`, role: "tab",
        onclick: () => { channel.val = id; draw(); },
      }, text))),
    root,
    div({ class: "curve-footer" },
      button({ class: "btn-ghost btn-small", onclick: () => { curves[channel.val] = [[0, 0], [1, 1]]; onChange(); draw(); } }, "Reset channel")),
  );
}
