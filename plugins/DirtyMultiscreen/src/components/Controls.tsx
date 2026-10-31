import type { SharedProps } from "../../../DirtyPlugins/src/types";
import { DirtyPlugins, PluginApi, React } from "../runtime";
/** Current Font Awesome names first, then the names older Stash versions ship. */
const ICON_NAMES = {
  close: ["faXmark", "faTimes"],
  error: ["faTriangleExclamation", "faExclamationTriangle"],
  next: ["faForwardStep", "faStepForward"],
  oCounter: ["faDroplet", "faTint"],
  previous: ["faBackwardStep", "faStepBackward"],
  reload: ["faRotateRight", "faRedo"],
  search: ["faMagnifyingGlass", "faSearch"],
  shuffle: ["faShuffle", "faRandom"],
  success: ["faCheck", "faCheck"],
};
export function icon(name: keyof typeof ICON_NAMES) {
  const icons = PluginApi.libraries.FontAwesomeSolid ?? {},
    [current, legacy] = ICON_NAMES[name];
  return icons[current] ?? icons[legacy];
}
export function PluginIconButton(props: SharedProps) {
  return <DirtyPlugins.react.IconButton {...props} className="ms-button" />;
}
export function StateView({ detail, onRetry, title }: { detail?: string; onRetry?: () => void; title: string }) {
  return (
    <DirtyPlugins.react.StateView
      className="ms-state"
      detail={detail}
      title={title}
      actions={
        onRetry ? (
          <PluginIconButton ariaLabel="Retry" fallback="reload" icon={icon("reload")} onClick={onRetry} />
        ) : null
      }
    />
  );
}
