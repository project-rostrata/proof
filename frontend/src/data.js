import { state, showError } from "./state.js";
import { api, ApiError } from "./api.js";

// Loading the server's view of things into state. The server is the source of truth, so after any
// change the UI reloads what it shows rather than patching it locally.

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
    state.current.val = await api.projectPhotos(id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      showError("That project doesn't exist any more");
      state.current.val = null;
      return;
    }
    showError(e instanceof ApiError ? e.message : "Could not load the project");
  }
}
