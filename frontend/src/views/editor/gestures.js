import van from "../../../lib/van-1.6.1.js";
import { formatValue } from "../../components/Slider.js";
import { emptyNode } from "../../vanHelpers.js";

const { div, span } = van.tags;

// Adjusting on the photo, as in Snapseed: with a tool open, the photo is the control.
//   - Dragging sideways, or scrolling, changes the active slider. As in Snapseed, a drag across
//     half the photo's width takes a slider from its default to its furthest end (0 to ±100, or
//     Straighten's 0 to ±45°), so one thumb stroke reaches any value. A mouse-wheel notch is a
//     fortieth of the range (scrolling up raises it).
//   - Dragging up or down picks the active control. As in Snapseed, a highlight band stays fixed
//     at the centre of the photo and the whole list slides through it with the finger, pixel for
//     pixel (a row is PICK_STEP_PX tall, the same as the drag per control). Whichever control is in
//     the band is the active one. For Crop & Rotate the list includes the crop box.
//   - While the crop box is active, the drags it uses are its own: CropOverlay stops them, so they
//     never reach here. Everything else, even over the box, is still a gesture.
// A drag decides its direction after 8 px and is measured from there, so the value never jumps.
// Works with a mouse, a trackpad, or one finger; pinch-zoom and ctrl+wheel stay the browser's.
//
// `tool()` is the open tool (tool.js), or null when there's none or the original is being compared.
// It must read van states, so the readout and the stage's class follow it.
const PICK_STEP_PX = 40; // also the row height of the list (.adjust-item in style.css)

export function photoGestures(stageEl, { tool, onChange }) {
  const picking = van.state(false); // the list shows while dragging up or down
  const pickPos = van.state(0); //      where the list is, in rows: the band shows this row (fractional while dragging)

  van.derive(() => {
    const t = tool();
    stageEl.classList.toggle("is-adjustable", !!t?.picks.length);
    stageEl.classList.toggle("is-sliding", !!t?.activeSlider());
  });

  let wheel = { spec: null, rest: 0 }; // scrolling not yet worth a whole step
  stageEl.addEventListener("wheel", (e) => {
    const t = tool();
    const spec = t?.activeSlider();
    if (!spec || e.ctrlKey) return; // ctrl+wheel is a trackpad pinch
    e.preventDefault();
    if (wheel.spec !== spec) wheel = { spec, rest: 0 };
    const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? stageEl.clientHeight : 1);
    wheel.rest += (-px * (spec.max - spec.min)) / 4000;
    const step = spec.step ?? 1;
    const whole = Math.trunc(wheel.rest / step) * step;
    if (!whole) return;
    wheel.rest -= whole;
    if (t.setValue(spec, t.entry.params[spec.id] + whole)) onChange();
  });

  let drag = null;
  stageEl.addEventListener("pointerdown", (e) => {
    const t = tool();
    if (drag || e.button !== 0 || !t?.picks.length) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, axis: null };
  });
  stageEl.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const t = tool();
    if (!t) return;
    if (!drag.axis) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return; // not a drag yet
      const axis = Math.abs(e.clientX - drag.x) > Math.abs(e.clientY - drag.y) ? "x" : "y";
      const spec = t.activeSlider();
      if (axis === "x" && !spec) { drag.axis = "none"; return; } // sideways on the crop box: nothing to change
      drag = { ...drag, axis, x: e.clientX, y: e.clientY, value: spec && t.entry.params[spec.id], index: t.picks.findIndex((p) => p.id === t.active.val) };
      stageEl.setPointerCapture(e.pointerId);
      picking.val = axis === "y";
      pickPos.val = drag.index;
    } else if (drag.axis === "x") {
      const spec = t.activeSlider();
      if (spec && t.setValue(spec, drag.value + (e.clientX - drag.x) * unitsPerPixel(spec))) onChange();
    } else if (drag.axis === "y") {
      const pos = Math.max(0, Math.min(t.picks.length - 1, drag.index - (e.clientY - drag.y) / PICK_STEP_PX));
      pickPos.val = pos;
      t.active.val = t.picks[Math.round(pos)].id;
    }
  });
  // Half the stage's width covers the distance from the default to the further end.
  const unitsPerPixel = (spec) => Math.max(spec.max - spec.default, spec.default - spec.min) / (stageEl.clientWidth / 2);

  const endDrag = (e) => { if (drag?.id === e.pointerId) { drag = null; picking.val = false; } };
  stageEl.addEventListener("pointerup", endDrag);
  stageEl.addEventListener("pointercancel", endDrag);

  // The readout on the photo: the active control and its value, or the whole list while picking.
  // It sits over the photo, so it's neutral: no accent colour on what's being judged.
  const Readout = () => () => {
    const t = tool();
    if (!t?.picks.length) return emptyNode();
    const value = (pick) => (pick.spec ? span({ class: "adjust-value" }, () => formatValue(pick.spec, t.shown.get(pick.id).val)) : "");
    if (picking.val) {
      return div({ class: "adjust-picker" },
        div({ class: "adjust-band" }),
        div({ class: "adjust-list", style: () => `transform: translateY(${-pickPos.val * PICK_STEP_PX}px)` }, ...t.picks.map((pick) =>
          div({ class: () => (t.active.val === pick.id ? "adjust-item is-active" : "adjust-item") }, span(pick.label), value(pick)))));
    }
    const pick = t.picks.find((p) => p.id === t.active.val) ?? t.picks[0];
    return div({ class: "adjust-pill" }, span(pick.label), value(pick));
  };

  return { Readout };
}
