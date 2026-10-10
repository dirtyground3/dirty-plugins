import type { Picker, PickerActions } from "./types";

/** The hub owns dialog focus/scroll. This view owns only its DOM nodes. */
export function createFolderPicker(actions: PickerActions, docsCapture: boolean): Picker {
  function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = "") {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }
  function button(className: string, text: string) {
    const element = node("button", className, text);
    element.type = "button";
    return element;
  }
  const backdrop = node("div", "dirty-file-extractor-picker-backdrop dirty-ui-backdrop");
  const dialog = node("div", "dirty-file-extractor-picker-dialog dirty-ui-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "dirty-file-extractor-picker-title");
  dialog.tabIndex = -1;
  backdrop.appendChild(dialog);
  const header = node("div", "dirty-file-extractor-picker-header");
  dialog.appendChild(header);
  const title = node("h3", "", "Choose destination folder");
  title.id = "dirty-file-extractor-picker-title";
  header.appendChild(title);
  const closeButton = button("close dirty-ui-icon-button", "×");
  closeButton.setAttribute("aria-label", "Close folder picker");
  closeButton.addEventListener("click", actions.closeFolderPicker);
  header.appendChild(closeButton);
  const pathBar = node("div", "dirty-file-extractor-picker-path input-group");
  dialog.appendChild(pathBar);
  const upButton = button("btn btn-secondary dirty-ui-button", "Up");
  pathBar.appendChild(upButton);
  const pathInput = node("input", "form-control");
  pathInput.type = "text";
  pathInput.setAttribute("aria-label", "Folder path");
  pathInput.disabled = docsCapture;
  pathBar.appendChild(pathInput);
  const goButton = button("btn btn-secondary dirty-ui-button", "Go");
  goButton.disabled = docsCapture;
  pathBar.appendChild(goButton);
  const list = node("div", "dirty-file-extractor-picker-list");
  dialog.appendChild(list);
  const status = node("div", "dirty-file-extractor-picker-status");
  status.setAttribute("aria-live", "polite");
  dialog.appendChild(status);
  const footer = node("div", "dirty-file-extractor-picker-footer");
  dialog.appendChild(footer);
  const cancelButton = button("btn btn-secondary dirty-ui-button", "Cancel");
  cancelButton.addEventListener("click", actions.closeFolderPicker);
  footer.appendChild(cancelButton);
  const useButton = button("btn btn-primary dirty-ui-button", "Use this folder");
  footer.appendChild(useButton);
  const picker: Picker = {
    backdrop,
    dialog,
    closeButton,
    currentPath: null,
    parentPath: null,
    list,
    pathInput,
    status,
    upButton,
    useButton,
  };
  upButton.addEventListener("click", () => {
    if (picker.parentPath) void actions.loadDirectory(picker, picker.parentPath, false);
  });
  const go = () => {
    void actions.loadDirectory(picker, pathInput.value.trim(), false);
  };
  goButton.addEventListener("click", go);
  pathInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      go();
    }
  });
  useButton.addEventListener("click", () => {
    void actions.saveDestinationFolder(picker);
  });
  backdrop.addEventListener("click", event => {
    if (event.target === backdrop) actions.closeFolderPicker();
  });
  return picker;
}
