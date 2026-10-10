import { NativePreviewPlayer } from "./Preview";
import { PrecisionBadge, RankButton, RankCrown } from "./Primitives";
import { loadNativePreviewPlayer, loadPreferredMedia, needsNativePreview, scenePlaybackUrl } from "../domain/rank";
import { PluginApi, React, Router } from "../runtime";
import type * as R from "react";
import type { PerformerCardProps, PreviewMedia } from "../types";
export function PerformerCard(props: PerformerCardProps): R.JSX.Element | null {
  const { performer, pool, reveal } = props;
  const showImages = !props.settings.hidePerformerImages;
  const NativePerformerCard = showImages && PluginApi.components && PluginApi.components.PerformerCard;
  const [imageReady, setImageReady] = React.useState(!showImages || !performer.image_path);
  const [scene, setScene] = React.useState<PreviewMedia | null>(null);
  const [sceneLoading, setSceneLoading] = React.useState(false);
  const [sceneError, setSceneError] = React.useState("");
  const cardMountedRef = React.useRef(true);
  const mediaRequestRef = React.useRef(0);
  const mediaAbortRef = React.useRef<AbortController | null>(null);
  const autoPreviewTimerRef = React.useRef<number | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const setVideoRef = React.useCallback((node: HTMLVideoElement | null) => {
    if (videoRef.current && videoRef.current !== node) releaseVideo(videoRef.current);
    videoRef.current = node;
  }, []);
  const playbackStartRef = React.useRef<number | null>(null);
  const showMedia = showImages || Boolean(scene) || sceneLoading;
  React.useEffect(() => {
    cardMountedRef.current = true;
    return () => {
      cardMountedRef.current = false;
      cancelMediaRequest();
    };
  }, []);
  React.useEffect(() => {
    if (props.settings.autoPlayTopScenes && Number(performer.scene_count || 0) > 0) {
      setSceneLoading(true);
      autoPreviewTimerRef.current = window.setTimeout(() => {
        openTopScene(true);
      }, 400);
    }
    return cancelMediaRequest;
  }, [performer.id, props.settings.autoPlayTopScenes]);
  function releaseVideo(video: HTMLVideoElement) {
    video.pause();
    video.removeAttribute("src");
    // Reset the media resource immediately, including during React's ref-detachment phase.
    video.load();
  }
  function cancelMediaRequest() {
    if (autoPreviewTimerRef.current !== null) window.clearTimeout(autoPreviewTimerRef.current);
    autoPreviewTimerRef.current = null;
    mediaRequestRef.current += 1;
    if (mediaAbortRef.current) mediaAbortRef.current.abort();
    mediaAbortRef.current = null;
  }
  function markerEndSeconds(media: PreviewMedia | null) {
    if (!media || !media.marker) return null;
    const start = Number(media.marker.seconds) || 0;
    const end = Number(media.marker.end_seconds);
    return Number.isFinite(end) && end > start ? end : start + 30;
  }
  function startMarkerPlayback(event: R.SyntheticEvent<HTMLVideoElement>) {
    // Start once: at the marker, or somewhere in the middle of a full scene.
    if (
      !scene ||
      !cardMountedRef.current ||
      event.currentTarget !== videoRef.current ||
      playbackStartRef.current !== null
    )
      return;
    if (scene.marker) {
      playbackStartRef.current = Number(scene.marker.seconds) || 0;
    } else {
      const duration = event.currentTarget.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;
      playbackStartRef.current = duration * (0.3 + Math.random() * 0.4);
    }
    event.currentTarget.currentTime = playbackStartRef.current;
    const playResult = event.currentTarget.play();
    if (playResult && typeof playResult.catch === "function") playResult.catch(() => {});
  }
  function keepMarkerPlaybackInRange(event: R.SyntheticEvent<HTMLVideoElement>) {
    if (!scene || !scene.marker) return;
    const start = Number(scene.marker.seconds) || 0;
    const end = markerEndSeconds(scene);
    if (event.currentTarget.currentTime < start || event.currentTarget.currentTime >= end!) {
      event.currentTarget.currentTime = start;
    }
  }
  function stopAtMarkerEnd(event: R.SyntheticEvent<HTMLVideoElement>) {
    const end = markerEndSeconds(scene);
    if (end !== null && event.currentTarget.currentTime >= end) event.currentTarget.pause();
  }
  function chooseFromKeyboard(event: R.KeyboardEvent<HTMLElement>) {
    if (props.disabled || props.crowned || event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      props.onChoose!();
    }
  }
  function chooseFromClick(event: R.MouseEvent<HTMLElement>) {
    if (props.disabled || props.crowned || event.defaultPrevented) return;
    if ((event.target as Element).closest && (event.target as Element).closest(".dirty-rank-native-portrait")) return;
    props.onChoose!();
  }
  function chooseNativePhoto(event: R.MouseEvent<HTMLElement>) {
    const target = event.target as Element;
    if (!target.closest || !target.closest(".thumbnail-section")) return;
    if (target.closest("button, input, select, textarea")) return;
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (!props.disabled && !props.crowned) props.onChoose!();
  }
  function toggleTopScene(event: R.MouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (scene || sceneLoading) {
      cancelMediaRequest();
      setVideoRef(null);
      setScene(null);
      setSceneLoading(false);
      setSceneError("");
      return;
    }
    openTopScene(props.settings.autoPlayTopScenes);
  }
  function openTopScene(fullScene: boolean) {
    cancelMediaRequest();
    const requestId = ++mediaRequestRef.current;
    const controller = new AbortController();
    mediaAbortRef.current = controller;
    playbackStartRef.current = null;
    setSceneLoading(true);
    setSceneError("");
    loadPreferredMedia(performer.id, fullScene, controller.signal)
      .then(result => {
        if (result && needsNativePreview(result)) {
          return loadNativePreviewPlayer().then(() => result);
        }
        return result;
      })
      .then(result => {
        if (!cardMountedRef.current || requestId !== mediaRequestRef.current) return;
        if (!result || !scenePlaybackUrl(result)) {
          setSceneError("No playable scene found.");
          return;
        }
        setScene(result);
      })
      .catch(error => {
        if (!cardMountedRef.current || requestId !== mediaRequestRef.current || controller.signal.aborted) return;
        setSceneError(error.message || String(error));
      })
      .finally(() => {
        if (cardMountedRef.current && requestId === mediaRequestRef.current) {
          mediaAbortRef.current = null;
          setSceneLoading(false);
        }
      });
  }
  const rankBadge = reveal && props.rank && <span className="dirty-rank-rank">{"#" + props.rank}</span>;
  return (
    <div
      aria-disabled={props.disabled ? "true" : undefined}
      aria-label={props.crowned ? "King of the hill: " + performer.name : "Choose " + performer.name}
      className={
        "dirty-rank-card" +
        (NativePerformerCard ? " dirty-rank-battle-native" : "") +
        (showMedia ? "" : " dirty-rank-card-no-image") +
        (props.gauntletTarget ? " dirty-rank-card-gauntlet-target" : "") +
        (props.kingTarget ? " dirty-rank-card-king-target" : "") +
        (props.crowned ? " dirty-rank-card-crowned" : "") +
        (props.disabled ? " dirty-rank-card-disabled" : "")
      }
      onClick={chooseFromClick}
      onKeyDown={chooseFromKeyboard}
      role={props.crowned ? "group" : "button"}
      tabIndex={props.disabled || props.crowned ? -1 : 0}
    >
      {props.hillMode && (
        <div className={"dirty-rank-hill-role" + (props.kingTarget ? " dirty-rank-hill-role-champion" : "")}>
          <RankCrown />
          <span>
            {props.crowned
              ? "Hill conquered"
              : props.kingTarget
                ? "Reigning champion"
                : props.hillOpening
                  ? "Contender"
                  : "Challenger"}
          </span>
        </div>
      )}
      {showMedia && (
        <div
          className={
            "dirty-rank-image-wrap" +
            (imageReady ? " dirty-rank-image-ready" : "") +
            (scene || sceneLoading ? " dirty-rank-scene-playing" : "") +
            (!showImages ? " dirty-rank-media-no-portrait" : "")
          }
        >
          {NativePerformerCard ? (
            <div
              className="dirty-rank-native-portrait dirty-rank-native-card"
              onClickCapture={chooseNativePhoto}
              onKeyDown={(event: R.SyntheticEvent<HTMLElement>) => {
                event.stopPropagation();
              }}
            >
              <NativePerformerCard performer={performer} />
              {!props.crowned && <span className="dirty-rank-native-vote-hint">Click photo to vote</span>}
              {rankBadge}
            </div>
          ) : (
            showImages && (
              <div className="dirty-rank-portrait">
                {performer.image_path ? (
                  <img
                    alt=""
                    className="dirty-rank-image"
                    loading="eager"
                    onError={() => {
                      setImageReady(true);
                    }}
                    onLoad={() => {
                      setImageReady(true);
                    }}
                    src={performer.image_path}
                  />
                ) : (
                  <div className="dirty-rank-image-placeholder d-flex flex-column align-items-center justify-content-center">
                    <span>◇</span>
                    <span>No performer image</span>
                  </div>
                )}
                {performer.image_path && !imageReady && <div aria-hidden="true" className="dirty-rank-image-loading" />}
                {!props.crowned && (scene || sceneLoading) && (
                  <span className="dirty-rank-photo-vote-hint">Click photo to vote</span>
                )}
                {rankBadge}
              </div>
            )
          )}
          {(scene || sceneLoading) && (
            <div
              className="dirty-rank-scene-panel"
              onClick={(event: R.MouseEvent<HTMLElement>) => {
                event.stopPropagation();
              }}
              onKeyDown={event => {
                event.stopPropagation();
              }}
            >
              {scene &&
              needsNativePreview(scene) &&
              PluginApi.components &&
              PluginApi.components.ScenePlayer &&
              PluginApi.utils &&
              PluginApi.utils.StashService &&
              typeof PluginApi.utils.StashService.useFindScene === "function" ? (
                <NativePreviewPlayer key={scene.id} media={scene} />
              ) : scene ? (
                <video
                  aria-label={"Scene preview for " + performer.name}
                  className="dirty-rank-scene-player"
                  controls={true}
                  muted={true}
                  onLoadedMetadata={startMarkerPlayback}
                  onDurationChange={startMarkerPlayback}
                  onPlay={keepMarkerPlaybackInRange}
                  onTimeUpdate={stopAtMarkerEnd}
                  onError={event => {
                    if (event.currentTarget !== videoRef.current || !cardMountedRef.current) return;
                    setSceneError("This scene could not be played. Close it and try again.");
                    setVideoRef(null);
                    setScene(null);
                  }}
                  playsInline={true}
                  preload="metadata"
                  ref={setVideoRef}
                  src={scenePlaybackUrl(scene)}
                />
              ) : (
                <div className="dirty-rank-scene-loading" role="status">
                  Loading top scene…
                </div>
              )}
              {scene && (
                <div className="dirty-rank-scene-caption">
                  <span>
                    {scene.marker
                      ? "Marker · " + (scene.marker.title || scene.title || "Untitled")
                      : scene.title || "Top-rated scene"}
                  </span>
                  {Number.isFinite(scene.rating100) && <span>{"Rating " + scene.rating100}</span>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {!showImages && rankBadge}
      {props.gauntletTarget && <span className="dirty-rank-gauntlet-target">Gauntlet target</span>}
      {props.kingTarget && !props.hillMode && (
        <span className="dirty-rank-king-target">
          <RankCrown />
          {"King of the hill"}
        </span>
      )}
      <div className="dirty-rank-card-body">
        <h2 className="dirty-rank-performer-name">
          <Router.NavLink
            className="dirty-rank-performer-link"
            onClick={(event: R.MouseEvent<HTMLElement>) => {
              event.stopPropagation();
            }}
            title={"Open " + performer.name}
            to={"/performers/" + performer.id}
          >
            {performer.name}
          </Router.NavLink>
        </h2>
        <div className="dirty-rank-card-meta d-flex flex-wrap align-items-center">
          <span>{Number(performer.scene_count || 0).toLocaleString() + " scenes"}</span>
        </div>
        <div className="dirty-rank-scene-actions">
          <RankButton
            compact={true}
            className="dirty-rank-play-scene"
            disabled={props.disabled || Number(performer.scene_count || 0) < 1}
            onClick={toggleTopScene}
          >
            {sceneLoading
              ? "Cancel loading"
              : scene
                ? scene.marker
                  ? "Close marker"
                  : "Close top scene"
                : "▶ Play top scene"}
          </RankButton>
        </div>
        {sceneError && (
          <div className="dirty-rank-scene-error dirty-ui-text-error" role="alert">
            {sceneError}
          </div>
        )}
        <div className="dirty-rank-rating-row d-flex flex-wrap align-items-center">
          {reveal ? (
            <React.Fragment>
              <span className="dirty-rank-rating-value">{Math.round(pool.rating).toLocaleString()}</span>
              <PrecisionBadge pool={pool} settings={props.settings} />
            </React.Fragment>
          ) : (
            <span className="dirty-rank-hidden-rating">Rating revealed after your choice</span>
          )}
        </div>
      </div>
    </div>
  );
}
