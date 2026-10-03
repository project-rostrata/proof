import van from "../../lib/van-1.6.1.js";
import { state } from "../state.js";
import { emptyNode } from "../vanHelpers.js";

const { div, span, button } = van.tags;

export function Toast() {
  return div(
    { class: "toast-container" },
    () => {
      const message = state.error.val;
      if (!message) return emptyNode();
      return div(
        { class: "toast", role: "alert" },
        span({ class: "toast-message" }, message),
        button({ class: "toast-dismiss", "aria-label": "Dismiss", onclick: () => { state.error.val = null; } }, "×"),
      );
    },
  );
}
