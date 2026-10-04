import van from "../../lib/van-1.6.1.js";
import { state } from "../state.js";
import { setStep } from "../router.js";
import { emptyNode } from "../vanHelpers.js";

const { nav, button, span } = van.tags;

// Upload · Cull · Edit · Export, each with how far it has got (from the API's steps). Any step can be
// opened at any time: they're a guide, not a gate.
export function StepBar() {
  return () => {
    const current = state.current.val;
    if (!current) return emptyNode();
    return nav({ class: "step-bar", "aria-label": "Workflow" }, ...current.steps.steps.map((step, i) => button({
      class: `step${state.step.val === step.id ? " is-current" : ""}${step.done ? " is-done" : ""}`,
      "aria-current": state.step.val === step.id ? "step" : "false",
      onclick: () => { if (state.step.val !== step.id) setStep(step.id); },
    },
    span({ class: "step-number", "aria-hidden": "true" }, step.done ? "✓" : String(i + 1)),
    span({ class: "step-text" }, span({ class: "step-label" }, step.label), span({ class: "step-detail" }, step.summary)))));
  };
}
