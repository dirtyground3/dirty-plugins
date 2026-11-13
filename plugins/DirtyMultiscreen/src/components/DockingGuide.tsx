import type { Edge } from "../domain/custom";
import type { DropTarget } from "../domain/dropGuide";
import type { Rectangle } from "../domain/layout";
import { DirtyPlugins, React } from "../runtime";
import { icon } from "./Controls";

export interface DockingGuideState {
  targets: readonly DropTarget[];
  active: DropTarget | undefined;
}

const arrows: Record<Edge, string> = { top: "↑", right: "→", bottom: "↓", left: "←" };
const beside: Record<Edge, string> = { top: "above", right: "right of", bottom: "below", left: "left of" };

/** The drag owns the pointer. These marks show exactly where releasing it will perform an action. */
export function DockingGuide({
  guide,
  previews,
  source,
  positions,
}: {
  guide: DockingGuideState;
  previews: readonly Rectangle[];
  source: number;
  positions: readonly number[];
}) {
  const zone = guide.active?.zone;
  // Nothing is named until the pointer is on a target.
  const label = !zone
    ? ""
    : zone.side === "center"
      ? `Swap screens ${positions[source] + 1} and ${positions[zone.target] + 1}`
      : zone.target === "grid"
        ? `Dock to the ${zone.side} of the grid`
        : `Dock ${beside[zone.side]} screen ${positions[zone.target] + 1}`;
  return (
    <div className="ms-docking-guide">
      {previews.map((box, index) => (
        <div key={index} className="ms-drop-preview" style={box} aria-hidden="true" />
      ))}
      {label && (
        <div className="ms-drop-status" role="status">
          {label}
        </div>
      )}
      {guide.targets.map(target => {
        const { zone, box } = target;
        return (
          <div
            key={`${zone.target}:${zone.side}`}
            className="ms-drop-target"
            data-ms-drop-pane={zone.target}
            data-ms-drop-side={zone.side}
            data-ms-drop-active={target === guide.active ? "" : undefined}
            style={{ ...box, fontSize: Math.max(10, Math.min(16, Math.min(box.width, box.height) * 0.45)) }}
            aria-hidden="true"
          >
            {zone.side === "center" ? <DirtyPlugins.react.Glyph icon={icon("swap")} fallback="⇄" /> : arrows[zone.side]}
          </div>
        );
      })}
    </div>
  );
}
