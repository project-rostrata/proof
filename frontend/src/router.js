// The open project and its cull filter live in the query string (?project=<id>&view=picks&minRating=3)
// on the single / route, so the static file server needs no SPA fallback (shelf's approach), and a
// reload or a shared link lands on the same view. Signed-in vs. signed-out isn't in the URL.
import { state } from "./state.js";
import { loadProjects, loadCurrentProject } from "./data.js";

function fromUrl() {
  const q = new URLSearchParams(window.location.search);
  return {
    projectId: q.get("project"),
    filter: { view: q.get("view") || "all", minRating: Number(q.get("minRating") || 0) },
  };
}

function toUrl(projectId, filter) {
  const q = new URLSearchParams();
  if (projectId) {
    q.set("project", projectId);
    if (filter.view !== "all") q.set("view", filter.view);
    if (filter.minRating) q.set("minRating", String(filter.minRating));
  }
  const query = q.toString();
  return window.location.pathname + (query ? `?${query}` : "");
}

// The project list is fetched *before* switching to it, so it never flashes stale counts. A
// project page switches first and shows "Loading…" until its photos arrive.
async function show({ projectId, filter }) {
  state.loupeOpen.val = false;
  if (projectId) {
    if (projectId !== state.projectId.val) {
      state.current.val = null;
      state.photos.val = [];
      state.selected.val = 0;
    }
    state.filter.val = filter;
    state.projectId.val = projectId;
    await loadCurrentProject();
  } else {
    await loadProjects();
    state.projectId.val = null;
    state.current.val = null;
    state.photos.val = [];
  }
}

export function initRouter() {
  window.addEventListener("popstate", () => show(fromUrl()));
  return show(fromUrl());
}

export function navigate(projectId) {
  const filter = { view: "all", minRating: 0 };
  window.history.pushState({}, "", toUrl(projectId, filter));
  return show({ projectId, filter });
}

export function setFilter(filter) {
  window.history.replaceState({}, "", toUrl(state.projectId.val, filter));
  state.selected.val = 0;
  return show({ projectId: state.projectId.val, filter });
}
