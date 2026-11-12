import { closedScreens, screenOrder } from "../domain/session";
import { DEFAULT_ASPECT, fitLayout, videoAspect } from "../domain/layout";
import { useSessionSaver } from "../hooks";
import { React } from "../runtime";
import type { AudioState, GridProps, Item, PaneView, SavedPane, SwapControls } from "../types";
import { NativePlayerPane } from "./PlayerPane";
export function NativeMultiscreenGrid({
  avoidDuplicates,
  closed: closedPanes,
  columns,
  continuation,
  editing,
  fitVideos,
  findPerformerItems,
  nativePlayer,
  onCloseScreen,
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
  const shown = Array<number>(totalScreens).fill(-1);
  open.forEach((index, rank) => {
    shown[index] = rank;
  });
  const rectangles = React.useMemo(() => {
    if (!fitVideos) return [];
    const placed = open.map(index => {
      const aspect = aspects[index] ?? DEFAULT_ASPECT;
      return rotations[index] % 2 ? 1 / aspect : aspect;
    });
    return fitLayout(placed, size.width, size.height, size.ratio);
  }, [fitVideos, aspects, rotations, order, closed, totalScreens, size]);
  const scheduleSave = useSessionSaver(() =>
    onSessionChange({
      panes: panes.current.slice(0, totalScreens),
      order: places.current,
      ...(closedRef.current.length ? { closed: closedRef.current } : {}),
    }),
  );
  const savedClosed = React.useRef(closedKey);
  React.useEffect(() => {
    if (savedClosed.current === closedKey) return;
    savedClosed.current = closedKey;
    scheduleSave();
  }, [closedKey, scheduleSave]);
  const [swapping, setSwapping] = React.useState<{ source: number; target: number | null } | null>(null);
  const swappingRef = React.useRef(swapping);
  swappingRef.current = swapping;
  const drag = React.useRef<{ from: number; target: number | null; moved: boolean } | null>(null);
  const afterDrag = React.useRef(false);
  const swap = React.useMemo<SwapControls>(() => {
    const exchange = (first: number, second: number) => {
      const next = places.current.slice();
      [next[first], next[second]] = [next[second], next[first]];
      places.current = next;
      setOrder(next);
      scheduleSave();
    };
    return {
      toggle(index) {
        // The click that ends a drag chooses nothing.
        if (afterDrag.current) return;
        const picked = swappingRef.current?.source;
        if (picked !== undefined && picked !== index) exchange(picked, index);
        setSwapping(picked === undefined ? { source: index, target: null } : null);
      },
      dragStart(index) {
        drag.current = { from: index, target: null, moved: false };
      },
      dragOver(index) {
        const current = drag.current;
        if (!current) return;
        // The screen has been lifted, so releasing it is no longer a click.
        current.moved = true;
        const target = index === current.from ? null : index;
        current.target = target;
        setSwapping(previous =>
          previous?.source === current.from && previous.target === target ? previous : { source: current.from, target },
        );
      },
      dragEnd() {
        const current = drag.current;
        drag.current = null;
        if (!current?.moved) return;
        if (current.target !== null) exchange(current.from, current.target);
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
  }, [scheduleSave]);
  React.useEffect(() => {
    if (!editing) swap.cancel();
  }, [editing, swap]);
  React.useEffect(() => {
    snapshotRef.current = () => ({
      panes: panes.current.slice(0, totalScreens).map((pane, index) => {
        const item = playing.current[index];
        return pane && item?.id === pane.itemId ? { ...pane, item: { ...item, outsidePage: true } } : pane;
      }),
      order: places.current,
      ...(closedRef.current.length ? { closed: closedRef.current } : {}),
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
  const gridStyle = {
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
  };
  return (
    <div className={`ms-grid ms-native-grid${fitVideos ? " ms-fit" : ""}`} ref={gridRef} style={gridStyle}>
      {Array.from({ length: totalScreens }, (_, screenIndex) =>
        shown[screenIndex] < 0 ? null : (
          <NativePlayerPane
            key={`ms-native-${screenIndex}`}
            screenIndex={screenIndex}
            position={shown[screenIndex]}
            rectangle={rectangles[shown[screenIndex]]}
            fitVideos={fitVideos}
            onClose={open.length > 1 ? () => closeScreen(screenIndex) : undefined}
            swap={swap}
            swapSource={swapping?.source ?? null}
            swapTarget={swapping?.target ?? null}
            playlist={playlists[screenIndex] ?? []}
            continuation={continuation}
            editing={editing}
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
    </div>
  );
}
