import { React } from "../runtime";
import { isolateNativePlayer } from "../domain/playerIdentity";
import type { AudioState, LoadedPlayerProps, Player, VideoPlayerElement } from "../types";
let nextPlayerId = 0;
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
function observeSubtree(target: Element, callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(target, { childList: true, subtree: true });
  return observer;
}

export function LoadedNativePlayer({
  audioState,
  item,
  nativePlayer: NativePlayer,
  nextItem,
  onAudioStateChange,
  playback,
  previousItem,
  scene,
}: LoadedPlayerProps) {
  const [playerId] = React.useState(() => `ms-player-${++nextPlayerId}`);
  const tileRef = React.useRef<HTMLDivElement | null>(null);
  const setTimestampRef = React.useRef<((seconds: number) => void) | null>(null);
  const rangeEndHandledRef = React.useRef(false);
  const audioStateRef = React.useRef(audioState);
  const onAudioStateChangeRef = React.useRef(onAudioStateChange);
  const navigationRef = React.useRef({ nextItem, previousItem });
  navigationRef.current = { nextItem, previousItem };
  const advance = React.useCallback(() => navigationRef.current.nextItem(), []);
  const goBack = React.useCallback(() => navigationRef.current.previousItem(), []);
  audioStateRef.current = audioState;
  onAudioStateChangeRef.current = onAudioStateChange;
  const [initialTimestamp] = React.useState(() => {
    if (item.playbackRange) return item.playbackRange.start;
    if (!playback.randomStart) return 0;
    const duration = Number(scene?.files?.[0]?.duration);
    return Number.isFinite(duration) && duration > 0 ? Math.random() * duration : 0;
  });
  // Let native source fallback finish before seeking, so its pending position
  // cannot race the requested start or the transcode's offset.
  const playbackScene = React.useMemo(
    () => ({ ...scene, resume_time: 0, paths: { ...scene.paths, vtt: null } }),
    [scene],
  );
  const handleComplete = React.useCallback(() => {
    if (playback.loop) {
      setTimestampRef.current?.(item.playbackRange?.start ?? 0);
      return;
    }
    advance();
  }, [item.playbackRange, advance, playback.loop]);
  React.useEffect(() => {
    const tile = tileRef.current;
    const playbackRange = item.playbackRange;
    const rangeEnd = playbackRange?.end;
    if (!tile) return;
    let player: Player | null = null;
    let initialSeekApplied = false;
    let initialSeekPending = false;
    const handleCanPlay = () => {
      if (!usable(player) || initialSeekApplied || initialSeekPending || player.readyState() < 3) return;
      initialSeekPending = true;
      const current = player;
      // Stash's source selector restores its previous position in another
      // canplay handler. Apply our start after those handlers have finished.
      void Promise.resolve().then(() => {
        if (current !== player || !usable(current)) return;
        initialSeekPending = false;
        if (current.readyState() < 3) return;
        initialSeekApplied = true;
        const duration = current.duration();
        const timestamp = Number.isFinite(initialTimestamp) ? Math.max(0, initialTimestamp) : 0;
        current.currentTime(
          Number.isFinite(duration) && duration > 0 ? Math.min(timestamp, Math.max(0, duration - 0.01)) : timestamp,
        );
      });
    };
    const handleTimeUpdate = () => {
      if (
        !usable(player) ||
        !initialSeekApplied ||
        !playbackRange ||
        rangeEnd === undefined ||
        !Number.isFinite(rangeEnd)
      )
        return;
      // The raw video clock starts at zero for each transcoded segment.
      if (player.currentTime() < rangeEnd) {
        rangeEndHandledRef.current = false;
        return;
      }
      if (rangeEndHandledRef.current) return;
      rangeEndHandledRef.current = true;
      if (playback.loop) {
        setTimestampRef.current?.(playbackRange.start);
      } else {
        advance();
      }
    };
    const detachPlayer = () => {
      player?.off?.("canplay", handleCanPlay);
      player?.off?.("timeupdate", handleTimeUpdate);
      player = null;
    };
    const attachPlayer = () => {
      const next = tile.querySelector<VideoPlayerElement>("video-js")?.player ?? null;
      if (next === player) return;
      detachPlayer();
      player = next;
      initialSeekApplied = false;
      initialSeekPending = false;
      rangeEndHandledRef.current = false;
      if (!usable(player)) return;
      isolateNativePlayer(player, playerId);
      player.on("canplay", handleCanPlay);
      player.on("timeupdate", handleTimeUpdate);
      player.ready(() => {
        if (player === next && !next?.isDisposed?.()) handleCanPlay();
      });
    };
    attachPlayer();
    const observer = observeSubtree(tile, attachPlayer);
    return () => {
      observer.disconnect();
      detachPlayer();
    };
  }, [initialTimestamp, item.playbackRange, advance, playback.loop, playerId]);
  React.useEffect(() => {
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
        volume: Number.isFinite(nextVolume) ? nextVolume : audioStateRef.current.volume,
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
  React.useEffect(() => {
    const player = tileRef.current?.querySelector<VideoPlayerElement>("video-js")?.player;
    if (usable(player)) applyAudio(player, audioState);
  }, [audioState.muted, audioState.volume]);
  return (
    <div className="ms-native-tile" ref={tileRef}>
      <NativePlayer
        autoplay={true}
        hideScrubberOverride={true}
        initialTimestamp={0}
        onComplete={handleComplete}
        onNext={advance}
        onPrevious={goBack}
        permitLoop={playback.loop}
        scene={playbackScene}
        sendSetTimestamp={setTimestamp => {
          setTimestampRef.current = setTimestamp;
        }}
      />
    </div>
  );
}
