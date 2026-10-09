import type * as R from "react";
import type { PerformerCardProps, PreviewMedia } from "../types";
import type { ViewDependencies } from "../view";
export function createPerformerCard(dependencies: Pick<ViewDependencies, "React" | "Fragment" | "PluginApi" | "NavLink" | "useState" | "useEffect" | "useRef" | "useCallback" | "loadNativePreviewPlayer" | "loadPreferredMedia" | "scenePlaybackUrl" | "needsNativePreview" | "RankCrown" | "RankButton" | "PrecisionBadge" | "NativePreviewPlayer">) {
  const { React, Fragment, PluginApi, NavLink, useState, useEffect, useRef, useCallback, loadNativePreviewPlayer, loadPreferredMedia, scenePlaybackUrl, needsNativePreview, RankCrown, RankButton, PrecisionBadge, NativePreviewPlayer } = dependencies;
  function PerformerCard(props: PerformerCardProps): R.JSX.Element | null {
    var performer = props.performer;
    var pool = props.pool;
    var reveal = props.reveal;
    var showImages = !props.settings.hidePerformerImages;
    var NativePerformerCard = showImages && PluginApi.components && PluginApi.components.PerformerCard;
    var imageState = useState(!showImages || !performer.image_path);
    var imageReady = imageState[0];
    var setImageReady = imageState[1];
    var sceneState = useState<PreviewMedia | null>(null);
    var scene = sceneState[0];
    var setScene = sceneState[1];
    var sceneLoadingState = useState(false);
    var sceneLoading = sceneLoadingState[0];
    var setSceneLoading = sceneLoadingState[1];
    var sceneErrorState = useState("");
    var sceneError = sceneErrorState[0];
    var setSceneError = sceneErrorState[1];
    var cardMountedRef = useRef(true);
    var mediaRequestRef = useRef(0);
    var mediaAbortRef = useRef<AbortController | null>(null);
    var autoPreviewTimerRef = useRef<number | null>(null);
    var videoRef = useRef<HTMLVideoElement | null>(null);
    var setVideoRef = useCallback(function (node: HTMLVideoElement | null) {
      if (videoRef.current && videoRef.current !== node) releaseVideo(videoRef.current);
      videoRef.current = node;
    }, []);
    var playbackStartRef = useRef<number | null>(null);
    var showMedia = showImages || Boolean(scene) || sceneLoading;
    useEffect(function () {
      cardMountedRef.current = true;
      return function () {
        cardMountedRef.current = false;
        cancelMediaRequest();
      };
    }, []);
    useEffect(function () {
      if (props.settings.autoPlayTopScenes && Number(performer.scene_count || 0) > 0) {
        setSceneLoading(true);
        autoPreviewTimerRef.current = window.setTimeout(function () { openTopScene(true); }, 400);
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
      var start = Number(media.marker.seconds) || 0;
      var end = Number(media.marker.end_seconds);
      return Number.isFinite(end) && end > start ? end : start + 30;
    }
    function startMarkerPlayback(event: R.SyntheticEvent<HTMLVideoElement>) {
      if (!scene || !cardMountedRef.current || event.currentTarget !== videoRef.current) return;
      if (playbackStartRef.current === null) {
        if (scene.marker) {
          playbackStartRef.current = Number(scene.marker.seconds) || 0;
        } else {
          var duration = event.currentTarget.duration;
          if (!Number.isFinite(duration) || duration <= 0) return;
          playbackStartRef.current = duration * (0.3 + Math.random() * 0.4);
        }
        event.currentTarget.currentTime = playbackStartRef.current;
      } else {
        return;
      }
      var playResult = event.currentTarget.play();
      if (playResult && typeof playResult.catch === "function") playResult.catch(function () { });
    }
    function keepMarkerPlaybackInRange(event: R.SyntheticEvent<HTMLVideoElement>) {
      if (!scene || !scene.marker) return;
      var start = Number(scene.marker.seconds) || 0;
      var end = markerEndSeconds(scene);
      if (event.currentTarget.currentTime < start || event.currentTarget.currentTime >= end!) {
        event.currentTarget.currentTime = start;
      }
    }
    function stopAtMarkerEnd(event: R.SyntheticEvent<HTMLVideoElement>) {
      var end = markerEndSeconds(scene);
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
      var target = event.target as Element;
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
      var requestId = ++mediaRequestRef.current;
      var controller = new AbortController();
      mediaAbortRef.current = controller;
      playbackStartRef.current = null;
      setSceneLoading(true);
      setSceneError("");
      loadPreferredMedia(performer.id, fullScene, controller.signal).then(function (result) {
        if (result && needsNativePreview(result)) {
          return loadNativePreviewPlayer().then(function () { return result; });
        }
        return result;
      }).then(function (result) {
        if (!cardMountedRef.current || requestId !== mediaRequestRef.current) return;
        if (!result || !scenePlaybackUrl(result)) {
          setSceneError("No playable scene found.");
          return;
        }
        setScene(result);
      }).catch(function (error) {
        if (!cardMountedRef.current || requestId !== mediaRequestRef.current || controller.signal.aborted) return;
        setSceneError(error.message || String(error));
      }).finally(function () {
        if (cardMountedRef.current && requestId === mediaRequestRef.current) {
          mediaAbortRef.current = null;
          setSceneLoading(false);
        }
      });
    }
    return (<div
      aria-disabled={props.disabled ? "true" : undefined}
      aria-label={props.crowned ? "King of the hill: " + performer.name : "Choose " + performer.name}
      className={"dirty-rank-card" + (NativePerformerCard ? " dirty-rank-battle-native" : "") + (showMedia ? "" : " dirty-rank-card-no-image") + (props.gauntletTarget ? " dirty-rank-card-gauntlet-target" : "") + (props.kingTarget ? " dirty-rank-card-king-target" : "") + (props.crowned ? " dirty-rank-card-crowned" : "") + (props.disabled ? " dirty-rank-card-disabled" : "")}
      onClick={chooseFromClick}
      onKeyDown={chooseFromKeyboard}
      role={props.crowned ? "group" : "button"}
      tabIndex={props.disabled || props.crowned ? -1 : 0}>
      {props.hillMode && (<div className={"dirty-rank-hill-role" + (props.kingTarget ? " dirty-rank-hill-role-champion" : "")}>
        <RankCrown />
        <span>
          {props.crowned ? "Hill conquered" : props.kingTarget ? "Reigning champion" : props.hillOpening ? "Contender" : "Challenger"}
        </span>
      </div>)}
      {showMedia && (<div
        className={"dirty-rank-image-wrap" + (imageReady ? " dirty-rank-image-ready" : "") + (scene || sceneLoading ? " dirty-rank-scene-playing" : "") + (!showImages ? " dirty-rank-media-no-portrait" : "")}>
        {NativePerformerCard ? (<div
          className="dirty-rank-native-portrait dirty-rank-native-card"
          onClickCapture={chooseNativePhoto}
          onKeyDown={function (event: R.SyntheticEvent<HTMLElement>) { event.stopPropagation(); }}>
          <NativePerformerCard performer={performer} />
          {!props.crowned && (<span className="dirty-rank-native-vote-hint">
            {"Click photo to vote"}
          </span>)}
          {reveal && props.rank && (<span className="dirty-rank-rank">
            {"#" + props.rank}
          </span>)}
        </div>) : showImages && (<div className="dirty-rank-portrait">
          {performer.image_path
            ? (<img
              alt=""
              className="dirty-rank-image"
              loading="eager"
              onError={function () { setImageReady(true); }}
              onLoad={function () { setImageReady(true); }}
              src={performer.image_path} />)
            : (<div className="dirty-rank-image-placeholder d-flex flex-column align-items-center justify-content-center">
              <span>
                {"◇"}
              </span>
              <span>
                {"No performer image"}
              </span>
            </div>)}
          {performer.image_path && !imageReady && (<div aria-hidden="true" className="dirty-rank-image-loading" />)}
          {!props.crowned && (scene || sceneLoading) && (<span className="dirty-rank-photo-vote-hint">
            {"Click photo to vote"}
          </span>)}
          {reveal && props.rank && (<span className="dirty-rank-rank">
            {"#" + props.rank}
          </span>)}
        </div>)}
        {(scene || sceneLoading) && (<div
          className="dirty-rank-scene-panel"
          onClick={function (event: R.MouseEvent<HTMLElement>) { event.stopPropagation(); }}
          onKeyDown={function (event) { event.stopPropagation(); }}>
          {scene && needsNativePreview(scene) && PluginApi.components && PluginApi.components.ScenePlayer &&
            PluginApi.utils && PluginApi.utils.StashService && typeof PluginApi.utils.StashService.useFindScene === "function"
            ? (<NativePreviewPlayer key={scene.id} media={scene} />)
            : scene ? (<video
              aria-label={"Scene preview for " + performer.name}
              className="dirty-rank-scene-player"
              controls={true}
              muted={true}
              onLoadedMetadata={startMarkerPlayback}
              onDurationChange={startMarkerPlayback}
              onPlay={keepMarkerPlaybackInRange}
              onTimeUpdate={stopAtMarkerEnd}
              onError={function (event) {
                if (event.currentTarget !== videoRef.current || !cardMountedRef.current) return;
                setSceneError("This scene could not be played. Close it and try again.");
                setVideoRef(null);
                setScene(null);
              }}
              playsInline={true}
              preload="metadata"
              ref={setVideoRef}
              src={scenePlaybackUrl(scene)} />) : (<div className="dirty-rank-scene-loading" role="status">
                {"Loading top scene…"}
              </div>)}
          {scene && (<div className="dirty-rank-scene-caption">
            <span>
              {scene.marker
                ? "Marker · " + (scene.marker.title || scene.title || "Untitled")
                : scene.title || "Top-rated scene"}
            </span>
            {Number.isFinite(scene.rating100) && (<span>
              {"Rating " + scene.rating100}
            </span>)}
          </div>)}
        </div>)}
      </div>)}
      {!showImages && reveal && props.rank && (<span className="dirty-rank-rank">
        {"#" + props.rank}
      </span>)}
      {props.gauntletTarget && (<span className="dirty-rank-gauntlet-target">
        {"Gauntlet target"}
      </span>)}
      {props.kingTarget && !props.hillMode && (<span className="dirty-rank-king-target">
        <RankCrown />
        {"King of the hill"}
      </span>)}
      <div className="dirty-rank-card-body">
        <h2 className="dirty-rank-performer-name">
          <NavLink
            className="dirty-rank-performer-link"
            onClick={function (event: R.MouseEvent<HTMLElement>) { event.stopPropagation(); }}
            title={"Open " + performer.name}
            to={"/performers/" + performer.id}>
            {performer.name}
          </NavLink>
        </h2>
        <div className="dirty-rank-card-meta d-flex flex-wrap align-items-center">
          <span>
            {Number(performer.scene_count || 0).toLocaleString() + " scenes"}
          </span>
        </div>
        <div className="dirty-rank-scene-actions">
          <RankButton
            compact={true}
            className="dirty-rank-play-scene"
            disabled={props.disabled || Number(performer.scene_count || 0) < 1}
            onClick={toggleTopScene}>
            {sceneLoading ? "Cancel loading" : scene ? (scene.marker ? "Close marker" : "Close top scene") : "▶ Play top scene"}
          </RankButton>
        </div>
        {sceneError && (<div className="dirty-rank-scene-error dirty-ui-text-error" role="alert">
          {sceneError}
        </div>)}
        <div className="dirty-rank-rating-row d-flex flex-wrap align-items-center">
          {reveal
            ? (<Fragment>
              <span className="dirty-rank-rating-value">
                {Math.round(pool.rating).toLocaleString()}
              </span>
              <PrecisionBadge pool={pool} settings={props.settings} />
            </Fragment>)
            : (<span className="dirty-rank-hidden-rating">
              {"Rating revealed after your choice"}
            </span>)}
        </div>
      </div>
    </div>);
  }
  return { PerformerCard };
}
