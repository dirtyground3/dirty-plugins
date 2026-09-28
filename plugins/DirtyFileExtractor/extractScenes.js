(function () {
  "use strict";

  var PLUGIN_ID = "extractScenes";
  var INSTANCE_KEY = "__extractScenesFloatingAction";
  var MUTATION_DEBOUNCE_MS = 150;
  var RELEVANT_MUTATION_SELECTOR =
    "#plugin-extractScenes-destinationFolder";
  var hubApi = window.DirtyPlugins;
  if (!hubApi || !hubApi.graphql || !hubApi.react || !hubApi.react.html) {
    if (window.DirtyPlugins && window.DirtyPlugins.debugLog) {
      window.DirtyPlugins.debugLog(PLUGIN_ID, "skipped: required runtime missing");
    }
    return;
  }
  window.__dirtyCurrentPluginId = PLUGIN_ID;
  var debugLog = hubApi.debugLog || function () {};

  // Stash may reload plugin assets without reloading the page. Tear down an
  // older instance first so observers and event handlers are never duplicated.
  var previousInstance = window[INSTANCE_KEY];
  if (previousInstance && typeof previousInstance.destroy === "function") {
    debugLog(PLUGIN_ID, "tearing down previous instance before re-register");
    previousInstance.destroy();
  }
  var debugScriptSrc = null;
  try {
    debugScriptSrc = (typeof document !== "undefined" && document.currentScript)
      ? document.currentScript.src
      : null;
  } catch (_debugError) {}
  debugLog(PLUGIN_ID, "script started", {
    script: debugScriptSrc,
    reRegister: Boolean(previousInstance),
  });

  var state = {
    browseButton: null,
    busy: false,
    actionListeners: [],
    destroyed: false,
    frame: null,
    mutationTimer: null,
    observer: null,
    picker: null,
    pickerRequest: 0,
  };
  var hubFieldAction = {
    label: "Browse\u2026",
    onClick: openFolderPicker,
  };

  function getSettings() {
    return hubApi.getPluginSettings(PLUGIN_ID);
  }

  function queueCopy(selection) {
    var args = {};
    args[selection.kind + "_ids"] = selection.ids;
    return hubApi.graphql(
      "mutation ExtractScenesRun($pluginId:ID!,$description:String!,$args:Map){" +
        "runPluginTask(plugin_id:$pluginId,description:$description,args_map:$args)}",
      {
        pluginId: PLUGIN_ID,
        description: "Copy files for " + selection.ids.length + " selected " +
          (selection.ids.length === 1 ? selection.singular : selection.plural),
        args: args,
      }
    ).then(function (data) { return data.runPluginTask; });
  }

  function notify(message, isError) {
    hubApi.ui.notify(message, isError ? "error" : "success");
  }

  var PluginApi = window.PluginApi;
  var React = PluginApi.React;
  var html = hubApi.react.html;

  function publishBusyState() {
    state.actionListeners.slice().forEach(function (listener) { listener(state.busy); });
  }

  function ExtractionAction(props) {
    var busyState = React.useState(state.busy);
    var busy = busyState[0];
    var setBusy = busyState[1];
    var menuState = React.useState(null);
    var menu = menuState[0];
    var setMenu = menuState[1];
    var anchor = React.useRef(null);
    var normalToolbarWidth = React.useRef(0);
    var currentToolbar = React.useRef(null);
    React.useEffect(function () {
      state.actionListeners.push(setBusy);
      setBusy(state.busy);
      return function () {
        var index = state.actionListeners.indexOf(setBusy);
        if (index !== -1) state.actionListeners.splice(index, 1);
      };
    }, []);
    React.useEffect(function () {
      var root = anchor.current && anchor.current.parentElement;
      if (!root) return;
      function syncToolbar() {
        var toolbar = root.querySelector(".filtered-list-toolbar");
        if (currentToolbar.current && currentToolbar.current !== toolbar) {
          currentToolbar.current.style.minWidth = "";
          currentToolbar.current.style.justifyContent = "";
        }
        currentToolbar.current = toolbar;
        if (toolbar && toolbar.classList.contains("has-selection")) {
          if (normalToolbarWidth.current) {
            toolbar.style.minWidth = Math.min(normalToolbarWidth.current, root.clientWidth) + "px";
            toolbar.style.justifyContent = "flex-start";
          }
        } else if (toolbar) {
          toolbar.style.minWidth = "";
          toolbar.style.justifyContent = "";
          normalToolbarWidth.current = toolbar.getBoundingClientRect().width;
        }
        var toggle = toolbar && toolbar.querySelector(
          '.list-operations.dropdown button[aria-haspopup="true"][aria-expanded="true"]'
        );
        var next = toggle && document.querySelector(
          '.dropdown-menu.show[aria-labelledby="' + toggle.id + '"]'
        );
        setMenu(function (current) { return current === next ? current : next; });
      }
      syncToolbar();
      var observer = new MutationObserver(syncToolbar);
      observer.observe(root, {
        attributes: true, attributeFilter: ["aria-expanded", "class"], childList: true, subtree: true,
      });
      // Stash portals the dropdown to document.body.
      observer.observe(document.body, { childList: true });
      window.addEventListener("resize", syncToolbar);
      return function () {
        observer.disconnect();
        window.removeEventListener("resize", syncToolbar);
        if (currentToolbar.current) {
          currentToolbar.current.style.minWidth = "";
          currentToolbar.current.style.justifyContent = "";
        }
      };
    }, []);
    if (state.destroyed) return null;
    var selection = props.selection;
    var count = selection.ids.length;
    var label = busy ? "Queuing extraction\u2026" : count === 1
      ? "Extract selected " + selection.singular
      : "Extract " + count + " selected " + selection.plural;
    function extract() {
      var root = anchor.current && anchor.current.parentElement;
      var toggle = root && root.querySelector(
        '.filtered-list-toolbar.has-selection .list-operations.dropdown button[aria-expanded="true"]'
      );
      if (toggle) toggle.click();
      startCopy(selection);
    }
    var action = html`<button
      type="button"
      className="bg-secondary text-white dropdown-item dirty-file-extractor-menu-action"
      disabled=${busy}
      onClick=${extract}
    >${label}</button>`;
    return html`<${React.Fragment}>
      <span className="dirty-file-extractor-action-anchor" ref=${anchor} />
      ${count && menu && menu.isConnected && PluginApi.ReactDOM && PluginApi.ReactDOM.createPortal
        ? PluginApi.ReactDOM.createPortal(action, menu)
        : null}
    <//>`;
  }

  function registerListAction(component, kind) {
    PluginApi.patch.after(component, function () {
      var args = Array.prototype.slice.call(arguments);
      var result = args.pop();
      var props = args[0];
      if (state.destroyed || !result || !props || !props.selectedIds) return result;
      var selection = {
        kind: kind,
        ids: Array.from(props.selectedIds).map(function (id) { return String(id); }),
        singular: kind,
        plural: kind === "image" ? "images" : kind + "s",
      };
      // Keep the centered toolbar's unselected width when selection changes it.
      // Portal into Stash's selected-items dropdown without adding list height.
      // The list's selection works on performer pages and across pagination.
      return html`<${React.Fragment}><${ExtractionAction} selection=${selection} />${result}<//>`;
    });
  }

  function ensureBrowseButton() {
    if (state.browseButton && state.browseButton.isConnected) {
      return state.browseButton;
    }

    var button = document.createElement("button");
    button.type = "button";
    button.className = "dirty-file-extractor-browse btn btn-secondary dirty-ui-button";
    button.textContent = "Browse\u2026";
    button.hidden = true;
    button.addEventListener("click", openFolderPicker);
    document.body.appendChild(button);
    state.browseButton = button;
    return button;
  }

  function registerHubFieldAction() {
    var hub = window.DirtyPlugins;
    if (!hub || typeof hub.registerFieldAction !== "function") return false;
    hub.registerFieldAction(PLUGIN_ID, "destinationFolder", hubFieldAction);
    return true;
  }

  function renderBrowseButton() {
    if (registerHubFieldAction()) {
      if (state.browseButton) state.browseButton.hidden = true;
      return;
    }
    var button = ensureBrowseButton();
    var row = document.querySelector("#plugin-extractScenes-destinationFolder");
    var editButton = row && row.querySelector("button");
    if (!row || !editButton) {
      button.hidden = true;
      return;
    }

    var rowRect = row.getBoundingClientRect();
    var editRect = editButton.getBoundingClientRect();
    if (rowRect.width === 0 || rowRect.height === 0 ||
        rowRect.bottom <= 0 || rowRect.top >= window.innerHeight) {
      button.hidden = true;
      return;
    }

    button.hidden = false;
    var buttonRect = button.getBoundingClientRect();
    var gap = 8;
    var left = editRect.left - buttonRect.width - gap;
    var top = editRect.top + (editRect.height - buttonRect.height) / 2;

    if (left < rowRect.left + 12) {
      left = Math.max(12, editRect.right - buttonRect.width);
      top = editRect.bottom + gap;
    }

    button.style.left = Math.round(left) + "px";
    button.style.top = Math.round(top) + "px";
  }

  var pickerModule = window.__dirtyFileExtractorPicker;
  if (!pickerModule) return;
  var picker = pickerModule.createPicker({ state: state, hubApi: hubApi, getSettings: getSettings, notify: notify, pluginId: PLUGIN_ID });
  var openFolderPicker = picker.openFolderPicker;
  var closeFolderPicker = picker.closeFolderPicker;

  function scheduleRender() {
    if (state.destroyed || state.frame !== null) return;
    state.frame = window.requestAnimationFrame(function () {
      state.frame = null;
      renderBrowseButton();
    });
  }

  function startCopy(selection) {
    if (state.busy) return;
    if (!selection.kind || !selection.ids.length) {
      notify("No selected scenes, markers, or images were found on this page.", true);
      scheduleRender();
      return;
    }

    state.busy = true;
    publishBusyState();
    getSettings()
      .then(function (settings) {
        if (!String(settings.destinationFolder || "").trim()) {
          throw new Error(
            "No destination folder selected. Set Destination folder under " +
            "the Dirty Plugins settings page first."
          );
        }
        return queueCopy(selection);
      })
      .then(function (jobId) {
        notify(
          "File copy queued as job " + jobId + ". Progress is available in Tasks.",
          false
        );
      })
      .catch(function (error) {
        console.error("[DirtyFileExtractor]", error);
        notify(error.message || String(error), true);
      })
      .then(function () {
        state.busy = false;
        publishBusyState();
      });
  }

  function nodeInRelevantArea(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.matches && node.matches(RELEVANT_MUTATION_SELECTOR)) return true;
    return Boolean(
      node.querySelector && node.querySelector(RELEVANT_MUTATION_SELECTOR)
    );
  }

  function hasRelevantMutations(records) {
    for (var index = 0; index < records.length; index += 1) {
      var added = records[index].addedNodes;
      for (var addedIndex = 0; addedIndex < added.length; addedIndex += 1) {
        if (nodeInRelevantArea(added[addedIndex])) return true;
      }
      var removed = records[index].removedNodes;
      for (var removedIndex = 0; removedIndex < removed.length; removedIndex += 1) {
        if (nodeInRelevantArea(removed[removedIndex])) return true;
      }
    }
    return false;
  }

  function onDocumentMutations(records) {
    if (state.destroyed || state.busy) return;
    if (!hasRelevantMutations(records)) return;
    if (state.mutationTimer !== null) return;

    state.mutationTimer = window.setTimeout(function () {
      state.mutationTimer = null;
      if (state.destroyed || state.busy) return;
      scheduleRender();
    }, MUTATION_DEBOUNCE_MS);
  }

  function destroy() {
    if (state.destroyed) return;
    state.destroyed = true;
    window.removeEventListener("popstate", scheduleRender);
    window.removeEventListener("hashchange", scheduleRender);
    window.removeEventListener("resize", scheduleRender);
    window.removeEventListener("scroll", scheduleRender, true);
    if (state.mutationTimer !== null) {
      window.clearTimeout(state.mutationTimer);
      state.mutationTimer = null;
    }
    if (state.observer) state.observer.disconnect();
    if (state.frame !== null) window.cancelAnimationFrame(state.frame);
    publishBusyState();
    state.actionListeners = [];
    if (state.browseButton) {
      state.browseButton.removeEventListener("click", openFolderPicker);
      if (state.browseButton.parentNode) {
        state.browseButton.parentNode.removeChild(state.browseButton);
      }
    }
    if (window.DirtyPlugins &&
        typeof window.DirtyPlugins.unregisterFieldAction === "function") {
      window.DirtyPlugins.unregisterFieldAction(
        PLUGIN_ID,
        "destinationFolder",
        hubFieldAction
      );
    }
    closeFolderPicker();
  }

  window.addEventListener("popstate", scheduleRender);
  window.addEventListener("hashchange", scheduleRender);
  window.addEventListener("resize", scheduleRender);
  window.addEventListener("scroll", scheduleRender, { capture: true, passive: true });

  // Only older hubs need the DOM-observed settings Browse fallback.
  // Extraction actions use the native lists' React selection props.
  if (!registerHubFieldAction()) {
    state.observer = new MutationObserver(onDocumentMutations);
    state.observer.observe(document.body, { childList: true, subtree: true });
  }
  registerListAction("SceneList", "scene");
  registerListAction("SceneMarkerList", "marker");
  registerListAction("ImageList", "image");

  window[INSTANCE_KEY] = { destroy: destroy };
  registerHubFieldAction();
  scheduleRender();
  debugLog(PLUGIN_ID, "script finished registering", {
    path: window.location.pathname,
    elapsedMs: hubApi.debugElapsed ? hubApi.debugElapsed() : null,
  });
  window.__dirtyCurrentPluginId = null;
})();
