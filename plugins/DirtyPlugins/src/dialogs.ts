import type { DialogOptions, NotifyOptions } from "./types";
const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex="0"]';
let toastContainer: HTMLDivElement | null = null;
let bodyScrollLocks = 0;
const activeDialogs: { dialog: HTMLElement; }[] = [];
function ensureToastContainer() {
  if (toastContainer && toastContainer.isConnected) return toastContainer;
  toastContainer = document.createElement("div");
  toastContainer.className = "dirty-ui-toast-container";
  toastContainer.setAttribute("aria-live", "polite");
  toastContainer.setAttribute("aria-atomic", "false");
  document.body.appendChild(toastContainer);
  return toastContainer;
}

export function notify(message: string, options?: NotifyOptions | string) {
  const settings = typeof options === "string" ? { tone: options } : (options || {});
  const tone = settings.tone || "success";
  const container = ensureToastContainer();
  const toast = document.createElement("div");
  toast.className = "dirty-ui-toast dirty-ui-tone-" + tone;
  toast.setAttribute("role", tone === "error" ? "alert" : "status");
  toast.textContent = message;
  container.appendChild(toast);
  window.setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
    if (container.childElementCount === 0 && container.parentNode) {
      container.parentNode.removeChild(container);
      if (toastContainer === container) toastContainer = null;
    }
  }, settings.duration || (tone === "error" ? 8000 : 5000));
  return toast;
}

export function trapDialogTab(event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">, dialog: HTMLElement | null) {
  if (event.key !== "Tab" || !dialog) return;
  const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter(item => !(item as HTMLButtonElement).disabled && item.getClientRects().length);
  if (!items.length) { event.preventDefault(); dialog.focus(); return; }
  const first = items[0], last = items[items.length - 1];
  if (!dialog.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
  else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

export function lockBodyScroll() {
  if (!document.body || !document.body.classList) return () => { };
  bodyScrollLocks += 1;
  document.body.classList.add("dirty-ui-modal-open");
  let released = false;
  return () => {
    if (released) return;
    released = true;
    bodyScrollLocks = Math.max(0, bodyScrollLocks - 1);
    if (!bodyScrollLocks) document.body.classList.remove("dirty-ui-modal-open");
  };
}

export function manageDialog(options: DialogOptions) {
  const dialog = options && options.dialog;
  if (!dialog) return () => { };
  const opener = options.opener || document.activeElement;
  const unlockScroll = lockBodyScroll();
  const entry = { dialog };
  let released = false;
  activeDialogs.push(entry);

  function nativePopupIsActive() {
    if (!options.allowNativePopup || !document.querySelectorAll) return false;
    return Array.prototype.some.call(document.querySelectorAll('.modal.show, .dropdown-menu.show, [role="dialog"][aria-modal="true"]'), popup => {
      return popup !== dialog &&
        (popup.classList && popup.classList.contains("show") ||
          !dialog!.contains(popup) && popup.contains(document.activeElement));
    });
  }
  function onKeydown(event: KeyboardEvent) {
    if (activeDialogs[activeDialogs.length - 1] !== entry || nativePopupIsActive()) return;
    if (event.key === "Escape") {
      if (options.onClose) { event.preventDefault(); options.onClose(); }
    } else {
      trapDialogTab(event, dialog);
    }
  }

  if (document.addEventListener) document.addEventListener("keydown", onKeydown, true);
  let initial = options.initialFocus;
  if (typeof initial === "function") initial = initial();
  if (!initial && dialog.querySelector) initial = dialog.querySelector<HTMLElement>(FOCUSABLE);
  if (initial && typeof initial.focus === "function") initial.focus();
  else if (typeof dialog.focus === "function") dialog.focus();
  return () => {
    if (released) return;
    released = true;
    if (document.removeEventListener) document.removeEventListener("keydown", onKeydown, true);
    const index = activeDialogs.indexOf(entry);
    if (index !== -1) activeDialogs.splice(index, 1);
    unlockScroll();
    if (opener && opener.isConnected !== false && typeof (opener as HTMLElement).focus === "function") (opener as HTMLElement).focus();
  };
}
