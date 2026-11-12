import type { SharedProps } from "../../../DirtyPlugins/src/types";
import { DirtyPlugins, PluginApi, React } from "../runtime";
/** Current Font Awesome names first, then the names older Stash versions ship. */
const ICON_NAMES = {
  add: ["faPlus", "faPlus"],
  close: ["faXmark", "faTimes"],
  edit: ["faTableCellsLarge", "faThLarge"],
  error: ["faTriangleExclamation", "faExclamationTriangle"],
  fill: ["faExpand", "faExpand"],
  flipX: ["faLeftRight", "faArrowsAltH"],
  flipY: ["faUpDown", "faArrowsAltV"],
  loop: ["faRepeat", "faRetweet"],
  move: ["faUpDownLeftRight", "faArrowsAlt"],
  next: ["faForwardStep", "faStepForward"],
  oCounter: ["faDroplet", "faTint"],
  overwrite: ["faFloppyDisk", "faSave"],
  previous: ["faBackwardStep", "faStepBackward"],
  reload: ["faRotateRight", "faRedo"],
  remove: ["faTrash", "faTrash"],
  rename: ["faPen", "faPen"],
  rotate: ["faRotateRight", "faRedo"],
  scene: ["faArrowUpRightFromSquare", "faExternalLinkAlt"],
  saved: ["faBookmark", "faBookmark"],
  search: ["faMagnifyingGlass", "faSearch"],
  shuffle: ["faShuffle", "faRandom"],
  success: ["faCheck", "faCheck"],
};
export function icon(name: keyof typeof ICON_NAMES) {
  const icons = PluginApi.libraries.FontAwesomeSolid ?? {},
    [current, legacy] = ICON_NAMES[name];
  return icons[current] ?? icons[legacy];
}
type IconDefinition = { icon?: [number, number, unknown, unknown, string | string[]] };
/** Several drops for every visible scene; Font Awesome has a single one. */
export function DropsGlyph() {
  const drop = icon("oCounter") as IconDefinition | undefined;
  if (!drop?.icon) return <>OO</>;
  const [width, height, , , path] = drop.icon;
  const d = Array.isArray(path) ? path.join(" ") : path;
  // On a 512-unit square: one large drop and two smaller ones beside it.
  const drops = [
    { x: 0, y: 128, size: 384 },
    { x: 250, y: 0, size: 240 },
    { x: 330, y: 250, size: 200 },
  ];
  return (
    <svg className="svg-inline--fa ms-drops-icon" viewBox="0 0 512 512" aria-hidden="true" focusable="false">
      {drops.map(({ x, y, size }) => (
        <path
          key={x}
          d={d}
          fill="currentColor"
          transform={`translate(${x + (size - (size * width) / height) / 2} ${y}) scale(${size / height})`}
        />
      ))}
    </svg>
  );
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
