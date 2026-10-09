import { observeSubtree, useOwnedEffect as useEffect } from "../lifecycle";
import { PluginApi, React } from "../runtime";
import type { AudioState, LoadedPlayerProps, Player, VideoPlayerElement } from "../types";
const SCENES_ROUTE_PATH = "/scenes";
const usable = (player: Player | null | undefined): player is Player => !!player && !player.isDisposed?.();
/** Each pane keeps its own audio: stop video.js persisting volume across players. */
function disableVolumePersistence(player: Player) {
  const persistVolume = player.persistVolume?.();
  if (persistVolume) {
    persistVolume.enabled = false;
    persistVolume.ready = () => undefined;
  }
}
function applyAudio(player: Player, audio: AudioState) {
  disableVolumePersistence(player);
  if (player.volume() !== audio.volume) player.volume(audio.volume);
  if (player.muted() !== audio.muted) player.muted(audio.muted);
}
export function LoadedNativePlayer({
  audioState,
  item,
  nativePlayer: NativePlayer,
  nextItem,
  onAudioStateChange,
  playback,
  previousItem,
  scene
}: LoadedPlayerProps) {
  const tileRef = React.useRef<HTMLDivElement | null>(null);
  const setTimestampRef = React.useRef<((seconds: number) => void) | null>(null);
  const rangeEndHandledRef = React.useRef(false);
  const audioStateRef = React.useRef(audioState);
  const onAudioStateChangeRef = React.useRef(onAudioStateChange);
  const sceneId = item.scene?.id ?? item.id;
  audioStateRef.current = audioState;
  onAudioStateChangeRef.current = onAudioStateChange;
  const [initialTimestamp] = React.useState(() => {
    if (item.playbackRange) return item.playbackRange.start;
    if (!playback.randomStart) return 0;
    const duration = Number(scene?.files?.[0]?.duration);
    return Number.isFinite(duration) && duration > 0 ? Math.random() * duration : 0;
  });
  const handleComplete = React.useCallback(() => {
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
    if (!tile || !playbackRange || rangeEnd === undefined || !Number.isFinite(rangeEnd)) return;
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
    const applyAudioState = () => {
      if (!usable(player)) return;
      applyingAudioState = true;
      try {
        applyAudio(player, audioStateRef.current);
      } finally {
        applyingAudioState = false;
      }
    };
    const handleVolumeChange = () => {
      if (!usable(player) || applyingAudioState) return;
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
      if (usable(player)) disableVolumePersistence(player);
      player.on("volumechange", handleVolumeChange);
      player.ready(() => {
        if (player !== nextPlayer || nextPlayer.isDisposed?.()) return;
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
    const player = tileRef.current?.querySelector<VideoPlayerElement>("video-js")?.player;
    if (usable(player)) applyAudio(player, audioState);
  }, [audioState.muted, audioState.volume]);
  return (<div className="ms-native-tile" ref={tileRef}>
    <PluginApi.libraries.ReactRouterDOM.NavLink
      aria-label={`Open scene page for ${item.title}`}
      className="ms-title"
      rel="noopener noreferrer"
      target="_blank"
      title={`Open scene page: ${item.title}`}
      to={`${SCENES_ROUTE_PATH}/${sceneId}`}
    >
      {item.title}
    </PluginApi.libraries.ReactRouterDOM.NavLink>
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
