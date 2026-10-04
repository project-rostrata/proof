// One function per endpoint. JSON calls use fetch(); photo uploads use XHR, because only XHR
// reports upload progress (upload.onprogress). The pattern is shelf's.

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(method, path, body) {
  const hasBody = body !== undefined;
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: hasBody ? { "Content-Type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data && data.error ? data.error : { code: "UNKNOWN", message: res.statusText };
    throw new ApiError(res.status, err.code, err.message);
  }
  return data;
}

export const api = {
  register: (username, password) => request("POST", "/api/register", { username, password }),
  login: (username, password) => request("POST", "/api/login", { username, password }),
  logout: () => request("POST", "/api/logout"),
  me: () => request("GET", "/api/me"),

  listProjects: () => request("GET", "/api/projects"),
  createProject: (name) => request("POST", "/api/projects", { name }),
  renameProject: (id, name) => request("PATCH", `/api/projects/${id}`, { name }),
  deleteProject: (id) => request("DELETE", `/api/projects/${id}`),

  projectPhotos: (id, { view, minRating }) =>
    request("GET", `/api/projects/${id}/photos?${new URLSearchParams({ view, minRating: String(minRating) })}`),
  cull: (photoId, change) => request("PATCH", `/api/photos/${photoId}`, change),
  // A link, not a fetch: the browser downloads the ZIP itself, with its own progress.
  exportUrl: (projectId) => `/api/projects/${projectId}/export`,
  getEdit: (photoId) => request("GET", `/api/photos/${photoId}/edit`),
  revertEdit: (photoId) => request("DELETE", `/api/photos/${photoId}/edit`),
};

export function uploadPhoto(projectId, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/projects/${projectId}/photos?filename=${encodeURIComponent(file.name)}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
        return;
      }
      let code = "UNKNOWN";
      let message = xhr.statusText || "Upload failed";
      try {
        const parsed = JSON.parse(xhr.responseText);
        code = parsed.error.code;
        message = parsed.error.message;
      } catch (e) {
        // not JSON: keep the statusText fallback
      }
      reject(new ApiError(xhr.status, code, message));
    };
    xhr.onerror = () => reject(new ApiError(0, "NETWORK_ERROR", "Network error"));
    xhr.send(file);
  });
}

// Saves an edit: one request carrying the recipe and the full-resolution render, framed as
// [4-byte recipe length][recipe JSON][JPEG] (backend fs/EditBody.kt). `base` is the edit version the
// editor started from. The server refuses the save (409) if the edit changed since.
export function saveEdit(photoId, base, recipe, jpeg, onProgress) {
  const recipeBytes = new TextEncoder().encode(JSON.stringify(recipe));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, recipeBytes.length);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/photos/${photoId}/edit?base=${encodeURIComponent(base)}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total); };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data?.error?.code ?? "UNKNOWN", data?.error?.message ?? (xhr.statusText || "Save failed")));
    };
    xhr.onerror = () => reject(new ApiError(0, "NETWORK_ERROR", "Network error"));
    xhr.send(new Blob([length, recipeBytes, jpeg], { type: "application/octet-stream" }));
  });
}
