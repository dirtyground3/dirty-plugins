import type * as R from "react";
import { manageDialog } from "../dialogs";
import { PluginApi, React } from "../runtime";
import type { DialogProps } from "../types";
export function Dialog(props: DialogProps) {
  const dialog = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (props.open === false) return;
    return manageDialog({
      dialog: dialog.current,
      initialFocus: props.initialFocusRef && props.initialFocusRef.current,
      opener: props.openerRef && props.openerRef.current,
      onClose: props.onClose,
      allowNativePopup: props.allowNativePopup,
    });
  }, [props.open]);
  function closeFromBackdrop(event: R.MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && props.onClose) props.onClose();
  }
  const content = (
    <div
      className={props.backdropClassName || "dirty-ui-backdrop"}
      style={props.open === false ? { display: "none" } : undefined}
      onMouseDown={closeFromBackdrop}
    >
      {props.backdrop}
      <section
        ref={dialog}
        id={props.id}
        className={props.className || "dirty-ui-dialog"}
        role="dialog"
        aria-modal={true}
        aria-label={props.ariaLabel}
        aria-labelledby={props.labelledBy}
        tabIndex={-1}
      >
        {props.children}
      </section>
    </div>
  );
  return PluginApi.ReactDOM && PluginApi.ReactDOM.createPortal
    ? PluginApi.ReactDOM.createPortal(content, document.body)
    : content;
}
