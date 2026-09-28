(function () {
  "use strict";

  var PLUGIN_ID = "extractScenes";
  var INSTANCE_KEY = "__extractScenesFloatingAction";
  var MUTATION_DEBOUNCE_MS = 150;
  var RELEVANT_MUTATION_SELECTOR =
    "#plugin-extractScenes-destinationFolder";
  var hubApi = window.DirtyPlugins;
  if (!hubApi || !hubApi.graphql) {
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
  var h = React.createElement;

  function publishBusyState() {
    state.actionListeners.slice().forEach(function (listener) { listener(state.busy); });
  }

  function ExtractionAction(props) {
    var busyState = React.useState(state.busy);
    var busy = busyState[0];
    var setBusy = busyState[1];
    React.useEffect(function () {
      state.actionListeners.push(setBusy);
      setBusy(state.busy);
      return function () {
        var index = state.actionListeners.indexOf(setBusy);
        if (index !== -1) state.actionListeners.splice(index, 1);
      };
    }, []);
    if (state.destroyed) return null;
    var selection = props.selection;
    var count = selection.ids.length;
    var label = busy ? "Queuing extraction\u2026" : count === 1
      ? "Extract selected " + selection.singular
      : "Extract " + count + " selected " + selection.plural;
    return h("div", { className: "dirty-file-extractor-selection-actions" },
      h(hubApi.react.Button, {
        className: "extract-scenes-action",
        tone: "primary",
        busy: busy,
        onClick: function () { startCopy(selection); },
      }, label)
    );
  }

  function registerListAction(component, kind) {
    PluginApi.patch.after(component, function () {
      var args = Array.prototype.slice.call(arguments);
      var result = args.pop();
      var props = args[0];
      if (state.destroyed || !result || !props || !props.selectedIds || !props.selectedIds.size) return result;
      var selection = {
        kind: kind,
        ids: Array.from(props.selectedIds).map(function (id) { return String(id); }),
        singular: kind,
        plural: kind === "image" ? "images" : kind + "s",
      };
      // A React-owned action row reserves space below the native toolbar.
      // The list's selection works on performer pages and across pagination.
      return h(React.Fragment, null, h(ExtractionAction, { selection: selection }), result);
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

  function pickerPathLabel(path) {
    var parts = String(path || "").split(/[\\/]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : String(path || "Computer");
  }

  function setPickerStatus(picker, message, isError) {
    picker.status.textContent = isError && hubApi.captureEnabled && hubApi.captureEnabled(window.location.search)
      ? "Folder unavailable during documentation capture."
      : message || "";
    picker.status.classList.toggle("dirty-ui-text-error", Boolean(isError));
  }

  function renderDirectory(picker, directory) {
    var docsCapture = hubApi.captureEnabled && hubApi.captureEnabled(window.location.search);
    picker.currentPath = directory.path;
    picker.pathInput.value = docsCapture ? "Path hidden for documentation" : directory.path;
    picker.upButton.disabled = !directory.parent;
    picker.useButton.disabled = false;
    picker.list.textContent = "";

    var directories = Array.isArray(directory.directories)
      ? directory.directories
      : [];
    if (!directories.length) {
      var empty = document.createElement("div");
      empty.className = "dirty-file-extractor-picker-empty";
      empty.textContent = "No subfolders";
      picker.list.appendChild(empty);
    }

    directories.forEach(function (path, index) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "dirty-file-extractor-folder btn btn-link";
      button.title = docsCapture ? "Open subfolder" : path;
      button.textContent = docsCapture ? "Folder " + (index + 1) : pickerPathLabel(path);
      button.addEventListener("click", function () {
        loadDirectory(picker, path, false);
      });
      picker.list.appendChild(button);
    });

    picker.parentPath = directory.parent || null;
    setPickerStatus(picker, directories.length + " subfolder" +
      (directories.length === 1 ? "" : "s"), false);
  }

  function loadDirectory(picker, path, fallbackToHome) {
    var requestId = ++state.pickerRequest;
    picker.useButton.disabled = true;
    picker.list.textContent = "";
    setPickerStatus(picker, "Loading folders\u2026", false);

    return hubApi.graphql(
      "query DirtyFileExtractorDirectory($path:String){" +
        "directory(path:$path){path parent directories}}",
      { path: path || null }
    )
      .then(function (data) {
        if (state.picker !== picker || requestId !== state.pickerRequest) return;
        renderDirectory(picker, data.directory);
      })
      .catch(function (error) {
        if (state.picker !== picker || requestId !== state.pickerRequest) return;
        if (fallbackToHome && path) {
          setPickerStatus(picker, "Saved folder is unavailable; showing the home folder.", true);
          return loadDirectory(picker, null, false);
        }
        setPickerStatus(picker, error.message || String(error), true);
      });
  }

  function closeFolderPicker() {
    state.pickerRequest += 1;
    var picker = state.picker;
    if (picker && picker.backdrop.parentNode) {
      picker.backdrop.parentNode.removeChild(picker.backdrop);
    }
    state.picker = null;
    if (picker && picker.releaseDialog) picker.releaseDialog();
  }

  function saveDestinationFolder(picker) {
    if (!picker.currentPath) return;
    picker.useButton.disabled = true;
    setPickerStatus(picker, "Saving destination\u2026", false);

    getSettings()
      .then(function (settings) {
        var nextSettings = Object.assign({}, settings, {
          destinationFolder: picker.currentPath,
        });
        return hubApi.configurePlugin(PLUGIN_ID, nextSettings);
      })
      .then(function () {
        closeFolderPicker();
        notify("Destination folder saved.", false);
        if (window.DirtyPlugins &&
            typeof window.DirtyPlugins.notifyConfigurationChanged === "function") {
          window.DirtyPlugins.notifyConfigurationChanged(PLUGIN_ID);
        }
      })
      .catch(function (error) {
        setPickerStatus(picker, error.message || String(error), true);
        picker.useButton.disabled = false;
      });
  }

  function createFolderPicker() {
    var backdrop = document.createElement("div");
    backdrop.className = "dirty-file-extractor-picker-backdrop dirty-ui-backdrop";

    var dialog = document.createElement("div");
    dialog.className = "dirty-file-extractor-picker-dialog dirty-ui-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "dirty-file-extractor-picker-title");
    dialog.tabIndex = -1;
    backdrop.appendChild(dialog);

    var header = document.createElement("div");
    header.className = "dirty-file-extractor-picker-header";
    dialog.appendChild(header);

    var title = document.createElement("h3");
    title.id = "dirty-file-extractor-picker-title";
    title.textContent = "Choose destination folder";
    header.appendChild(title);

    var closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "close dirty-ui-icon-button";
    closeButton.setAttribute("aria-label", "Close folder picker");
    closeButton.textContent = "\u00d7";
    closeButton.addEventListener("click", closeFolderPicker);
    header.appendChild(closeButton);

    var pathBar = document.createElement("div");
    pathBar.className = "dirty-file-extractor-picker-path input-group";
    dialog.appendChild(pathBar);

    var upButton = document.createElement("button");
    upButton.type = "button";
    upButton.className = "btn btn-secondary dirty-ui-button";
    upButton.textContent = "Up";
    pathBar.appendChild(upButton);

    var pathInput = document.createElement("input");
    pathInput.type = "text";
    pathInput.className = "form-control";
    pathInput.setAttribute("aria-label", "Folder path");
    if (hubApi.captureEnabled && hubApi.captureEnabled(window.location.search)) pathInput.disabled = true;
    pathBar.appendChild(pathInput);

    var goButton = document.createElement("button");
    goButton.type = "button";
    goButton.className = "btn btn-secondary dirty-ui-button";
    if (pathInput.disabled) goButton.disabled = true;
    goButton.textContent = "Go";
    pathBar.appendChild(goButton);

    var list = document.createElement("div");
    list.className = "dirty-file-extractor-picker-list";
    dialog.appendChild(list);

    var status = document.createElement("div");
    status.className = "dirty-file-extractor-picker-status";
    status.setAttribute("aria-live", "polite");
    dialog.appendChild(status);

    var footer = document.createElement("div");
    footer.className = "dirty-file-extractor-picker-footer";
    dialog.appendChild(footer);

    var cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "btn btn-secondary dirty-ui-button";
    cancelButton.textContent = "Cancel";
    cancelButton.addEventListener("click", closeFolderPicker);
    footer.appendChild(cancelButton);

    var useButton = document.createElement("button");
    useButton.type = "button";
    useButton.className = "btn btn-primary dirty-ui-button";
    useButton.textContent = "Use this folder";
    footer.appendChild(useButton);

    var picker = {
      backdrop: backdrop,
      dialog: dialog,
      closeButton: closeButton,
      currentPath: null,
      list: list,
      parentPath: null,
      pathInput: pathInput,
      status: status,
      upButton: upButton,
      useButton: useButton,
    };

    upButton.addEventListener("click", function () {
      if (picker.parentPath) loadDirectory(picker, picker.parentPath, false);
    });
    goButton.addEventListener("click", function () {
      loadDirectory(picker, pathInput.value.trim(), false);
    });
    pathInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        loadDirectory(picker, pathInput.value.trim(), false);
      }
    });
    useButton.addEventListener("click", function () {
      saveDestinationFolder(picker);
    });
    backdrop.addEventListener("click", function (event) {
      if (event.target === backdrop) closeFolderPicker();
    });

    return picker;
  }

  function openFolderPicker(event) {
    event.preventDefault();
    var opener = event.currentTarget || document.activeElement;
    closeFolderPicker();
    var picker = createFolderPicker();
    state.picker = picker;
    document.body.appendChild(picker.backdrop);
    picker.releaseDialog = hubApi.ui.manageDialog({
      dialog: picker.dialog,
      initialFocus: picker.closeButton,
      onClose: closeFolderPicker,
      opener: opener,
    });

    getSettings()
      .then(function (settings) {
        if (state.picker !== picker) return;
        return loadDirectory(
          picker,
          String(settings.destinationFolder || "").trim() || null,
          true
        );
      })
      .catch(function (error) {
        if (state.picker === picker) {
          setPickerStatus(picker, error.message || String(error), true);
        }
      });
  }

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
