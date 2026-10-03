import van from "./lib/van-1.6.1.js";
import { state } from "./src/state.js";
import { api } from "./src/api.js";
import { initRouter } from "./src/router.js";
import { Toast } from "./src/components/Toast.js";
import { TopBar } from "./src/components/TopBar.js";
import { Auth } from "./src/views/Auth.js";
import { Projects } from "./src/views/Projects.js";
import { Project } from "./src/views/Project.js";

const { div } = van.tags;

function Root() {
  return div(
    Toast(),
    () => {
      if (!state.authChecked.val) return div({ class: "empty-state" }, "Loading…");
      if (!state.user.val) return Auth({ onSignedIn: initRouter });
      return div({ class: "app-shell" }, TopBar(), () => (state.projectId.val ? Project() : Projects()));
    },
  );
}

async function boot() {
  try {
    state.user.val = await api.me();
    await initRouter();
  } catch (e) {
    state.user.val = null; // 401: not signed in
  } finally {
    state.authChecked.val = true;
  }
}

van.add(document.getElementById("app"), Root());
boot();
