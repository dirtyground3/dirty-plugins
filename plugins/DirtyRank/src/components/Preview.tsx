import type * as R from "react";
import type { PreviewMedia } from "../types";
import type { ViewDependencies } from "../view";
export function createPreview(dependencies: Pick<ViewDependencies, "React" | "PluginApi" | "useState" | "useEffect" | "useRef" | "useCallback">) {
  const { React, PluginApi, useState, useEffect, useRef, useCallback } = dependencies;
  function NativePreviewPlayer(props: { media: PreviewMedia }): R.JSX.Element | null {
    var query = PluginApi.utils!.StashService!.useFindScene(props.media.id);
    if (query.loading) return (<div className="dirty-rank-scene-loading" role="status">
      {"Loading scene player…"}
    </div>);
    if (query.error || !query.data || !query.data.findScene) {
      return (<div className="dirty-rank-scene-error" role="alert">
        {"Could not load the scene player. Close it and try again."}
      </div>);
    }
    return (<LoadedNativePreview scene={query.data.findScene} marker={props.media.marker} />);
  }

  function LoadedNativePreview(props: { scene: PreviewMedia; marker?: PreviewMedia["marker"] }): R.JSX.Element | null {
    var hostRef = useRef<HTMLDivElement>(null);
    var marker = props.marker;
    var initialTimestamp = useState(function () {
      if (marker) return Number(marker.seconds) || 0;
      var duration = Number(props.scene.files?.[0] && props.scene.files[0].duration);
      return Number.isFinite(duration) && duration > 0 ? duration * (0.3 + Math.random() * 0.4) : 0;
    })[0];
    var sendSetTimestamp = useCallback(function () { }, []);
    useEffect(function () {
      var host = hostRef.current;
      if (!host) return undefined;
      var player: import("../host").NativePlayer | null = null;
      let active = true;
      function checkMarkerEnd() {
        if (!player || player.isDisposed() || !marker) return;
        var start = Number(marker.seconds) || 0;
        var end = Number(marker.end_seconds);
        if (!Number.isFinite(end) || end <= start) end = start + 30;
        if (player.currentTime() >= end) player.pause();
      }
      function checkMarkerStart() {
        if (!player || player.isDisposed() || !marker) return;
        var start = Number(marker.seconds) || 0;
        var end = Number(marker.end_seconds);
        if (!Number.isFinite(end) || end <= start) end = start + 30;
        if (player.currentTime() < start || player.currentTime() >= end) player.currentTime(start);
      }
      function attach() {
        if (!active) return;
        var element = host!.querySelector<HTMLElement & { player?: import("../host").NativePlayer }>("video-js");
        var next = element && element.player;
        if (!next) { detach(); return; }
        if (next === player) return;
        detach();
        player = next;
        player!.ready(function () {
          if (!active || player !== next || next!.isDisposed()) return;
          // Each preview starts muted without changing Stash's saved volume preference.
          var persistence = next!.persistVolume && next!.persistVolume();
          if (persistence) {
            persistence.enabled = false;
            persistence.ready = function () { };
          }
          next!.muted(true);
        });
        player!.on("timeupdate", checkMarkerEnd);
        player.on("play", checkMarkerStart);
      }
      function detach() {
        if (player && !player.isDisposed()) {
          player.off("timeupdate", checkMarkerEnd);
          player.off("play", checkMarkerStart);
        }
        player = null;
      }
      attach();
      var observer = new MutationObserver(attach);
      observer.observe(host, { childList: true, subtree: true });
      return function () {
        active = false; observer.disconnect();
        detach();
        // ScenePlayer owns disposal of its player and active stream on unmount.
      };
    }, [marker]);
    return (<div className="dirty-rank-native-preview dirty-rank-scene-player" ref={hostRef}>
      <PluginApi.components.ScenePlayer
        scene={props.scene}
        autoplay={true}
        permitLoop={false}
        hideScrubberOverride={true}
        initialTimestamp={initialTimestamp}
        sendSetTimestamp={sendSetTimestamp}
        onComplete={sendSetTimestamp} />
    </div>);
  }
  return { NativePreviewPlayer, LoadedNativePreview };
}
