import { createFolderPicker } from "./pickerView";
import { pickerPathLabel } from "./domain/selection";
import type { Directory, OpenEvent, Picker, PickerDependencies } from "./types";

export function createPicker({ state, hubApi, getSettings, notify, pluginId }: PickerDependencies) {
  const captureEnabled = () => Boolean(hubApi.captureEnabled?.(window.location.search));
  const active = (picker: Picker) => !state.destroyed && state.picker === picker;
  function setPickerStatus(picker: Picker, message: string, isError: boolean) {
    picker.status.textContent = isError && captureEnabled() ? "Folder unavailable during documentation capture." : message;
    picker.status.classList.toggle("dirty-ui-text-error", isError);
  }
  function renderDirectory(picker: Picker, directory: Directory) {
    const docsCapture = captureEnabled();
    picker.currentPath = directory.path; picker.parentPath = directory.parent || null;
    picker.pathInput.value = docsCapture ? "Path hidden for documentation" : directory.path;
    picker.upButton.disabled = !directory.parent; picker.useButton.disabled = false; picker.list.textContent = "";
    const directories = Array.isArray(directory.directories) ? directory.directories : [];
    if (!directories.length) {
      const empty = document.createElement("div"); empty.className = "dirty-file-extractor-picker-empty";
      empty.textContent = "No subfolders"; picker.list.appendChild(empty);
    }
    directories.forEach((path, index) => {
      const button = document.createElement("button"); button.type = "button"; button.className = "dirty-file-extractor-folder btn btn-link";
      button.title = docsCapture ? "Open subfolder" : path; button.textContent = docsCapture ? "Folder " + (index + 1) : pickerPathLabel(path);
      button.addEventListener("click", () => { void loadDirectory(picker, path, false); }); picker.list.appendChild(button);
    });
    setPickerStatus(picker, directories.length + " subfolder" + (directories.length === 1 ? "" : "s"), false);
  }
  async function loadDirectory(picker: Picker, path: string | null, fallbackToHome: boolean): Promise<void> {
    if (!active(picker)) return;
    const requestId = ++state.pickerRequest;
    picker.useButton.disabled = true; picker.list.textContent = ""; setPickerStatus(picker, "Loading folders…", false);
    try {
      const data = await hubApi.graphql<{ directory: Directory }>(
        "query DirtyFileExtractorDirectory($path:String){directory(path:$path){path parent directories}}", { path: path || null });
      if (active(picker) && requestId === state.pickerRequest) renderDirectory(picker, data.directory);
    } catch (error) {
      if (!active(picker) || requestId !== state.pickerRequest) return;
      if (fallbackToHome && path) {
        setPickerStatus(picker, "Saved folder is unavailable; showing the home folder.", true);
        await loadDirectory(picker, null, false);
      } else setPickerStatus(picker, error instanceof Error ? error.message : String(error), true);
    }
  }
  function closeFolderPicker() {
    state.pickerRequest += 1; const picker = state.picker; state.picker = null;
    picker?.backdrop.parentNode?.removeChild(picker.backdrop); picker?.releaseDialog?.();
  }
  async function saveDestinationFolder(picker: Picker): Promise<void> {
    if (!active(picker) || !picker.currentPath || picker.useButton.disabled) return;
    const destinationFolder = picker.currentPath;
    picker.useButton.disabled = true; setPickerStatus(picker, "Saving destination…", false);
    try {
      const settings = await getSettings();
      if (!active(picker)) return;
      await hubApi.configurePlugin(pluginId, { ...settings, destinationFolder });
      // A completed save must never close a newer dialog or notify after teardown.
      if (!state.destroyed) hubApi.notifyConfigurationChanged?.(pluginId);
      if (active(picker)) { closeFolderPicker(); notify("Destination folder saved.", false); }
    } catch (error) {
      if (active(picker)) { setPickerStatus(picker, error instanceof Error ? error.message : String(error), true); picker.useButton.disabled = false; }
    }
  }
  function openFolderPicker(event: OpenEvent) {
    event.preventDefault(); if (state.destroyed) return;
    const opener = event.currentTarget instanceof HTMLElement ? event.currentTarget : document.activeElement;
    closeFolderPicker();
    const picker = createFolderPicker({ closeFolderPicker, loadDirectory, saveDestinationFolder }, captureEnabled());
    state.picker = picker; document.body.appendChild(picker.backdrop);
    picker.releaseDialog = hubApi.ui.manageDialog({ dialog: picker.dialog, initialFocus: picker.closeButton, onClose: closeFolderPicker, opener });
    void getSettings().then(settings => {
      if (active(picker)) return loadDirectory(picker, String(settings.destinationFolder || "").trim() || null, true);
    }).catch(error => { if (active(picker)) setPickerStatus(picker, error instanceof Error ? error.message : String(error), true); });
  }
  return { openFolderPicker, closeFolderPicker, loadDirectory, saveDestinationFolder };
}
