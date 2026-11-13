import { closedScreens, screenOrder } from "../domain/session";
import { DEFAULT_ASPECT, fitLayout, fitPlan, placeFitPlan, videoAspect } from "../domain/layout";
import {
  customRectangles,
  dockScreen,
  layoutFromFitted,
  layoutFromLanes,
  leaves,
  normalizeLayout,
  readingOrder,
  sameArrangement,
  swapCells,
} from "../domain/custom";
import type { CustomLayout } from "../domain/custom";
import { dropTargetAt, dropTargets, sameGuideBounds } from "../domain/dropGuide";
import type { DropPointer, DropTarget } from "../domain/dropGuide";
import type { Rectangle } from "../domain/layout";
import { useSessionSaver } from "../hooks";
import { React } from "../runtime";
import type { AudioState, GridProps, Item, PaneView, SavedPane, SwapControls } from "../types";
import { Dividers } from "./Dividers";
import { DockingGuide } from "./DockingGuide";
import type { DockingGuideState } from "./DockingGuide";
import { NativePlayerPane } from "./PlayerPane";

interface GuideCache {
  pointer: DropPointer;
  base: CustomLayout;
  closed: readonly number[];
  targets: DropTarget[];
}

export function NativeMultiscreenGrid({
  avoidDuplicates,
  closed: closedPanes,
  columns,
  continuation,
  editing,
  fitVideos,
  findPerformerItems,
  layout,
  moveWithoutEditing,
  nativePlayer,
  onCloseScreen,
  onFinishEditing,
  onLayoutChange,
  onSessionChange,
  onVisibleSceneIdsChange,
  playback,
  playlists,
  savedOrder,
  savedPanes,
  searchSession,
  snapshotRef,
  showPerformerNavigation,
  rows,
  totalScreens,
  useFindScene,
}: GridProps) {
  const gridRef = React.useRef<HTMLDivElement | null>(null);
  const videosToResumeRef = React.useRef(new Set<HTMLVideoElement>());
  const [visibleByPane, setVisibleByPane] = React.useState<Array<string | null>>([]);
  const [aspects, setAspects] = React.useState<number[]>([]);
  const [rotations, setRotations] = React.useState<number[]>([]);
  const updateAspect = React.useCallback((index: number, aspect: number) => {
    setAspects(current => {
      if (current[index] === aspect) return current;
      const next = current.slice();
      next[index] = aspect;
      return next;
    });
  }, []);
  React.useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    // Metadata can arrive after the scene query, and a source change can update it again.
    const readSize = (event: Event) => {
      const video = event.target;
      if (!(video instanceof HTMLVideoElement) || !video.videoWidth || !video.videoHeight) return;
      const cell = video.closest<HTMLElement>("[data-ms-screen]");
      if (cell) updateAspect(Number(cell.dataset.msScreen), videoAspect(video.videoWidth, video.videoHeight));
    };
    grid.addEventListener("loadedmetadata", readSize, true);
    grid.addEventListener("resize", readSize, true);
    return () => {
      grid.removeEventListener("loadedmetadata", readSize, true);
      grid.removeEventListener("resize", readSize, true);
    };
  }, [updateAspect]);
  // Browser zoom and display scaling change the device pixel ratio, and with it the window's size in CSS pixels.
  const windowSize = () => ({
    width: window.innerWidth,
    height: window.innerHeight,
    ratio: window.devicePixelRatio || 1,
  });
  const [size, setSize] = React.useState(windowSize);
  React.useEffect(() => {
    const resize = () => setSize(windowSize());
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  // Read when a pane advances, so it never waits for a render to see the others.
  const playingByPane = React.useRef<Array<string | null>>([]);
  // A pane still restoring keeps its saved entry until it reports its scene.
  const panes = React.useRef<Array<SavedPane | null>>(savedPanes?.slice() ?? []);
  // The item each pane plays, which a saved grid stores so it can return to it under any later queue.
  const playing = React.useRef<Array<Item | null>>([]);
  // Each screen's place in the layout. Moving one changes only its CSS, so its video is never touched.
  const [order, setOrder] = React.useState(() => screenOrder(savedOrder, totalScreens));
  const places = React.useRef(order);
  places.current = order.length === totalScreens ? order : screenOrder(order, totalScreens);
  const closedKey = closedScreens(closedPanes, totalScreens).join();
  const closed = React.useMemo(() => (closedKey ? closedKey.split(",").map(Number) : []), [closedKey]);
  const closedRef = React.useRef(closed);
  closedRef.current = closed;
  // The open panes in place order. A closed pane leaves no gap: the others close up behind it.
  const open = places.current
    .map((place, index) => ({ place, index }))
    .filter(({ index }) => !closed.includes(index))
    .sort((first, second) => first.place - second.place)
    .map(({ index }) => index);
  // Every pane in place order, closed ones too.
  const placeOrder = places.current
    .map((place, index) => ({ place, index }))
    .sort((first, second) => first.place - second.place)
    .map(({ index }) => index);
  const aspectOf = React.useCallback(
    (index: number) => {
      const aspect = aspects[index] ?? DEFAULT_ASPECT;
      return rotations[index] % 2 ? 1 / aspect : aspect;
    },
    [aspects, rotations],
  );
  // The layout a drag starts from: the saved tree, else the fitted lanes, else the grid's rows.
  const custom = React.useMemo(() => (layout ? normalizeLayout(layout, totalScreens) : null), [layout, totalScreens]);
  const fittedPlan = React.useMemo(
    () => (fitVideos && !custom && open.length ? fitPlan(open.map(aspectOf), size.width, size.height) : null),
    [fitVideos, custom, aspectOf, size, order, closed, totalScreens],
  );
  const fitted = React.useMemo(
    () => fittedPlan && placeFitPlan(fittedPlan, size.width, size.height, size.ratio),
    [fittedPlan, size],
  );
  const structure = React.useMemo(() => {
    if (custom) return custom;
    if (fittedPlan && fitted)
      return layoutFromFitted(
        open,
        placeOrder,
        fittedPlan.ends,
        fittedPlan.transposed,
        fitted,
        size.width,
        size.height,
      );
    const lanes = Array.from({ length: Math.ceil(open.length / columns) }, (_, at) =>
      open.slice(at * columns, (at + 1) * columns),
    );
    return layoutFromLanes(lanes, placeOrder);
  }, [custom, fittedPlan, fitted, order, closed, totalScreens, columns]);
  const [draft, setDraft] = React.useState<CustomLayout | null>(null);
  // Screens move and resize in edit mode, or anytime when the setting allows it.
  const arranging = editing || moveWithoutEditing;
  const resizing = arranging && draft !== null;
  const shownLayout = resizing ? draft : custom;
  const rectangles = React.useMemo(() => {
    if (shownLayout) return customRectangles(shownLayout, closed, size.width, size.height, size.ratio);
    if (!fitted) return [];
    const placed: typeof fitted = [];
    open.forEach((index, rank) => {
      placed[index] = fitted[rank];
    });
    return placed;
  }, [shownLayout, fitted, order, closed, totalScreens, size]);
  const shown = Array<number>(totalScreens).fill(-1);
  (shownLayout ? readingOrder(shownLayout, closed) : open).forEach((index, rank) => {
    shown[index] = rank;
  });
  const layoutRef = React.useRef(custom);
  layoutRef.current = custom;
  // Leaving the custom rows keeps the screens in the order they had there.
  const previousLayout = React.useRef(custom);
  React.useEffect(() => {
    const previous = previousLayout.current;
    previousLayout.current = custom;
    if (!previous || custom) return;
    const next = Array<number>(totalScreens);
    leaves(previous).forEach((index, rank) => {
      next[index] = rank;
    });
    places.current = screenOrder(next, totalScreens);
    setOrder(places.current);
    scheduleSave();
  }, [custom]);
  const scheduleSave = useSessionSaver(() =>
    onSessionChange({
      panes: panes.current.slice(0, totalScreens),
      order: places.current,
      ...(closedRef.current.length ? { closed: closedRef.current } : {}),
      ...(layoutRef.current ? { layout: layoutRef.current } : {}),
    }),
  );
  const savedLayout = React.useRef(layout);
  React.useEffect(() => {
    if (savedLayout.current === layout) return;
    savedLayout.current = layout;
    scheduleSave();
  }, [layout, scheduleSave]);
  const savedClosed = React.useRef(closedKey);
  React.useEffect(() => {
    if (savedClosed.current === closedKey) return;
    savedClosed.current = closedKey;
    scheduleSave();
  }, [closedKey, scheduleSave]);
  const [swapping, setSwapping] = React.useState<{ source: number; guide?: DockingGuideState } | null>(null);
  const swappingRef = React.useRef(swapping);
  swappingRef.current = swapping;
  const drag = React.useRef<{ from: number; guide?: GuideCache } | null>(null);
  const afterDrag = React.useRef(false);
  const structureRef = React.useRef(structure);
  structureRef.current = structure;
  const swap = React.useMemo<SwapControls>(() => {
    const exchange = (first: number, second: number) => {
      const next = places.current.slice();
      [next[first], next[second]] = [next[second], next[first]];
      places.current = next;
      setOrder(next);
      // Screens in custom rows trade their cells.
      if (layoutRef.current) onLayoutChange(swapCells(layoutRef.current, first, second));
      scheduleSave();
    };
    return {
      toggle(index) {
        // The click that ends a drag chooses nothing.
        if (afterDrag.current) return;
        const picked = swappingRef.current?.source;
        if (picked !== undefined && picked !== index) exchange(picked, index);
        setSwapping(picked === undefined ? { source: index } : null);
      },
      dragStart(index) {
        drag.current = { from: index };
      },
      dragOver(pointer) {
        const current = drag.current;
        if (!current) return;
        const base = structureRef.current;
        const closed = closedRef.current;
        let guide = current.guide;
        if (!guide || guide.base !== base || guide.closed !== closed || !sameGuideBounds(guide.pointer, pointer)) {
          const targets = dropTargets(pointer, zone => {
            if (zone.side === "center") return true;
            const next = dockScreen(base, current.from, zone.target, zone.side, closed);
            // A dock that only trades places with its screen is already the Swap target.
            return (
              next !== base &&
              (zone.target === "grid" || !sameArrangement(next, swapCells(base, current.from, zone.target), closed))
            );
          });
          current.guide = guide = { pointer, base, closed, targets };
        }
        const { targets } = guide;
        const active = dropTargetAt(targets, pointer);
        setSwapping(previous =>
          previous?.source === current.from && previous.guide?.targets === targets && previous.guide.active === active
            ? previous
            : { source: current.from, guide: { targets, active } },
        );
      },
      dragEnd(pointer) {
        const current = drag.current;
        drag.current = null;
        if (!current || !pointer) return;
        const guide = current.guide;
        // A release can arrive after the pointer has left the last rendered guide.
        const shownTargets = swappingRef.current?.guide?.targets;
        const zone = shownTargets && dropTargetAt(shownTargets, pointer)?.zone;
        if (
          zone &&
          guide?.base === structureRef.current &&
          guide.closed === closedRef.current &&
          (zone.target === "grid" || zone.target === pointer.pane?.index)
        ) {
          if (zone.side === "center") exchange(current.from, zone.target);
          else {
            const next = dockScreen(guide.base, current.from, zone.target, zone.side, guide.closed);
            if (next !== guide.base) onLayoutChange(next);
          }
        }
        setSwapping(null);
        afterDrag.current = true;
        window.setTimeout(() => {
          afterDrag.current = false;
        }, 0);
      },
      cancel() {
        drag.current = null;
        setSwapping(null);
      },
    };
  }, [scheduleSave, onLayoutChange]);
  // A screen picked up by a click in edit mode is put down when edit mode opens or closes.
  React.useEffect(() => swap.cancel(), [editing, arranging, swap]);
  React.useEffect(() => setDraft(null), [editing, fitVideos, structure, closed]);
  const dropPreviews = React.useMemo(() => {
    const zone = arranging && swapping ? swapping.guide?.active?.zone : null;
    if (!zone || !swapping) return [];
    const { source } = swapping;
    const moved = zone.side === "center" ? [source, zone.target] : [source];
    if (zone.side === "center" && fitVideos && !custom) {
      const swapped = open.map(pane => (pane === source ? zone.target : pane === zone.target ? source : pane));
      const fitted = fitLayout(swapped.map(aspectOf), size.width, size.height, size.ratio);
      return moved.map(pane => fitted[swapped.indexOf(pane)]);
    }
    const next =
      zone.side === "center"
        ? swapCells(structure, source, zone.target)
        : dockScreen(structure, source, zone.target, zone.side, closed);
    if (next === structure) return [];
    const boxes = customRectangles(next, closed, size.width, size.height, size.ratio);
    return moved.map(pane => boxes[pane]).filter((box): box is Rectangle => !!box);
  }, [arranging, swapping, fitVideos, custom, structure, aspectOf, size, closed, order]);
  React.useEffect(() => {
    snapshotRef.current = () => ({
      panes: panes.current.slice(0, totalScreens).map((pane, index) => {
        const item = playing.current[index];
        return pane && item?.id === pane.itemId ? { ...pane, item: { ...item, outsidePage: true } } : pane;
      }),
      order: places.current,
      ...(closedRef.current.length ? { closed: closedRef.current } : {}),
      ...(layoutRef.current ? { layout: layoutRef.current } : {}),
    });
    return () => {
      snapshotRef.current = null;
    };
  }, [snapshotRef, totalScreens]);
  const onSceneChange = React.useCallback(
    (index: number, item: Item | null, page: number, rotation: number) => {
      setRotations(current => {
        if (current[index] === rotation) return current;
        const next = current.slice();
        next[index] = rotation;
        return next;
      });
      playingByPane.current[index] = item?.id ?? null;
      playing.current[index] = item;
      const file = item?.scene.files?.[0];
      // A cached/native source may already have metadata before this scene's effect runs.
      const video = gridRef.current?.querySelector<HTMLVideoElement>(`[data-ms-screen="${index}"] video`);
      updateAspect(
        index,
        video?.videoWidth && video.videoHeight
          ? videoAspect(video.videoWidth, video.videoHeight)
          : videoAspect(file?.width, file?.height),
      );
      if (item) {
        const previous = panes.current[index];
        panes.current[index] = {
          ...previous,
          page,
          itemId: item.id,
          item: item.outsidePage ? item : undefined,
          time: previous?.itemId === item.id ? previous.time : undefined,
        };
        scheduleSave();
      }
      const id = item?.scene.id ?? null;
      setVisibleByPane(current => {
        if (current[index] === id) return current;
        const next = current.slice();
        next[index] = id;
        return next;
      });
    },
    [scheduleSave, updateAspect],
  );
  const updatePane = React.useCallback(
    (index: number, change: Partial<SavedPane>) => {
      const pane = panes.current[index];
      if (!pane) return;
      panes.current[index] = { ...pane, ...change };
      scheduleSave();
    },
    [scheduleSave],
  );
  const onPositionChange = React.useCallback(
    (index: number, time: number) => updatePane(index, { time }),
    [updatePane],
  );
  const onAudioChange = React.useCallback(
    (index: number, audio: AudioState) => updatePane(index, { audio }),
    [updatePane],
  );
  const onViewChange = React.useCallback((index: number, view: PaneView) => updatePane(index, { view }), [updatePane]);
  /** A closed pane stops playing and counts as no scene, but keeps its saved state and item for reopening. */
  const closeScreen = (index: number) => {
    if (closedRef.current.includes(index) || closedRef.current.length + 1 >= totalScreens) return;
    swap.cancel();
    setDraft(null);
    playingByPane.current[index] = null;
    setVisibleByPane(current => {
      if (!current[index]) return current;
      const next = current.slice();
      next[index] = null;
      return next;
    });
    onCloseScreen(index);
  };
  const playingElsewhere = React.useMemo(
    () =>
      avoidDuplicates
        ? (screen: number) =>
            new Set(
              playingByPane.current
                .slice(0, totalScreens)
                .filter((id, index): id is string => index !== screen && !!id),
            )
        : undefined,
    [avoidDuplicates, totalScreens],
  );
  const visibleSceneIds = React.useMemo(
    () => Array.from(new Set(visibleByPane.slice(0, totalScreens).filter((id): id is string => !!id))),
    [visibleByPane, totalScreens],
  );
  React.useEffect(() => {
    onVisibleSceneIdsChange(visibleSceneIds);
  }, [onVisibleSceneIdsChange, visibleSceneIds]);
  React.useEffect(() => () => onVisibleSceneIdsChange([]), [onVisibleSceneIdsChange]);
  React.useEffect(() => {
    const grid = gridRef.current;
    if (!grid || !playback.pauseWhenHidden) {
      videosToResumeRef.current.clear();
      return;
    }
    const pauseVideo = (video: HTMLVideoElement) => {
      if (video.paused || video.ended) return;
      videosToResumeRef.current.add(video);
      video.pause();
    };
    const handleVisibilityChange = () => {
      if (document.hidden) {
        videosToResumeRef.current.clear();
        grid.querySelectorAll("video").forEach(pauseVideo);
        return;
      }
      const videosToResume = Array.from(videosToResumeRef.current);
      videosToResumeRef.current.clear();
      videosToResume.forEach((video: HTMLVideoElement) => {
        if (!video.isConnected || !grid.contains(video) || video.ended) return;
        void video.play().catch(() => undefined);
      });
    };
    const handlePlay = (event: Event) => {
      if (!document.hidden || !(event.target instanceof HTMLVideoElement)) return;
      pauseVideo(event.target);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    grid.addEventListener("play", handlePlay, true);
    handleVisibilityChange();
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      grid.removeEventListener("play", handlePlay, true);
      videosToResumeRef.current.clear();
    };
  }, [playback.pauseWhenHidden]);
  // A partial last row shares the full width, just like its lane in the tree.
  const last = open.length % columns;
  const tracks = last || 1;
  const full = open.length - last;
  const gridStyle = {
    gridTemplateColumns: `repeat(${columns * tracks}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${closed.length ? Math.max(1, Math.ceil(open.length / columns)) : rows}, minmax(0, 1fr))`,
  };
  const firstFitted = !shownLayout && fitted ? fitted[0] : null;
  const lastFitted = firstFitted && fitted ? fitted[fitted.length - 1] : null;
  const fittedBounds =
    firstFitted && lastFitted
      ? {
          left: firstFitted.left,
          top: firstFitted.top,
          right: lastFitted.left + lastFitted.width,
          bottom: lastFitted.top + lastFitted.height,
        }
      : undefined;
  return (
    <div
      className={`ms-grid ms-native-grid${fitVideos ? " ms-fit" : ""}${shownLayout ? " ms-custom" : ""}${resizing ? " ms-resizing" : ""}${swapping?.guide ? " ms-moving" : ""}`}
      ref={gridRef}
      style={gridStyle}
    >
      {Array.from({ length: totalScreens }, (_, screenIndex) =>
        shown[screenIndex] < 0 ? null : (
          <NativePlayerPane
            key={`ms-native-${screenIndex}`}
            screenIndex={screenIndex}
            position={shown[screenIndex]}
            rectangle={rectangles[screenIndex]}
            columnSpan={last ? (shown[screenIndex] < full ? tracks : columns) : undefined}
            fitVideos={fitVideos}
            onClose={open.length > 1 ? () => closeScreen(screenIndex) : undefined}
            swap={swap}
            swapSource={swapping?.source ?? null}
            playlist={playlists[screenIndex] ?? []}
            continuation={continuation}
            editing={editing}
            onFinishEditing={onFinishEditing}
            moveWithoutEditing={moveWithoutEditing}
            findPerformerItems={findPerformerItems}
            nativePlayer={nativePlayer}
            playback={playback}
            useFindScene={useFindScene}
            onAudioChange={onAudioChange}
            onPositionChange={onPositionChange}
            onSceneChange={onSceneChange}
            onViewChange={onViewChange}
            playingElsewhere={playingElsewhere}
            // A reopened pane returns to what it played when it closed.
            saved={panes.current[screenIndex]}
            searchSession={searchSession}
            showPerformerNavigation={showPerformerNavigation}
          />
        ),
      )}
      {arranging && (
        <Dividers
          quiet={!editing}
          base={structure}
          shown={shownLayout ?? structure}
          closed={closed}
          size={size}
          bounds={fittedBounds}
          onDraft={setDraft}
          onCommit={onLayoutChange}
        />
      )}
      {arranging && swapping?.guide && (
        <DockingGuide guide={swapping.guide} previews={dropPreviews} source={swapping.source} positions={shown} />
      )}
    </div>
  );
}
