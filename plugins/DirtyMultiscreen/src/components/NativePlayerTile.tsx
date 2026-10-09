import type { ComponentDependencies, TileProps } from "../types";
export function createNativePlayerTile(deps: ComponentDependencies) {
  const { api: PluginApi, React, useOwnedEffect: useEffect } = deps;
  const { useState } = React;
  const { NavLink } = PluginApi.libraries.ReactRouterDOM;
  const { PluginIconButton, ICONS } = deps.controls;
  const SCENES_ROUTE_PATH = "/scenes", LoadedNativePlayer = deps.LoadedNativePlayer!;
  function NativePlayerTile({ item, nativePlayer, nextItem, playback, previousItem, useFindScene }: TileProps) {
    const sceneId = item.scene?.id ?? item.id;
    const sceneQuery = useFindScene(sceneId);
    const [audioState, setAudioState] = useState(() => ({
      muted: playback.startMuted,
      volume: 1
    }));
    useEffect(() => {
      setAudioState({
        muted: playback.startMuted,
        volume: 1
      });
    }, [playback.startMuted]);
    if (sceneQuery.loading) {
      return (<div className="ms-error"><div className="ms-error-content">{"Loading scene"}</div></div>);
    }
    if (sceneQuery.error || !sceneQuery.data?.findScene) {
      return (<div className="ms-native-tile ms-error-tile">
        <NavLink
          aria-label={`Open scene page for ${item.title}`}
          className="ms-title ms-error-title"
          rel="noopener noreferrer"
          target="_blank"
          title={`Open scene page: ${item.title}`}
          to={`${SCENES_ROUTE_PATH}/${sceneId}`}
        >
          {item.title}
        </NavLink>
        <div className="ms-error">
          <div className="ms-error-content">
            {"The native Stash player could not load this scene."}
            {sceneQuery.error?.message && (<div className="ms-error-detail">{sceneQuery.error.message}</div>)}
          </div>
        </div>
        <div className="ms-error-actions">
          <PluginIconButton
            ariaLabel="Previous scene"
            fallback="<"
            icon={ICONS.previous}
            onClick={previousItem}
          />
          <PluginIconButton
            ariaLabel="Next scene"
            fallback=">"
            icon={ICONS.next}
            onClick={nextItem}
          />
        </div>
      </div>);
    }
    return (<LoadedNativePlayer
      key={item.id}
      audioState={audioState}
      item={item}
      nativePlayer={nativePlayer}
      nextItem={nextItem}
      onAudioStateChange={setAudioState}
      playback={playback}
      previousItem={previousItem}
      scene={sceneQuery.data.findScene}
    />);
  }
  return NativePlayerTile;
}
