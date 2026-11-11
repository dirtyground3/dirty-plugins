import { captureEnabled } from "./capture";
import { manageDialog } from "./dialogs";
import { loggedGraphql } from "./transport";

/** A server folder chooser over Stash's directory query; one is open at a time. */
export interface FolderPickerOptions {
  /** Dialog heading, such as "Choose destination folder". */
  title: string;
  /** The folder to open first; the home folder when empty or unavailable. */
  initialPath?(): Promise<string | null | undefined> | string | null | undefined;
  /** Focus returns here when the dialog closes. */
  opener?: Element | null;
  /** Receives the chosen folder. A rejection keeps the dialog open and shows its message. */
  onSelect(path: string): Promise<void> | void;
}
interface Directory {
  path: string;
  parent?: string | null;
  directories?: string[];
}

let closeOpen: (() => void) | null = null;

/** The last path segment, as the folder list shows it. */
export function folderLabel(path: string | null): string {
  const parts = String(path || "")
    .split(/[\\/]/)
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(path || "Computer");
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = "") {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}
function within(parent: HTMLElement, ...children: HTMLElement[]) {
  for (const child of children) parent.appendChild(child);
}
function button(className: string, text: string) {
  const element = node("button", className, text);
  element.type = "button";
  return element;
}

export function pickFolder(options: FolderPickerOptions) {
  closeOpen?.();
  const capture = () => Boolean(captureEnabled(window.location.search));
  let open = true,
    request = 0,
    currentPath: string | null = null,
    parentPath: string | null = null;
  const backdrop = node("div", "dirty-ui-folder-picker-backdrop dirty-ui-backdrop");
  const dialog = node("div", "dirty-ui-folder-picker dirty-ui-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "dirty-ui-folder-picker-title");
  dialog.tabIndex = -1;
  backdrop.appendChild(dialog);
  const header = node("div", "dirty-ui-folder-picker-header");
  const title = node("h3", "", options.title);
  title.id = "dirty-ui-folder-picker-title";
  const closeButton = button("close dirty-ui-icon-button", "×");
  closeButton.setAttribute("aria-label", "Close folder picker");
  within(header, title, closeButton);
  const pathBar = node("div", "dirty-ui-folder-picker-path input-group");
  const upButton = button("btn btn-secondary dirty-ui-button", "Up");
  const pathInput = node("input", "form-control");
  pathInput.type = "text";
  pathInput.setAttribute("aria-label", "Folder path");
  pathInput.disabled = capture();
  const goButton = button("btn btn-secondary dirty-ui-button", "Go");
  goButton.disabled = capture();
  within(pathBar, upButton, pathInput, goButton);
  const list = node("div", "dirty-ui-folder-picker-list");
  const status = node("div", "dirty-ui-folder-picker-status");
  status.setAttribute("aria-live", "polite");
  const footer = node("div", "dirty-ui-folder-picker-footer");
  const cancelButton = button("btn btn-secondary dirty-ui-button", "Cancel");
  const useButton = button("btn btn-primary dirty-ui-button", "Use this folder");
  within(footer, cancelButton, useButton);
  within(dialog, header, pathBar, list, status, footer);

  function setStatus(message: string, isError: boolean) {
    status.textContent = isError && capture() ? "Folder unavailable during documentation capture." : message;
    status.classList.toggle("dirty-ui-text-error", isError);
  }
  function render(directory: Directory) {
    const hidden = capture();
    currentPath = directory.path;
    parentPath = directory.parent || null;
    pathInput.value = hidden ? "Path hidden for documentation" : directory.path;
    upButton.disabled = !directory.parent;
    useButton.disabled = false;
    list.textContent = "";
    const directories = Array.isArray(directory.directories) ? directory.directories : [];
    if (!directories.length) list.appendChild(node("div", "dirty-ui-folder-picker-empty", "No subfolders"));
    directories.forEach((path, index) => {
      const folder = button(
        "dirty-ui-folder-picker-folder btn btn-link",
        hidden ? "Folder " + (index + 1) : folderLabel(path),
      );
      folder.title = hidden ? "Open subfolder" : path;
      folder.addEventListener("click", () => void load(path, false));
      list.appendChild(folder);
    });
    setStatus(directories.length + " subfolder" + (directories.length === 1 ? "" : "s"), false);
  }
  async function load(path: string | null, fallbackToHome: boolean): Promise<void> {
    if (!open) return;
    const id = ++request;
    useButton.disabled = true;
    list.textContent = "";
    setStatus("Loading folders…", false);
    try {
      const data = await loggedGraphql<{ directory: Directory }>(
        "query DirtyPluginsDirectory($path:String){directory(path:$path){path parent directories}}",
        { path: path || null },
      );
      if (open && id === request) render(data.directory);
    } catch (error) {
      if (!open || id !== request) return;
      if (fallbackToHome && path) {
        setStatus("Saved folder is unavailable; showing the home folder.", true);
        await load(null, false);
      } else setStatus(error instanceof Error ? error.message : String(error), true);
    }
  }
  async function choose() {
    if (!open || !currentPath || useButton.disabled) return;
    useButton.disabled = true;
    setStatus("Saving…", false);
    try {
      await options.onSelect(currentPath);
      // A completed choice must never close a newer dialog.
      if (open) close();
    } catch (error) {
      if (open) {
        setStatus(error instanceof Error ? error.message : String(error), true);
        useButton.disabled = false;
      }
    }
  }
  const go = () => void load(pathInput.value.trim(), false);
  closeButton.addEventListener("click", () => close());
  cancelButton.addEventListener("click", () => close());
  upButton.addEventListener("click", () => {
    if (parentPath) void load(parentPath, false);
  });
  goButton.addEventListener("click", go);
  pathInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      go();
    }
  });
  useButton.addEventListener("click", () => void choose());
  backdrop.addEventListener("click", event => {
    if (event.target === backdrop) close();
  });

  document.body.appendChild(backdrop);
  const release = manageDialog({
    dialog,
    initialFocus: closeButton,
    onClose: () => close(),
    opener: options.opener || document.activeElement,
  });
  function close() {
    if (!open) return;
    open = false;
    request += 1;
    if (closeOpen === close) closeOpen = null;
    backdrop.parentNode?.removeChild(backdrop);
    release();
  }
  closeOpen = close;
  void Promise.resolve()
    .then(() => options.initialPath?.())
    .then(path => load(String(path || "").trim() || null, true))
    .catch(error => {
      if (open) setStatus(error instanceof Error ? error.message : String(error), true);
    });
}
