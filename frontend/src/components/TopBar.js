import van from "../../lib/van-1.6.1.js";
import { state, showError } from "../state.js";
import { api } from "../api.js";
import { navigate } from "../router.js";

const { header, a, div, span, button } = van.tags;

export function TopBar() {
  async function signOut() {
    try {
      await api.logout();
    } catch (e) {
      showError("Could not sign out");
      return;
    }
    state.user.val = null;
  }

  return header(
    { class: "top-bar" },
    a({ class: "wordmark", href: "/", onclick: (e) => { e.preventDefault(); navigate(null); } }, "proof"),
    div(
      { class: "top-bar-user" },
      span({ class: "username" }, () => state.user.val?.username ?? ""),
      button({ class: "btn-ghost btn-small", onclick: signOut }, "Sign out"),
    ),
  );
}
