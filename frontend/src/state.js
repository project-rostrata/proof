import van from "../lib/van-1.6.1.js";

// A handful of top-level van.state() values. No store abstraction needed at this size.
export const state = {
  authChecked: van.state(false),
  user: van.state(null), // { userId, username } | null

  projectId: van.state(null), // the open project's id (from ?project=), or null for the project list
  projects: van.state([]), // ApiProject[], straight from GET /api/projects
  current: van.state(null), // { project, photos } from GET /api/projects/:id/photos

  uploads: van.state([]), // in-flight and recently finished uploads, see upload.js
  error: van.state(null), // string | null, shown by the Toast component
};

let errorTimer = null;

export function showError(message) {
  state.error.val = message;
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => {
    state.error.val = null;
  }, 6000);
}
