import van from "../../lib/van-1.6.1.js";
import { state, showError } from "../state.js";
import { api, ApiError } from "../api.js";

const { div, form, label, input, button, span, a } = van.tags;

// Sign in and register share one card; `mode` switches between them.
export function Auth({ onSignedIn }) {
  const mode = van.state("login");
  const username = van.state("");
  const password = van.state("");
  const submitting = van.state(false);

  async function submit(e) {
    e.preventDefault();
    submitting.val = true;
    try {
      const call = mode.val === "login" ? api.login : api.register;
      state.user.val = await call(username.val, password.val);
      await onSignedIn();
    } catch (err) {
      showError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      submitting.val = false;
    }
  }

  const field = (id, text, attrs) =>
    div(
      label({ class: "field-label", for: id }, text),
      input({ id, class: "field-input", ...attrs }),
    );

  return div(
    { class: "auth-shell" },
    form(
      { class: "auth-card", onsubmit: submit },
      div(
        { class: "auth-brand" },
        span({ class: "auth-wordmark" }, "proof"),
        span({ class: "auth-subtitle" }, () => (mode.val === "login" ? "Sign in to your photos" : "Create an account")),
      ),
      div(
        { class: "auth-fields" },
        field("auth-username", "Username", {
          autocomplete: "username", autofocus: true, required: true,
          oninput: (e) => { username.val = e.target.value; },
        }),
        field("auth-password", "Password", {
          type: "password", required: true,
          autocomplete: () => (mode.val === "login" ? "current-password" : "new-password"),
          oninput: (e) => { password.val = e.target.value; },
        }),
      ),
      button({ type: "submit", class: "btn-primary btn-block", disabled: submitting },
        () => (mode.val === "login" ? "Sign in" : "Create account")),
      div(
        { class: "auth-switch" },
        () => (mode.val === "login" ? "Need an account? " : "Already have one? "),
        a({ href: "#", onclick: (e) => { e.preventDefault(); mode.val = mode.val === "login" ? "register" : "login"; } },
          () => (mode.val === "login" ? "Register" : "Sign in")),
      ),
    ),
  );
}
