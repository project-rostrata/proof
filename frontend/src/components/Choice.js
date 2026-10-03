import van from "../../lib/van-1.6.1.js";

const { div, span, button } = van.tags;

// A parameter with a fixed set of options (spec.kind "choice"), as a row of buttons.
export function Choice(spec, params, onChange) {
  const current = van.state(params[spec.id]);
  return div(
    { class: "choice" },
    span({ class: "editor-label" }, spec.label),
    div({ class: "choice-buttons" }, ...spec.options.map((option) => button({
      class: () => `btn-ghost btn-small${current.val === option ? " is-active" : ""}`,
      onclick: () => { params[spec.id] = option; current.val = option; onChange(); },
    }, spec.labels?.[option] ?? option))),
  );
}
