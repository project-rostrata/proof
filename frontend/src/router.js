// The open project, its step, and the Cull step's filter live in the query string
// (?project=<id>&step=cull&view=picks&minRating=3) on the single / route, so the static file server
// needs no SPA fallback (shelf's approach), and a reload or a shared link lands on the same view.
// Signed-in vs. signed-out isn't in the URL.
import { state } from "./state.js";
import { loadProjects, loadCurrentProject } from "./data.js";

const STEPS = ["upload", "cull", "edit", "export"];
const ALL = { view: "all", minRating: 0 };

// What each step lists: Upload and Cull every photo (Cull with its own filter), Edit and Export the
// picks. The view itself is still filtered by the API.
function filterFor(step, filter) {
  if (step === "edit" || step === "export") return { view: "picks", minRating: 0 };
  if (step === "cull") return filter;
  return ALL;
}

function fromUrl() {
  const q = new URLSearchParams(window.location.search);
  const step = q.get("step");
  return {
    projectId: q.get("project"),
    step: STEPS.includes(step) ? step : null,
    filter: { view: q.get("view") || "all", minRating: Number(q.get("minRating") || 0) },
  };
}

function toUrl(projectId, step, filter) {
  const q = new URLSearchParams();
  if (projectId) {
    q.set("project", projectId);
    if (step) q.set("step", step);
    if (step === "cull" && filter.view !== "all") q.set("view", filter.view);
    if (step === "cull" && filter.minRating) q.set("minRating", String(filter.minRating));
  }
  const query = q.toString();
  return window.location.pathname + (query ? `?${query}` : "");
}

// The project list is fetched *before* switching to it, so it never flashes stale counts. A
// project page switches first and shows "Loading…" until its photos arrive. Without a step in the
// URL, a project opens on the step the API suggests (the first with something left to do).
async function show({ projectId, step, filter }) {
  state.editing.val = null;
  state.editPass.val = false;
  state.loupeOpen.val = false;
  state.cullPass.val = false;
  if (projectId) {
    if (projectId !== state.projectId.val) {
      state.current.val = null;
      state.photos.val = [];
      state.selected.val = 0;
    }
    state.step.val = step ?? "cull";
    state.filter.val = filterFor(step, filter);
    state.projectId.val = projectId;
    await loadCurrentProject();
    if (!step && state.current.val) {
      const suggested = state.current.val.steps.suggested;
      window.history.replaceState({}, "", toUrl(projectId, suggested, ALL));
      state.step.val = suggested;
      if (filterFor(suggested, ALL).view !== state.filter.val.view) {
        state.filter.val = filterFor(suggested, ALL);
        await loadCurrentProject();
      }
    }
  } else {
    await loadProjects();
    state.projectId.val = null;
    state.step.val = null;
    state.current.val = null;
    state.photos.val = [];
  }
}

export function initRouter() {
  window.addEventListener("popstate", () => show(fromUrl()));
  return show(fromUrl());
}

export function navigate(projectId) {
  window.history.pushState({}, "", toUrl(projectId, null, ALL));
  return show({ projectId, step: null, filter: ALL });
}

export function setStep(step) {
  window.history.pushState({}, "", toUrl(state.projectId.val, step, ALL));
  state.selected.val = 0;
  return show({ projectId: state.projectId.val, step, filter: ALL });
}

export function setFilter(filter) {
  window.history.replaceState({}, "", toUrl(state.projectId.val, state.step.val, filter));
  state.selected.val = 0;
  return show({ projectId: state.projectId.val, step: state.step.val, filter });
}
