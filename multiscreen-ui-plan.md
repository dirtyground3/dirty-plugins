# Multiscreen edit mode: dividers and drop zones

Today one gesture, dragging a screen's edge, has three hidden meanings (push, extend, resize). Which one happens
depends on where the screen sits in the layout tree, and in fit mode some edges disappear. This plan splits it into
two gestures used by docking UIs and tiling window managers:

1. **Resize = drag the line.** Each divider between parts is its own handle and moves only that line.
2. **Rearrange = drag the screen.** Dropping a screen on another one swaps them (centre) or docks it beside it (edge).

The squares picker stays the starting point (presets). The data model stays the same: the layout tree and session
`layout` in `plugins/DirtyMultiscreen/src/domain/custom.ts` do not change. Only the gestures change.

## Part 1: Dividers

### Domain (`custom.ts`)

- `customDividers(layout, closed, width, height, aspectOf?)` returns one divider per boundary between neighbouring
  parts of each split:
  - `path`: child indexes from the root down to the split;
  - `at`: the boundary between child `at` and `at + 1`;
  - `axis`;
  - its line in pixels (x, y, length).

  It reuses the box sharing that `customRectangles` already does, so lines match the screens exactly.
- `moveDivider(layout, closed, path, at, fraction)` moves only that line:
  - The two parts trade size and the split's total stays the same.
  - Each part keeps a minimum (about 10% of the split or 80 px).
  - Like today, it works on the tree without closed screens, then calls `restoreClosed`.
- The drag is continuous, not stepped in units: sizes are plain numbers and `tidy` normalises them.

### UI

- `Dividers.tsx` is rendered once by `Grid.tsx` as an overlay, not per screen. Each divider has:
  - a 10 px hit strip;
  - a thin line on hover;
  - the existing 5×50 grip centred on it;
  - a resize cursor.
- Pointer handling follows today's `ResizeHandles`: pointer capture, a draft layout while dragging, commit on release,
  and cancel restores.
- A long line (for example screen 1 ↔ the bottom block) and a short line (2 ↔ 3) are separate dividers, so it is
  always clear which one is grabbed.
- On a plain grid, dividers come from `structure`, and the first drag turns the grid custom (as now).
- Fit to video shapes: no dividers, because sizes do not count there.

## Part 2: Drop zones

### Domain (`custom.ts`)

- `dockScreen(layout, pane, target, side)` takes `pane` out of the tree (`tidy` closes the gap), then puts it beside
  `target`:
  - If the target's split already runs along that side, insert it next to the target and split the target's size in
    half.
  - Otherwise, wrap the target in a new two-part split.
- `target = "grid"` docks to the whole layout's outer edge:
  - a new lane the size of an average lane if the root already runs that way;
  - otherwise a third of the grid.
- Docking to a spot the screen already holds returns the layout unchanged (nothing to drop).
- Closed screens keep their place: they are never the moved screen or the target.

### UI (extends the move drag in `ScreenControls.tsx`)

- `screenAt` becomes `dropAt(x, y)` and returns `{ target, side }`:
  - **centre** (inner 40% of the target) = **swap**, as today;
  - otherwise the nearest edge (top, right, bottom or left), split by the diagonals;
  - within about 24 px of the grid's outer edge = dock to that whole side.
- `SwapControls.dragOver` takes `{ target, side }`. `dragEnd` swaps for the centre and calls `dockScreen` for an
  edge.
- Preview: a translucent rectangle shows where the screen will land. It is computed from the real result
  (`customRectangles` of the docked layout), so it is right in fit mode too. Screens do not move until release, so
  targets never shift under the pointer.
- The video is never moved in the DOM; only CSS placement changes.
- Click-to-pick stays a plain swap.

Example (1 on top; 2 over 3 on the left, beside 4):

- Drag 2 onto the left half of 1 → `[2 | 1]` on top, `[3 | 4]` below.
- Drag 2 to the grid's left outer edge → 2 becomes a full-height column.

## Removal

- Delete `classify`, `draggableEdges`, `dragUnit`, `resizeScreen`, `push`, `pull`, `extend`, `release`,
  `ResizeHandles.tsx`, `edgesOf` and `held` in `Grid.tsx`, and the `.ms-resize-*` CSS.
- Add `.ms-divider` and `.ms-drop-preview` instead.

## Tests and verification

- Replace the edge-drag assertions in `tests/test_dirty_multiscreen.js` with tests for:
  - divider positions, including a nested split and closed screens;
  - `moveDivider` limits;
  - `dockScreen` for every side, outer edges, no-op drops, wrapping vs inserting, and keeping closed screens.
- Update the edge-drag check in `tests/test_dirty_multiscreen_ui.js`.
- Run `npm test`, then a fixture browser check (plain grid → divider drag, dock, fit mode), then copy the build to the
  local Stash.
- No version bump until requested.

## Defaults

1. No dividers in fit mode; there, only docking and swapping.
2. Outer-edge drop zones included.
3. Preview overlay only; screens move on release.
4. Parts 1 and 2 land together, because removing edge handles before drop zones exist would remove push and extend in
   between.
