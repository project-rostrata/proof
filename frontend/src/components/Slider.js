import van from "../../lib/van-1.6.1.js";

const { div, label, span, input } = van.tags;

// One tool parameter. The input element is never re-rendered while it's being dragged: the value
// lives in the caller's params object, and only the number label is reactive. Double-click resets
// it to the default (as in Lightroom).
export function Slider(spec, params, onChange) {
  const shown = van.state(params[spec.id]);
  const id = `slider-${spec.id}-${Math.random().toString(36).slice(2, 8)}`;
  const step = spec.step ?? 1;
  const decimals = step < 1 ? 1 : 0;
  const el = input({
    id, type: "range", min: spec.min, max: spec.max, step, value: params[spec.id],
    oninput: (e) => { params[spec.id] = Number(e.target.value); shown.val = params[spec.id]; onChange(); },
    ondblclick: (e) => { params[spec.id] = spec.default; e.target.value = spec.default; shown.val = spec.default; onChange(); },
  });
  return div(
    { class: "slider" },
    div({ class: "slider-head" },
      label({ for: id }, spec.label),
      span({ class: "slider-value" }, () => (shown.val > 0 && spec.min < 0 ? "+" : "") + shown.val.toFixed(decimals) + (spec.unit ?? ""))),
    el,
  );
}
