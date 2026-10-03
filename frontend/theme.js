// Sets <html data-theme="light|dark"> before first paint: a classic script loaded from <head>,
// so it blocks rendering, unlike the app.js module (deferred), which would flash the other
// theme first. The footer toggle saves an explicit choice in localStorage; until there is
// one, the theme follows the system setting, live. style.css keys its light tokens off this
// attribute alone. A per-browser convenience, not account data, so it isn't sent to the API.
// Same as larder's theme.js.
(function () {
  var KEY = "proof-theme";
  var systemLight = window.matchMedia("(prefers-color-scheme: light)");

  function saved() {
    try {
      var value = localStorage.getItem(KEY);
      return value === "light" || value === "dark" ? value : null;
    } catch (e) {
      return null; // storage blocked (private mode, disabled site data): follow the system
    }
  }

  function apply() {
    document.documentElement.dataset.theme = saved() || (systemLight.matches ? "light" : "dark");
  }

  apply();
  systemLight.addEventListener("change", apply);
})();
