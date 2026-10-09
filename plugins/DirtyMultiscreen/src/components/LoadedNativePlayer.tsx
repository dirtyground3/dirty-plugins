import type { ComponentDependencies, LoadedPlayerProps, VideoPlayerElement, Player } from "../types";
export function createLoadedNativePlayer(deps: ComponentDependencies) {
  const { api: PluginApi, React, useOwnedEffect: useEffect } = deps;
  const { useState, useRef, useCallback } = React;
  const { NavLink } = PluginApi.libraries.ReactRouterDOM;
  const SCENES_ROUTE_PATH = "/scenes";
  const observeSubtree = deps.observeSubtree;
  function LoadedNativePlayer({
    audioState,
    item,
    nativePlayer: NativePlayer,
    nextItem,
    onAudioStateChange,
    playback,
    previousItem,
    scene
  }: LoadedPlayerProps) {
    const tileRef = useRef<HTMLDivElement | null>(null);
    const setTimestampRef = useRef<((seconds: number) => void) | null>(null);
    const rangeEndHandledRef = useRef(false);
    const audioStateRef = useRef(audioState);
    const onAudioStateChangeRef = useRef(onAudioStateChange);
    const sceneId = item.scene?.id ?? item.id;
    audioStateRef.current = audioState;
    onAudioStateChangeRef.current = onAudioStateChange;
    const [initialTimestamp] = useState(() => {
      if (item.playbackRange) return item.playbackRange.start;
      if (!playback.randomStart) return 0;
      const duration = Number(scene?.files?.[0]?.duration);
      return Number.isFinite(duration) && duration > 0 ? Math.random() * duration : 0;
    });
    const handleComplete = useCallback(() => {
      if (playback.loop) {
        setTimestampRef.current?.(item.playbackRange?.start ?? 0);
        return;
      }
      nextItem();
    }, [item.playbackRange, nextItem, playback.loop]);
    useEffect(() => {
      const tile = tileRef.current;
      const playbackRange = item.playbackRange;
      const rangeEnd = playbackRange?.end;
      if (!tile || !playbackRange || rangeEnd === void 0 || !Number.isFinite(rangeEnd)) return;
      let videoElement: HTMLVideoElement | null = null;
      const handleTimeUpdate = () => {
        if (!videoElement) return;
        if (videoElement.currentTime < rangeEnd) {
          rangeEndHandledRef.current = false;
          return;
        }
        if (rangeEndHandledRef.current) return;
        rangeEndHandledRef.current = true;
        if (playback.loop) {
          setTimestampRef.current?.(playbackRange.start);
        } else {
          nextItem();
        }
      };
      const attachVideoElement = () => {
        const nextVideoElement = tile.querySelector("video");
        if (nextVideoElement === videoElement) return;
        videoElement?.removeEventListener("timeupdate", handleTimeUpdate);
        videoElement = nextVideoElement;
        videoElement?.addEventListener("timeupdate", handleTimeUpdate);
      };
      attachVideoElement();
      const observer = observeSubtree(tile, attachVideoElement);
      return () => {
        observer.disconnect();
        videoElement?.removeEventListener("timeupdate", handleTimeUpdate);
      };
    }, [item.playbackRange, nextItem, playback.loop]);
    useEffect(() => {
      const tile = tileRef.current;
      if (!tile) return;
      let player: Player | null = null;
      let applyingAudioState = false;
      const disableSharedVolumePersistence = () => {
        if (!player || player.isDisposed?.()) return;
        const persistVolume = player.persistVolume?.();
        if (persistVolume) {
          persistVolume.enabled = false;
          persistVolume.ready = () => void 0;
        }
      };
      const applyAudioState = () => {
        if (!player || player.isDisposed?.()) return;
        disableSharedVolumePersistence();
        const desiredAudioState = audioStateRef.current;
        applyingAudioState = true;
        try {
          if (player.volume() !== desiredAudioState.volume) {
            player.volume(desiredAudioState.volume);
          }
          if (player.muted() !== desiredAudioState.muted) {
            player.muted(desiredAudioState.muted);
          }
        } finally {
          applyingAudioState = false;
        }
      };
      const handleVolumeChange = () => {
        if (!player || player.isDisposed?.() || applyingAudioState) return;
        const nextVolume = Number(player.volume());
        const nextAudioState = {
          muted: !!player.muted(),
          volume: Number.isFinite(nextVolume) ? nextVolume : audioStateRef.current.volume
        };
        audioStateRef.current = nextAudioState;
        onAudioStateChangeRef.current(nextAudioState);
      };
      const detachPlayer = () => {
        player?.off?.("volumechange", handleVolumeChange);
        player = null;
      };
      const attachPlayer = () => {
        const playerElement = tile.querySelector<VideoPlayerElement>("video-js");
        const nextPlayer = playerElement?.player ?? null;
        if (nextPlayer === player) return;
        detachPlayer();
        if (!nextPlayer) return;
        player = nextPlayer;
        disableSharedVolumePersistence();
        player.on("volumechange", handleVolumeChange);
        player.ready(() => {
          if (player !== nextPlayer || nextPlayer.isDisposed?.()) return;
          disableSharedVolumePersistence();
          applyAudioState();
        });
        applyAudioState();
      };
      attachPlayer();
      const observer = observeSubtree(tile, attachPlayer);
      return () => {
        observer.disconnect();
        detachPlayer();
      };
    }, []);
    useEffect(() => {
      const playerElement = tileRef.current?.querySelector<VideoPlayerElement>("video-js");
      const player = playerElement?.player;
      if (!player || player.isDisposed?.()) return;
      const persistVolume = player.persistVolume?.();
      if (persistVolume) {
        persistVolume.enabled = false;
        persistVolume.ready = () => void 0;
      }
      if (player.volume() !== audioState.volume) player.volume(audioState.volume);
      if (player.muted() !== audioState.muted) player.muted(audioState.muted);
    }, [audioState.muted, audioState.volume]);
    return (<div className="ms-native-tile" ref={tileRef}>
      <NavLink
        aria-label={`Open scene page for ${item.title}`}
        className="ms-title"
        rel="noopener noreferrer"
        target="_blank"
        title={`Open scene page: ${item.title}`}
        to={`${SCENES_ROUTE_PATH}/${sceneId}`}
      >
        {item.title}
      </NavLink>
      <NativePlayer
        autoplay={true}
        hideScrubberOverride={true}
        initialTimestamp={initialTimestamp}
        onComplete={handleComplete}
        onNext={nextItem}
        onPrevious={previousItem}
        permitLoop={playback.loop}
        scene={scene}
        sendSetTimestamp={(setTimestamp) => {
          setTimestampRef.current = setTimestamp;
        }}
      />
    </div>);
  }
  return LoadedNativePlayer;
}
