import { options } from "@generated/multiscreen.settings";
import { DirtyPlugins, React } from "../runtime";
import type { SceneOrder } from "../types";
import { icon } from "./Controls";

/** One round button: choosing an order reshuffles every screen with it; the current order is checked. */
export function ShuffleMenu({ order, onShuffle }: { order: SceneOrder; onShuffle(order: SceneOrder): void }) {
  return (
    <DirtyPlugins.react.ActionMenu
      className="ms-shuffle-menu"
      ariaLabel="Reshuffle scenes"
      label={<DirtyPlugins.react.Glyph icon={icon("shuffle")} fallback="⇄" />}
      items={[
        { header: "Reshuffle with" },
        ...options.sceneOrder.map(option => ({
          key: option.value,
          label: (
            <React.Fragment>
              <span className="ms-shuffle-check" aria-hidden="true">
                {option.value === order ? "✓" : ""}
              </span>
              {option.label}
              {option.value === order && <span className="sr-only"> (current)</span>}
            </React.Fragment>
          ),
          onSelect: () => onShuffle(option.value as SceneOrder),
        })),
      ]}
    />
  );
}
