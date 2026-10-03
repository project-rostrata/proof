import van from "../../lib/van-1.6.1.js";
import { cull } from "../cull.js";

const { div, button, span } = van.tags;

const LABELS = ["Red", "Yellow", "Green", "Blue", "Purple"];

// Clicking must not move keyboard focus onto the button. Otherwise Enter or Space would press it
// again, and the culling keys (arrows, 0-5, P, X) should keep working right after a click.
const keepFocus = (e) => e.preventDefault();

// Clickable culling for one photo: the same changes as the keyboard (cull.js), for the mouse and
// for touch devices with no keyboard. Stars set the rating, and clicking the current rating clears
// it. Pick, Reject, and the colour labels toggle.
export function CullControls(photoState) {
  return () => {
    const p = photoState.val; // re-render on this photo's own cull changes
    const set = (change) => cull(photoState, change);
    return div(
      { class: "cull-controls" },
      button({
        class: `cull-toggle cull-pick${p.flag === "pick" ? " is-on" : ""}`, title: "Pick (P)", "aria-pressed": String(p.flag === "pick"),
        onmousedown: keepFocus, onclick: () => set({ flag: p.flag === "pick" ? "none" : "pick" }),
      }, span({ "aria-hidden": "true" }, "⚑"), " Pick"),
      button({
        class: `cull-toggle cull-reject${p.flag === "reject" ? " is-on" : ""}`, title: "Reject (X)", "aria-pressed": String(p.flag === "reject"),
        onmousedown: keepFocus, onclick: () => set({ flag: p.flag === "reject" ? "none" : "reject" }),
      }, span({ "aria-hidden": "true" }, "✕"), " Reject"),
      // In the DOM 5..1, laid out right-to-left, so CSS can preview a hovered rating with `~`.
      div({ class: "cull-stars", role: "group", "aria-label": `Rating: ${p.rating} of 5` },
        ...[5, 4, 3, 2, 1].map((n) => button({
          class: n <= p.rating ? "cull-star is-on" : "cull-star",
          title: n === p.rating ? `${n} star${n > 1 ? "s" : ""}: click to clear (0)` : `${n} star${n > 1 ? "s" : ""} (${n})`,
          "aria-label": `${n} star${n > 1 ? "s" : ""}`,
          onmousedown: keepFocus, onclick: () => set({ rating: p.rating === n ? 0 : n }),
        }, "★"))),
      div({ class: "cull-labels", role: "group", "aria-label": "Colour label" },
        ...LABELS.map((label, i) => button({
          class: `cull-label label-${label.toLowerCase()}${p.label === label ? " is-on" : ""}`,
          title: `${label} label${i < 4 ? ` (${i + 6})` : ""}`, "aria-label": `${label} label`, "aria-pressed": String(p.label === label),
          onmousedown: keepFocus, onclick: () => set({ label: p.label === label ? null : label }),
        }))),
    );
  };
}
