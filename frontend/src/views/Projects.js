import van from "../../lib/van-1.6.1.js";
import { state, showError } from "../state.js";
import { api, ApiError } from "../api.js";
import { loadProjects } from "../data.js";
import { navigate } from "../router.js";

const { main, section, h1, form, input, button, div, img, span, p } = van.tags;

function NewProjectForm() {
  const name = van.state("");
  const busy = van.state(false);

  async function create(e) {
    e.preventDefault();
    if (!name.val.trim()) return;
    busy.val = true;
    try {
      const project = await api.createProject(name.val.trim());
      await navigate(project.id);
    } catch (err) {
      showError(err instanceof ApiError ? err.message : "Could not create the project");
    } finally {
      busy.val = false;
    }
  }

  return form(
    { class: "new-project", onsubmit: create },
    input({
      class: "field-input", placeholder: "New project name, e.g. Lisbon 2026", "aria-label": "New project name",
      value: name, oninput: (e) => { name.val = e.target.value; },
    }),
    button({ type: "submit", class: "btn-primary", disabled: () => busy.val || !name.val.trim() }, "Create project"),
  );
}

function ProjectCard(project) {
  const renaming = van.state(false);
  const draft = van.state(project.name);

  async function rename(e) {
    e.preventDefault();
    try {
      await api.renameProject(project.id, draft.val.trim());
      renaming.val = false;
      await loadProjects();
    } catch (err) {
      showError(err instanceof ApiError ? err.message : "Could not rename the project");
    }
  }

  async function remove() {
    const what = project.photoCount ? `${project.name} and its ${project.photoCountDisplay}` : project.name;
    if (!confirm(`Delete ${what}? The original files are deleted from disk too. This can't be undone.`)) return;
    try {
      await api.deleteProject(project.id);
      await loadProjects();
    } catch (err) {
      showError(err instanceof ApiError ? err.message : "Could not delete the project");
    }
  }

  return div(
    { class: "project-card" },
    button(
      { class: "project-cover", onclick: () => navigate(project.id), "aria-label": `Open ${project.name}` },
      project.coverThumbUrl ? img({ src: project.coverThumbUrl, alt: "", loading: "lazy" }) : span({ class: "project-cover-empty" }, "No photos yet"),
    ),
    () => renaming.val
      ? form(
        { class: "project-rename", onsubmit: rename },
        input({ class: "field-input", value: draft, autofocus: true, "aria-label": "Project name", oninput: (e) => { draft.val = e.target.value; } }),
        button({ type: "submit", class: "btn-primary btn-small" }, "Save"),
        button({ type: "button", class: "btn-ghost btn-small", onclick: () => { renaming.val = false; draft.val = project.name; } }, "Cancel"),
      )
      : div(
        { class: "project-meta" },
        div(span({ class: "project-name" }, project.name), span({ class: "project-count" }, project.photoCountDisplay)),
        div(
          { class: "project-actions" },
          button({ class: "btn-ghost btn-small", onclick: () => { renaming.val = true; } }, "Rename"),
          button({ class: "btn-ghost btn-small btn-danger", onclick: remove }, "Delete"),
        ),
      ),
  );
}

export function Projects() {
  return main(
    { class: "page" },
    section(
      { class: "page-header" },
      h1("Projects"),
      NewProjectForm(),
    ),
    () => {
      const projects = state.projects.val;
      if (!projects.length) return p({ class: "empty-state" }, "No projects yet. Create one, then add a batch of photos to cull and edit.");
      return div({ class: "project-grid" }, ...projects.map(ProjectCard));
    },
  );
}
