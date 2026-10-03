import van from "../lib/van-1.6.1.js";
import { state, showError } from "./state.js";
import { api, ApiError } from "./api.js";

// Loading the server's view of things into state. The server is the source of truth, including
// for filtering: a cull view is a query parameter, never a client-side filter.

export async function loadProjects() {
  try {
    state.projects.val = await api.listProjects();
  } catch (e) {
    showError(e instanceof ApiError ? e.message : "Could not load projects");
  }
}

export async function loadCurrentProject() {
  const id = state.projectId.val;
  if (!id) return;
  try {
    const { photos, ...rest } = await api.projectPhotos(id, state.filter.val);
    const selectedId = state.photos.val[state.selected.val]?.val.id;
    state.current.val = rest;
    state.photos.val = photos.map((p) => van.state(p));
    // Keep the selection on the same photo across reloads when it's still in view.
    const kept = photos.findIndex((p) => p.id === selectedId);
    state.selected.val = kept >= 0 ? kept : Math.min(state.selected.val, Math.max(photos.length - 1, 0));
    if (!photos.length) state.loupeOpen.val = false;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      showError("That project doesn't exist any more");
      state.current.val = null;
      return;
    }
    showError(e instanceof ApiError ? e.message : "Could not load the project");
  }
}
