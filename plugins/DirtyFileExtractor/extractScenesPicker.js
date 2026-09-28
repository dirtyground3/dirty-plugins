// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyFileExtractorPicker";
  if (window[INSTANCE_KEY]) return;

  /** @param {{state: object, hubApi: object, getSettings: Function, notify: Function, pluginId: string}} dependencies */
  function createPicker(dependencies) {
    var state = dependencies.state;
    var hubApi = dependencies.hubApi;
    var getSettings = dependencies.getSettings;
    var notify = dependencies.notify;
    var PLUGIN_ID = dependencies.pluginId;

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

    return { openFolderPicker: openFolderPicker, closeFolderPicker: closeFolderPicker };
  }

  window[INSTANCE_KEY] = { createPicker: createPicker };
})();
