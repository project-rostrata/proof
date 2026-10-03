import van from "../../lib/van-1.6.1.js";

const { div, label, span, input } = van.tags;

// How a slider's value reads, in the panel and on the photo: "+25", "-3.5°".
export function formatValue(spec, value) {
  const decimals = (spec.step ?? 1) < 1 ? 1 : 0;
  return (value > 0 && spec.min < 0 ? "+" : "") + value.toFixed(decimals) + (spec.unit ?? "");
}

// One tool parameter. The value lives in the caller's params object, and `shown` mirrors it for the
// number label and the input, so something else (the editor's photo gestures) can move the slider
// too. The input is never re-created mid-drag, and setting its value to what it already holds
// doesn't disturb a drag. Double-click resets it to the default (as in Lightroom). With `active`,
// the slider is highlighted while it's the one the photo gestures move, and pressing or focusing
// it makes it that one.
export function Slider(spec, params, onChange, { shown = van.state(params[spec.id]), active = null } = {}) {
  const id = `slider-${spec.id}-${Math.random().toString(36).slice(2, 8)}`;
  const set = (value) => { params[spec.id] = value; shown.val = value; onChange(); };
  const activate = () => { if (active) active.val = spec.id; };
  const el = input({
    id, type: "range", min: spec.min, max: spec.max, step: spec.step ?? 1, value: () => shown.val,
    oninput: (e) => set(Number(e.target.value)),
    ondblclick: () => set(spec.default),
    onfocus: activate,
  });
  return div(
    { class: () => (active?.val === spec.id ? "slider is-active" : "slider"), onpointerdown: activate },
    div({ class: "slider-head" },
      label({ for: id }, spec.label),
      span({ class: "slider-value" }, () => formatValue(spec, shown.val))),
    el,
  );
}
