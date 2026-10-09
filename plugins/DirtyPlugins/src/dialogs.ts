var toastContainer: HTMLDivElement | null = null;
var bodyScrollLocks = 0;
var activeDialogs: { dialog: HTMLElement; }[] = [];
import type { DialogOptions, NotifyOptions } from "./types";
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
  var settings = typeof options === "string" ? { tone: options } : (options || {});
  var tone = settings.tone || "success";
  var container = ensureToastContainer();
  var toast = document.createElement("div");
  toast.className = "dirty-ui-toast dirty-ui-tone-" + tone;
  toast.setAttribute("role", tone === "error" ? "alert" : "status");
  toast.textContent = message;
  container.appendChild(toast);
  window.setTimeout(function() {
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
  var items = Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex="0"]'))
    .filter(function(item) { return !(item as HTMLButtonElement).disabled && item.getClientRects().length; });
  if (!items.length) { event.preventDefault(); dialog.focus(); return; }
  var first = items[0], last = items[items.length - 1];
  if (!dialog.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
  else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

export function lockBodyScroll() {
  if (!document.body || !document.body.classList) return function() { };
  bodyScrollLocks += 1;
  document.body.classList.add("dirty-ui-modal-open");
  var released = false;
  return function() {
    if (released) return;
    released = true;
    bodyScrollLocks = Math.max(0, bodyScrollLocks - 1);
    if (!bodyScrollLocks) document.body.classList.remove("dirty-ui-modal-open");
  };
}

export function manageDialog(options: DialogOptions) {
  var dialog = options && options.dialog;
  if (!dialog) return function() { };
  var opener = options.opener || document.activeElement;
  var unlockScroll = lockBodyScroll();
  var entry = { dialog: dialog };
  var released = false;
  activeDialogs.push(entry);

  function nativePopupIsActive() {
    if (!options.allowNativePopup || !document.querySelectorAll) return false;
    return Array.prototype.some.call(document.querySelectorAll('.modal.show, .dropdown-menu.show, [role="dialog"][aria-modal="true"]'), function(popup) {
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
  var initial = options.initialFocus;
  if (typeof initial === "function") initial = initial();
  if (!initial && dialog.querySelector) initial = dialog.querySelector<HTMLElement>('button, input, select, textarea, a[href], [tabindex="0"]');
  if (initial && typeof initial.focus === "function") initial.focus();
  else if (typeof dialog.focus === "function") dialog.focus();
  return function() {
    if (released) return;
    released = true;
    if (document.removeEventListener) document.removeEventListener("keydown", onKeydown, true);
    var index = activeDialogs.indexOf(entry);
    if (index !== -1) activeDialogs.splice(index, 1);
    unlockScroll();
    if (opener && opener.isConnected !== false && typeof (opener as HTMLElement).focus === "function") (opener as HTMLElement).focus();
  };
}
