import type { ComponentDependencies, GridProps } from "../types";
export function createGrid(deps: ComponentDependencies) {
  const { React, useOwnedEffect: useEffect } = deps;
  const { useState, useRef, useCallback, useMemo } = React;
  const NativePlayerTile = deps.NativePlayerTile!;
  function NativeMultiscreenGrid({
    columns,
    nativePlayer,
    onVisibleSceneIdsChange,
    playback,
    playlists,
    rows,
    totalScreens,
    useFindScene
  }: GridProps) {
    const gridRef = useRef<HTMLDivElement | null>(null);
    const videosToResumeRef = useRef(/* @__PURE__ */ new Set<HTMLVideoElement>());
    const [cursors, setCursors] = useState(
      () => Array.from({ length: totalScreens }, () => 0)
    );
    const playlistKey = useMemo(
      () => playlists.map((playlist) => playlist.map((item) => item.id).join(",")).join("|"),
      [playlists]
    );
    useEffect(() => {
      setCursors(Array.from({ length: totalScreens }, () => 0));
    }, [playlistKey, totalScreens]);
    const visibleSceneIds = useMemo(() => {
      const sceneIds = Array.from({ length: totalScreens }, (_, screenIndex) => {
        const playlist = playlists[screenIndex] ?? [];
        if (playlist.length === 0) return null;
        const currentIndex = Math.min(cursors[screenIndex] ?? 0, playlist.length - 1);
        const item = playlist[currentIndex];
        return item.scene?.id ?? null;
      }).filter((sceneId): sceneId is string => !!sceneId);
      return Array.from(new Set(sceneIds));
    }, [cursors, playlists, totalScreens]);
    useEffect(() => {
      onVisibleSceneIdsChange(visibleSceneIds);
    }, [onVisibleSceneIdsChange, visibleSceneIds]);
    useEffect(
      () => () => onVisibleSceneIdsChange([]),
      [onVisibleSceneIdsChange]
    );
    useEffect(() => {
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
          void video.play().catch(() => void 0);
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
    const setCursor = useCallback((screenIndex: number, nextIndex: number) => {
      setCursors((previousCursors) => {
        const nextCursors = Array.from(
          { length: totalScreens },
          (_, index) => previousCursors[index] ?? 0
        );
        nextCursors[screenIndex] = nextIndex;
        return nextCursors;
      });
    }, [totalScreens]);
    const gridStyle = {
      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`
    };
    return (<div className="ms-grid ms-native-grid" ref={gridRef} style={gridStyle}>
      {Array.from({ length: totalScreens }, (_, screenIndex) => {
        const playlist = playlists[screenIndex] ?? [];
        if (playlist.length === 0) return (<div className="ms-cell" key={`ms-native-${screenIndex}`} />);
        const currentIndex = Math.min(cursors[screenIndex] ?? 0, playlist.length - 1);
        const item = playlist[currentIndex];
        const nextItem = () => setCursor(screenIndex, (currentIndex + 1) % playlist.length);
        const previousItem = () => setCursor(
          screenIndex,
          currentIndex === 0 ? playlist.length - 1 : currentIndex - 1
        );
        return (<div className="ms-cell" key={`ms-native-${screenIndex}`}>
          <NativePlayerTile
            item={item}
            nativePlayer={nativePlayer}
            nextItem={nextItem}
            playback={playback}
            previousItem={previousItem}
            useFindScene={useFindScene}
          />
        </div>);
      })}
    </div>);
  }
  return NativeMultiscreenGrid;
}
