import van from "../../lib/van-1.6.1.js";

const { span } = van.tags;

// Stars, flag, and colour label for one photo. Pure rendering of the photo's raw cull fields.
export function Stars(rating) {
  return span({ class: "stars", "aria-label": `${rating} of 5 stars` },
    ...[1, 2, 3, 4, 5].map((n) => span({ class: n <= rating ? "star is-on" : "star" }, "★")));
}

export function FlagBadge(flag) {
  if (flag === "pick") return span({ class: "flag flag-pick", title: "Pick" }, "⚑");
  if (flag === "reject") return span({ class: "flag flag-reject", title: "Rejected" }, "✕");
  return span({ class: "flag" });
}

export function LabelDot(label) {
  return label ? span({ class: `label-dot label-${label.toLowerCase()}`, title: label }) : span({ class: "label-dot" });
}
