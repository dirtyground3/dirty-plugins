(function () {
  "use strict";

  var PLUGIN_ID = "extractScenes";
  var INSTANCE_KEY = "__extractScenesFloatingAction";

  // Stash may reload plugin assets without reloading the page. Tear down an
  // older instance first so observers and event handlers are never duplicated.
  var previousInstance = window[INSTANCE_KEY];
  if (previousInstance && typeof previousInstance.destroy === "function") {
    previousInstance.destroy();
  }

  var state = {
    busy: false,
    button: null,
    destroyed: false,
    frame: null,
    observer: null,
  };

  function graphql(query, variables) {
    return fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ query: query, variables: variables || {} }),
    })
      .then(function (response) {
        if (!response.ok) throw new Error("Stash returned HTTP " + response.status);
        return response.json();
      })
      .then(function (result) {
        if (result.errors && result.errors.length) {
          throw new Error(
            result.errors.map(function (error) { return error.message; }).join("; ")
          );
        }
        return result.data || {};
      });
  }

  function getSettings() {
    return graphql(
      "query ExtractScenesSettings($ids:[ID!]){" +
        "configuration{plugins(include:$ids)}}",
      { ids: [PLUGIN_ID] }
    ).then(function (data) {
      var plugins = (data.configuration && data.configuration.plugins) || {};
      return plugins[PLUGIN_ID] || {};
    });
  }

  function queueCopy(sceneIds) {
    return graphql(
      "mutation ExtractScenesRun($pluginId:ID!,$description:String!,$args:Map){" +
        "runPluginTask(plugin_id:$pluginId,description:$description,args_map:$args)}",
      {
        pluginId: PLUGIN_ID,
        description: "Copy files for " + sceneIds.length + " selected scene" +
          (sceneIds.length === 1 ? "" : "s"),
        args: { scene_ids: sceneIds },
      }
    ).then(function (data) { return data.runPluginTask; });
  }

  function notify(message, isError) {
    var toast = document.createElement("div");
    toast.className = "extract-scenes-toast alert " +
      (isError ? "alert-danger" : "alert-success");
    toast.setAttribute("role", "alert");
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, isError ? 8000 : 5000);
  }

  function sceneIdFromSelectionCheckbox(checkbox) {
    var item = checkbox.closest(".scene-card, .table-list tbody tr, .wall-item");
    if (!item) return null;
    var link = item.querySelector('a[href*="/scenes/"]');
    if (!link) return null;
    try {
      var path = new URL(link.getAttribute("href"), window.location.origin).pathname;
      var match = path.match(/\/scenes\/([^/]+)/);
      return match ? decodeURIComponent(match[1]) : null;
    } catch (_error) {
      return null;
    }
  }

  function selectedSceneIds() {
    var ids = [];
    var seen = Object.create(null);
    document.querySelectorAll(
      ".item-list-container.scene-list input[type=checkbox]:checked"
    ).forEach(function (checkbox) {
      var id = sceneIdFromSelectionCheckbox(checkbox);
      if (id && !seen[id]) {
        seen[id] = true;
        ids.push(id);
      }
    });
    return ids;
  }

  function isScenesListVisible() {
    return /^\/scenes\/?$/.test(window.location.pathname) &&
      Boolean(document.querySelector(".item-list-container.scene-list"));
  }

  function ensureButton() {
    if (state.button && state.button.isConnected) return state.button;

    var button = document.createElement("button");
    button.type = "button";
    button.className = "extract-scenes-action btn btn-primary";
    button.hidden = true;
    button.setAttribute("aria-live", "polite");
    button.addEventListener("click", onActionClick);
    document.body.appendChild(button);
    state.button = button;
    return button;
  }

  function renderButton() {
    if (state.destroyed) return;
    var button = ensureButton();
    var sceneIds = selectedSceneIds();
    var count = sceneIds.length;

    if (state.busy) {
      button.hidden = false;
      button.disabled = true;
      if (button.textContent !== "Queuing extraction\u2026") {
        button.textContent = "Queuing extraction\u2026";
      }
      return;
    }

    button.disabled = false;
    button.hidden = !isScenesListVisible() || count === 0;
    var label = count === 1
      ? "Extract selected scene"
      : "Extract " + count + " selected scenes";
    if (button.textContent !== label) button.textContent = label;
  }

  function scheduleRender() {
    if (state.destroyed || state.frame !== null) return;
    state.frame = window.requestAnimationFrame(function () {
      state.frame = null;
      renderButton();
    });
  }

  function startCopy(sceneIds) {
    if (state.busy) return;
    if (!sceneIds.length) {
      notify("No selected scenes were found on this page.", true);
      scheduleRender();
      return;
    }

    state.busy = true;
    renderButton();
    getSettings()
      .then(function (settings) {
        if (!String(settings.destinationFolder || "").trim()) {
          throw new Error(
            "Set Destination folder under Settings > Plugins > DirtyFileExtractor first."
          );
        }
        return queueCopy(sceneIds);
      })
      .then(function (jobId) {
        notify(
          "Scene file copy queued as job " + jobId + ". Progress is available in Tasks.",
          false
        );
      })
      .catch(function (error) {
        console.error("[DirtyFileExtractor]", error);
        notify(error.message || String(error), true);
      })
      .then(function () {
        state.busy = false;
        scheduleRender();
      });
  }

  function onActionClick(event) {
    event.preventDefault();
    startCopy(selectedSceneIds());
  }

  function onDocumentChange(event) {
    var target = event.target;
    if (target instanceof Element && target.matches("input[type=checkbox]")) {
      scheduleRender();
    }
  }

  function destroy() {
    if (state.destroyed) return;
    state.destroyed = true;
    document.removeEventListener("change", onDocumentChange, true);
    window.removeEventListener("popstate", scheduleRender);
    window.removeEventListener("hashchange", scheduleRender);
    if (state.observer) state.observer.disconnect();
    if (state.frame !== null) window.cancelAnimationFrame(state.frame);
    if (state.button) {
      state.button.removeEventListener("click", onActionClick);
      if (state.button.parentNode) state.button.parentNode.removeChild(state.button);
    }
  }

  document.addEventListener("change", onDocumentChange, true);
  window.addEventListener("popstate", scheduleRender);
  window.addEventListener("hashchange", scheduleRender);

  // The observer only reads Stash's DOM and updates our body-level button. It
  // never inserts into, replaces, or patches any React-owned element.
  state.observer = new MutationObserver(scheduleRender);
  state.observer.observe(document.body, { childList: true, subtree: true });

  window[INSTANCE_KEY] = { destroy: destroy };
  scheduleRender();
})();
