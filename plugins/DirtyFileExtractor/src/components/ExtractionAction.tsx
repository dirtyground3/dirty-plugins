import { React, PluginApi } from "../runtime";
import { selectionLabel } from "../domain/selection";
import type { Selection } from "../types";
import type { ExtractionController } from "../extraction";
export interface ActionProps {
  selection: Selection;
  controller: ExtractionController;
}
export function ExtractionAction({ selection, controller }: ActionProps) {
  const [, render] = React.useState(0);
  const [menu, setMenu] = React.useState<HTMLElement | null>(null);
  const anchor = React.useRef<HTMLSpanElement>(null),
    normalToolbarWidth = React.useRef(0);
  const currentToolbar = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => controller.subscribe(() => render(value => value + 1)), []);
  React.useEffect(() => {
    const root = anchor.current?.parentElement;
    if (!root) return;
    function syncToolbar() {
      const toolbar = root!.querySelector<HTMLElement>(".filtered-list-toolbar");
      if (currentToolbar.current && currentToolbar.current !== toolbar) {
        currentToolbar.current.style.minWidth = "";
        currentToolbar.current.style.justifyContent = "";
      }
      currentToolbar.current = toolbar;
      if (toolbar?.classList.contains("has-selection")) {
        if (normalToolbarWidth.current) {
          toolbar.style.minWidth = Math.min(normalToolbarWidth.current, root!.clientWidth) + "px";
          toolbar.style.justifyContent = "flex-start";
        }
      } else if (toolbar) {
        toolbar.style.minWidth = "";
        toolbar.style.justifyContent = "";
        normalToolbarWidth.current = toolbar.getBoundingClientRect().width;
      }
      const toggle = toolbar?.querySelector<HTMLButtonElement>(
        '.list-operations.dropdown button[aria-haspopup="true"][aria-expanded="true"]',
      );
      const next = toggle
        ? document.querySelector<HTMLElement>('.dropdown-menu.show[aria-labelledby="' + toggle.id + '"]')
        : null;
      setMenu(current => (current === next ? current : next));
    }
    syncToolbar();
    const observer = new MutationObserver(syncToolbar);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["aria-expanded", "class"],
      childList: true,
      subtree: true,
    });
    // Stash portals the dropdown to document.body.
    observer.observe(document.body, { childList: true });
    window.addEventListener("resize", syncToolbar);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncToolbar);
      if (currentToolbar.current) {
        currentToolbar.current.style.minWidth = "";
        currentToolbar.current.style.justifyContent = "";
      }
    };
  }, []);
  function extract() {
    anchor.current?.parentElement
      ?.querySelector<HTMLButtonElement>(
        '.filtered-list-toolbar.has-selection .list-operations.dropdown button[aria-expanded="true"]',
      )
      ?.click();
    controller.startCopy(selection);
  }
  const action = (
    <button
      type="button"
      className="bg-secondary text-white dropdown-item dirty-file-extractor-menu-action"
      disabled={controller.state.busy}
      onClick={extract}
    >
      {selectionLabel(selection, controller.state.busy)}
    </button>
  );
  return (
    <React.Fragment>
      <span className="dirty-file-extractor-action-anchor" ref={anchor} />
      {selection.ids.length && menu?.isConnected ? PluginApi.ReactDOM.createPortal(action, menu) : null}
    </React.Fragment>
  );
}
