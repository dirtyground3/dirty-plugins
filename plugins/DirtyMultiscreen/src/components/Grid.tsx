import { useSessionSaver } from "../hooks";
import { React } from "../runtime";
import type { AudioState, GridProps, Item, SavedPane } from "../types";
import { NativePlayerPane } from "./PlayerPane";
export function NativeMultiscreenGrid({
  avoidDuplicates,
  columns,
  continuation,
  findPerformerItems,
  nativePlayer,
  onSessionChange,
  onVisibleSceneIdsChange,
  playback,
  playlists,
  savedPanes,
  searchSession,
  showPerformerNavigation,
  rows,
  totalScreens,
  useFindScene,
}: GridProps) {
  const gridRef = React.useRef<HTMLDivElement | null>(null);
  const videosToResumeRef = React.useRef(new Set<HTMLVideoElement>());
  const [visibleByPane, setVisibleByPane] = React.useState<Array<string | null>>([]);
  // Read when a pane advances, so it never waits for a render to see the others.
  const playingByPane = React.useRef<Array<string | null>>([]);
  // A pane still restoring keeps its saved entry until it reports its scene.
  const panes = React.useRef<Array<SavedPane | null>>(savedPanes?.slice() ?? []);
  const scheduleSave = useSessionSaver(() => onSessionChange(panes.current.slice(0, totalScreens)));
  const onSceneChange = React.useCallback(
    (index: number, item: Item | null, page: number) => {
      playingByPane.current[index] = item?.id ?? null;
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
    [scheduleSave],
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
    <div className="ms-grid ms-native-grid" ref={gridRef} style={gridStyle}>
      {Array.from({ length: totalScreens }, (_, screenIndex) => (
        <NativePlayerPane
          key={`ms-native-${screenIndex}`}
          screenIndex={screenIndex}
          playlist={playlists[screenIndex] ?? []}
          continuation={continuation}
          findPerformerItems={findPerformerItems}
          nativePlayer={nativePlayer}
          playback={playback}
          useFindScene={useFindScene}
          onAudioChange={onAudioChange}
          onPositionChange={onPositionChange}
          onSceneChange={onSceneChange}
          playingElsewhere={playingElsewhere}
          saved={savedPanes?.[screenIndex]}
          searchSession={searchSession}
          showPerformerNavigation={showPerformerNavigation}
        />
      ))}
    </div>
  );
}
