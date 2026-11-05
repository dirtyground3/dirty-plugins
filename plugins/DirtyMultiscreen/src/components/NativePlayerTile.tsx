import { React } from "../runtime";
import type { TileProps } from "../types";
import { icon, PluginIconButton } from "./Controls";
import { LoadedNativePlayer } from "./LoadedNativePlayer";
export function NativePlayerTile({
  audio,
  item,
  nativePlayer,
  nextItem,
  onAudioChange,
  onPositionChange,
  playback,
  previousItem,
  resumeTime,
  useFindScene,
}: TileProps) {
  const sceneId = item.scene?.id ?? item.id;
  const sceneQuery = useFindScene(sceneId);
  const [audioState, setAudioState] = React.useState(
    () =>
      audio ?? {
        muted: playback.startMuted,
        volume: 1,
      },
  );
  const startMuted = React.useRef(playback.startMuted);
  React.useEffect(() => {
    if (startMuted.current === playback.startMuted) return;
    startMuted.current = playback.startMuted;
    setAudioState({
      muted: playback.startMuted,
      volume: 1,
    });
  }, [playback.startMuted]);
  if (sceneQuery.loading) {
    return (
      <div className="ms-error">
        <div className="ms-error-content">Loading scene</div>
      </div>
    );
  }
  if (sceneQuery.error || !sceneQuery.data?.findScene) {
    return (
      <div className="ms-native-tile ms-error-tile">
        <div className="ms-error">
          <div className="ms-error-content">
            {"The native Stash player could not load this scene."}
            {sceneQuery.error?.message && <div className="ms-error-detail">{sceneQuery.error.message}</div>}
          </div>
        </div>
        <div className="ms-error-actions">
          <PluginIconButton ariaLabel="Previous scene" fallback="<" icon={icon("previous")} onClick={previousItem} />
          <PluginIconButton ariaLabel="Next scene" fallback=">" icon={icon("next")} onClick={nextItem} />
        </div>
      </div>
    );
  }
  return (
    <LoadedNativePlayer
      key={item.id}
      audioState={audioState}
      item={item}
      nativePlayer={nativePlayer}
      nextItem={nextItem}
      onAudioStateChange={value => {
        setAudioState(value);
        onAudioChange(value);
      }}
      onPositionChange={onPositionChange}
      playback={playback}
      previousItem={previousItem}
      resumeTime={resumeTime}
      scene={sceneQuery.data.findScene}
    />
  );
}
