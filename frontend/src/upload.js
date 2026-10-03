import { state } from "./state.js";
import { uploadPhoto, ApiError } from "./api.js";
import { loadCurrentProject } from "./data.js";

// A few uploads at a time (PROJECT_BRIEF.md §4): enough to keep the connection busy, few enough
// that the server's thumbnail generation keeps up.
const CONCURRENCY = 3;

const queue = [];
let running = 0;
let refreshTimer = null;

function touch() {
  state.uploads.val = [...state.uploads.val];
}

// The grid reloads from the server shortly after each success, batched so a burst of finished
// uploads causes one reload rather than dozens.
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(loadCurrentProject, 400);
}

export function uploadFiles(projectId, fileList) {
  const files = Array.from(fileList);
  if (!files.length) return;
  const entries = files.map((file) => ({ file, projectId, loaded: 0, total: file.size, status: "queued", error: null }));
  state.uploads.val = [...state.uploads.val.filter((u) => u.status !== "done"), ...entries];
  queue.push(...entries);
  pump();
}

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const entry = queue.shift();
    running++;
    run(entry).finally(() => {
      running--;
      pump();
      if (running === 0 && !queue.length) clearFinished();
    });
  }
}

async function run(entry) {
  entry.status = "uploading";
  touch();
  try {
    await uploadPhoto(entry.projectId, entry.file, (loaded) => {
      entry.loaded = loaded;
      touch();
    });
    entry.status = "done";
    entry.loaded = entry.total;
    if (state.projectId.val === entry.projectId) scheduleRefresh();
  } catch (e) {
    // Shown in the upload panel next to the file name. No toast: a bad batch would raise dozens.
    entry.status = "failed";
    entry.error = e instanceof ApiError ? e.message : "Upload failed";
  }
  touch();
}

// Once a batch finishes, successful entries drop out of the list after a moment. Failures stay
// until the next batch starts, so they can be read.
function clearFinished() {
  setTimeout(() => {
    if (running === 0 && !queue.length) state.uploads.val = state.uploads.val.filter((u) => u.status === "failed");
  }, 2500);
}
