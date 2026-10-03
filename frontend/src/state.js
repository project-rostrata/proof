import van from "../lib/van-1.6.1.js";

// A handful of top-level van.state() values. No store abstraction needed at this size.
export const state = {
  authChecked: van.state(false),
  user: van.state(null), // { userId, username } | null

  projectId: van.state(null), // the open project's id (from ?project=), or null for the project list
  projects: van.state([]), // ApiProject[], straight from GET /api/projects

  // The open project, as GET /api/projects/:id/photos returned it: { project, views, view, minRating }.
  current: van.state(null),
  // Its photos, one van.state per photo, so a rating change re-renders one frame, not the sheet.
  photos: van.state([]),
  filter: van.state({ view: "all", minRating: 0 }), // requested view, mirrored in the URL
  selected: van.state(0), // index into photos
  loupeOpen: van.state(false),
  editing: van.state(null), // the photo state being edited (one of `photos`), or null

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
