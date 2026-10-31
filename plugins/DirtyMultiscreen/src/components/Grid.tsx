import { React } from "../runtime";
import type { GridProps, Item } from "../types";
import { NativePlayerPane } from "./PlayerPane";
export function NativeMultiscreenGrid({
  avoidDuplicates,
  columns,
  continuation,
  nativePlayer,
  onVisibleSceneIdsChange,
  playback,
  playlists,
  searchSession,
  rows,
  totalScreens,
  useFindScene,
}: GridProps) {
  const gridRef = React.useRef<HTMLDivElement | null>(null);
  const videosToResumeRef = React.useRef(new Set<HTMLVideoElement>());
  const [visibleByPane, setVisibleByPane] = React.useState<Array<string | null>>([]);
  // Read when a pane advances, so it never waits for a render to see the others.
  const playingByPane = React.useRef<Array<string | null>>([]);
  const onSceneChange = React.useCallback((index: number, item: Item | null) => {
    playingByPane.current[index] = item?.id ?? null;
    const id = item?.scene.id ?? null;
    setVisibleByPane(current => {
      if (current[index] === id) return current;
      const next = current.slice();
      next[index] = id;
      return next;
    });
  }, []);
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
          nativePlayer={nativePlayer}
          playback={playback}
          useFindScene={useFindScene}
          onSceneChange={onSceneChange}
          playingElsewhere={playingElsewhere}
          searchSession={searchSession}
        />
      ))}
    </div>
  );
}
