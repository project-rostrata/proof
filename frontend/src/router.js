// The open project is reflected as ?project=<id> on the single / route, so the static file server
// needs no SPA fallback (shelf's approach). Signed-in vs. signed-out isn't in the URL at all.
import { state } from "./state.js";
import { loadProjects, loadCurrentProject } from "./data.js";

function projectFromUrl() {
  return new URLSearchParams(window.location.search).get("project");
}

// The project list is fetched *before* switching to it, so it never flashes stale counts. A
// project page switches first and shows "Loading…" until its photos arrive.
async function show(projectId) {
  if (projectId) {
    state.current.val = null;
    state.projectId.val = projectId;
    await loadCurrentProject();
  } else {
    await loadProjects();
    state.projectId.val = null;
    state.current.val = null;
  }
}

export function initRouter() {
  window.addEventListener("popstate", () => show(projectFromUrl()));
  return show(projectFromUrl());
}

export function navigate(projectId) {
  const query = projectId ? `?project=${encodeURIComponent(projectId)}` : "";
  window.history.pushState({}, "", window.location.pathname + query);
  return show(projectId);
}
