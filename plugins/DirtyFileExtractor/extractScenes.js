(function () {
  "use strict";

  var PLUGIN_ID = "extractScenes";
  var INSTANCE_KEY = "__extractScenesFloatingAction";
  var hubApi = window.DirtyPlugins;

  // Stash may reload plugin assets without reloading the page. Tear down an
  // older instance first so observers and event handlers are never duplicated.
  var previousInstance = window[INSTANCE_KEY];
  if (previousInstance && typeof previousInstance.destroy === "function") {
    previousInstance.destroy();
  }

  var state = {
    browseButton: null,
    busy: false,
    button: null,
    destroyed: false,
    frame: null,
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

  function currentItemKind() {
    var path = window.location.pathname;
    if (/^\/scenes\/markers\/?$/.test(path)) return "marker";
    if (/^\/scenes\/?$/.test(path)) return "scene";
    if (/^\/images\/?$/.test(path)) return "image";
    return null;
  }

  function idFromLinkedItem(checkbox, routeName) {
    var node = checkbox;
    var routePattern = new RegExp("/" + routeName + "/([^/?#]+)");
    while (node && node !== document.body) {
      if (node !== checkbox && node.matches(
        ".item-list-container, .marker-wall, main, .sidebar-pane-content"
      )) break;

      var links = node.querySelectorAll ? node.querySelectorAll("a[href]") : [];
      for (var index = 0; index < links.length; index += 1) {
        try {
          var path = new URL(
            links[index].getAttribute("href"),
            window.location.origin
          ).pathname;
          var match = path.match(routePattern);
          if (match) return decodeURIComponent(match[1]);
        } catch (_error) {
          // Ignore malformed or non-navigation links and keep looking.
        }
      }
      node = node.parentElement;
    }
    return null;
  }

  function markerIdFromSelectionCheckbox(checkbox) {
    var node = checkbox;
    var pattern = /\/scene_marker\/([^/?#]+)\//;
    while (node && node !== document.body) {
      if (node !== checkbox && node.matches(
        ".marker-wall, main, .sidebar-pane-content"
      )) break;

      var media = node.querySelectorAll
        ? node.querySelectorAll('[src*="/scene_marker/"]')
        : [];
      for (var index = 0; index < media.length; index += 1) {
        var match = String(media[index].getAttribute("src") || "").match(pattern);
        if (match) return decodeURIComponent(match[1]);
      }
      node = node.parentElement;
    }
    return null;
  }

  function idFromSelectionCheckbox(checkbox, kind) {
    if (kind === "marker") return markerIdFromSelectionCheckbox(checkbox);
    return idFromLinkedItem(checkbox, kind === "image" ? "images" : "scenes");
  }

  function selectedItems() {
    var kind = currentItemKind();
    var ids = [];
    var seen = Object.create(null);
    if (!kind) return { kind: null, ids: [], singular: "item", plural: "items" };

    document.querySelectorAll("input[type=checkbox]:checked").forEach(function (checkbox) {
      var id = idFromSelectionCheckbox(checkbox, kind);
      if (id && !seen[id]) {
        seen[id] = true;
        ids.push(id);
      }
    });
    return {
      kind: kind,
      ids: ids,
      singular: kind,
      plural: kind === "image" ? "images" : kind + "s",
    };
  }

  function ensureButton() {
    if (state.button && state.button.isConnected) return state.button;

    var button = document.createElement("button");
    button.type = "button";
    button.className = "extract-scenes-action btn btn-primary dirty-ui-button";
    button.hidden = true;
    button.setAttribute("aria-live", "polite");
    button.addEventListener("click", onActionClick);
    document.body.appendChild(button);
    state.button = button;
    return button;
  }

  function positionButton(button) {
    var toolbars = document.querySelectorAll(".filtered-list-toolbar.has-selection");
    var toolbar = null;
    for (var index = 0; index < toolbars.length; index += 1) {
      var candidateRect = toolbars[index].getBoundingClientRect();
      if (candidateRect.width > 0 && candidateRect.height > 0 &&
          candidateRect.bottom > 0 && candidateRect.top < window.innerHeight) {
        toolbar = toolbars[index];
        break;
      }
    }
    if (!toolbar) return false;

    var toolbarRect = toolbar.getBoundingClientRect();
    var buttonRect = button.getBoundingClientRect();
    var gap = 8;
    var margin = 15;
    var maxLeft = Math.max(margin, window.innerWidth - buttonRect.width - margin);
    var left = toolbarRect.right + gap;
    var top = toolbarRect.top + (toolbarRect.height - buttonRect.height) / 2;

    if (left > maxLeft) {
      var leftOfToolbar = toolbarRect.left - gap - buttonRect.width;
      if (leftOfToolbar >= margin) {
        left = leftOfToolbar;
      } else {
        left = Math.min(Math.max(toolbarRect.left, margin), maxLeft);
        top = toolbarRect.bottom + gap;
      }
    }

    button.style.left = Math.round(left) + "px";
    button.style.top = Math.max(margin, Math.round(top)) + "px";
    return true;
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
    picker.status.textContent = message || "";
    picker.status.classList.toggle("dirty-ui-text-error", Boolean(isError));
  }

  function renderDirectory(picker, directory) {
    picker.currentPath = directory.path;
    picker.pathInput.value = directory.path;
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

    directories.forEach(function (path) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "dirty-file-extractor-folder btn btn-link";
      button.title = path;
      button.textContent = pickerPathLabel(path);
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
    document.removeEventListener("keydown", onPickerKeydown);
    if (state.picker && state.picker.backdrop.parentNode) {
      state.picker.backdrop.parentNode.removeChild(state.picker.backdrop);
    }
    state.picker = null;
  }

  function onPickerKeydown(event) {
    if (event.key === "Escape") closeFolderPicker();
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
    pathBar.appendChild(pathInput);

    var goButton = document.createElement("button");
    goButton.type = "button";
    goButton.className = "btn btn-secondary dirty-ui-button";
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
    closeFolderPicker();
    var picker = createFolderPicker();
    state.picker = picker;
    document.body.appendChild(picker.backdrop);
    document.addEventListener("keydown", onPickerKeydown);

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

  function renderButton() {
    if (state.destroyed) return;
    var button = ensureButton();
    var selection = selectedItems();
    var count = selection.ids.length;

    if (state.busy) {
      button.hidden = false;
      button.disabled = true;
      if (button.textContent !== "Queuing extraction\u2026") {
        button.textContent = "Queuing extraction\u2026";
      }
      button.hidden = !positionButton(button);
      return;
    }

    button.disabled = false;
    var shouldShow = Boolean(selection.kind) && count > 0;
    button.hidden = !shouldShow;
    if (!shouldShow) return;

    var label = count === 1
      ? "Extract selected " + selection.singular
      : "Extract " + count + " selected " + selection.plural;
    if (button.textContent !== label) button.textContent = label;
    button.hidden = !positionButton(button);
  }

  function scheduleRender() {
    if (state.destroyed || state.frame !== null) return;
    state.frame = window.requestAnimationFrame(function () {
      state.frame = null;
      renderButton();
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
    renderButton();
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
        scheduleRender();
      });
  }

  function onActionClick(event) {
    event.preventDefault();
    startCopy(selectedItems());
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
    window.removeEventListener("resize", scheduleRender);
    window.removeEventListener("scroll", scheduleRender, true);
    if (state.observer) state.observer.disconnect();
    if (state.frame !== null) window.cancelAnimationFrame(state.frame);
    if (state.button) {
      state.button.removeEventListener("click", onActionClick);
      if (state.button.parentNode) state.button.parentNode.removeChild(state.button);
    }
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

  document.addEventListener("change", onDocumentChange, true);
  window.addEventListener("popstate", scheduleRender);
  window.addEventListener("hashchange", scheduleRender);
  window.addEventListener("resize", scheduleRender);
  window.addEventListener("scroll", scheduleRender, { capture: true, passive: true });

  // The observer only reads Stash's DOM and updates our body-level button. It
  // never inserts into, replaces, or patches any React-owned element.
  state.observer = new MutationObserver(scheduleRender);
  state.observer.observe(document.body, { childList: true, subtree: true });

  window[INSTANCE_KEY] = { destroy: destroy };
  registerHubFieldAction();
  scheduleRender();
})();
