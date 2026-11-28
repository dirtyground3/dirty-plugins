import type * as R from "react";
import { DirtyPlugins, React } from "../runtime";
import type { PictureControls } from "../types";
import { icon } from "./Controls";

/** A point inside the screen, in pixels from its top-left corner. */
export interface MenuPoint {
  x: number;
  y: number;
}
interface MenuItem {
  label: string;
  glyph: unknown;
  fallback: string;
  /** Present for an option that is on or off. */
  checked?: boolean;
  /** Shown at the right, like a browser menu's shortcut column: the current rotation. */
  hint?: string;
  disabled?: boolean;
  /** Why a disabled option is unavailable. */
  reason?: string;
  danger?: boolean;
  run(): void;
}

/** Opens toward the lower right of the pointer, flips where that leaves no room, and always stays in the screen. */
const fit = (pointer: number, size: number, room: number) =>
  Math.max(0, pointer + size <= room ? pointer : pointer >= size ? pointer - size : room - size);

/** Arrow keys, Home and End move between the options that are available, wrapping at either end. */
function moveFocus(event: R.KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
  const index = options.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? -1
        : event.key === "ArrowDown"
          ? index + 1
          : index < 0
            ? -1
            : index - 1;
  options[(next + options.length) % options.length]?.focus();
}

/**
 * One screen's picture options as a context menu at the pointer, which a right-click opens outside edit mode. Like
 * the browser's own menu, choosing an option closes it. Move stays in edit mode, which shows its swap partners.
 */
export function ScreenMenu({
  at,
  position,
  onDone,
  fill,
  fitVideos,
  flipX,
  flipY,
  loop,
  tvMode,
  rotation,
  onClose,
  onFill,
  onFlip,
  onLoop,
  onToggleTvMode,
  onRotate,
}: PictureControls & {
  at: MenuPoint;
  /** Where the screen sits in the grid, for its label. */
  position: number;
  tvMode: boolean;
  onToggleTvMode(): void;
  /** Closes the menu. */
  onDone(): void;
}) {
  const menu = React.useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = React.useState(at);
  // Measured before it paints, so the menu never shows outside its screen first.
  React.useLayoutEffect(() => {
    const element = menu.current,
      screen = element?.offsetParent;
    if (!element || !screen) return;
    const next = {
      x: fit(at.x, element.offsetWidth, screen.clientWidth),
      y: fit(at.y, element.offsetHeight, screen.clientHeight),
    };
    setPlace(previous => (previous.x === next.x && previous.y === next.y ? previous : next));
  });
  // Arrow keys reach the menu rather than the player.
  React.useEffect(() => {
    menu.current?.focus({ preventScroll: true });
  }, []);
  const items: MenuItem[] = [
    {
      label: "Flip horizontally",
      glyph: icon("flipX"),
      fallback: "⇆",
      checked: flipX,
      run: () => onFlip(!flipX, flipY),
    },
    { label: "Flip vertically", glyph: icon("flipY"), fallback: "⇅", checked: flipY, run: () => onFlip(flipX, !flipY) },
    {
      label: "Rotate clockwise",
      glyph: icon("rotate"),
      fallback: "⟳",
      hint: rotation ? `${rotation * 90}°` : undefined,
      run: onRotate,
    },
    { label: "Loop scene", glyph: icon("loop"), fallback: "↻", checked: loop, run: () => onLoop(!loop) },
    { label: "TV mode", glyph: icon("tv"), fallback: "▣", checked: tvMode, run: onToggleTvMode },
    {
      label: "Fill screen",
      glyph: icon("fill"),
      fallback: "⛶",
      checked: fitVideos || fill,
      disabled: fitVideos,
      reason: "Fit videos fills every screen",
      run: () => onFill(!fill),
    },
    {
      label: "Close screen",
      glyph: icon("minus"),
      fallback: "−",
      danger: true,
      disabled: !onClose,
      reason: "The only open screen cannot close",
      run: () => onClose?.(),
    },
  ];
  return (
    <div
      ref={menu}
      className="ms-screen-menu"
      role="menu"
      aria-label={`Options for screen ${position + 1}`}
      tabIndex={-1}
      style={{ left: place.x, top: place.y }}
      onKeyDown={moveFocus}
    >
      {items.map(item => (
        <React.Fragment key={item.label}>
          {item.danger && <div className="ms-screen-menu-separator" role="separator" />}
          <button
            type="button"
            className={"ms-screen-menu-item" + (item.danger ? " ms-screen-menu-danger" : "")}
            role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={item.checked}
            disabled={item.disabled}
            title={item.disabled ? item.reason : undefined}
            onClick={() => {
              // Closing first keeps the menu from updating a screen that its own option just closed.
              onDone();
              item.run();
            }}
          >
            <span className="ms-screen-menu-icon" aria-hidden="true">
              <DirtyPlugins.react.Glyph icon={item.glyph} fallback={item.fallback} />
            </span>
            <span className="ms-screen-menu-label">{item.label}</span>
            {(item.hint || item.checked) && (
              <span className="ms-screen-menu-hint" aria-hidden="true">
                {item.hint ?? "✓"}
              </span>
            )}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}
