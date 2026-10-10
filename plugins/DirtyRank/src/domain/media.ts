import { DirtyPlugins } from "../runtime";
import type { PreviewMedia } from "../types";

const cache = new Map<string, PreviewMedia | null>();
let generation = 0;
export function invalidatePerformerMedia() {
  generation++;
  cache.clear();
}
const SCENE_FIELDS = "id title rating100 paths{stream} sceneStreams{url mime_type label}";
export async function loadPreferredMedia(performerId: string, fullScene: boolean, signal?: AbortSignal) {
  const key = String(performerId) + (fullScene ? ":scene" : ":preferred");
  if (cache.has(key)) return cache.get(key);
  const revision = generation;
  const performers = { value: [String(performerId)], modifier: "INCLUDES" };
  const data = await DirtyPlugins.graphql<{
    top?: { scenes: PreviewMedia[] };
    marked?: { scenes: PreviewMedia[] };
  }>(
    "query DirtyRankPreferredMedia($filter:FindFilterType,$sceneFilter:SceneFilterType,$markedFilter:SceneFilterType,$includeMarkers:Boolean!){" +
      "top:findScenes(filter:$filter,scene_filter:$sceneFilter){scenes{" +
      SCENE_FIELDS +
      "}}" +
      "marked:findScenes(filter:$filter,scene_filter:$markedFilter) @include(if:$includeMarkers){scenes{id rating100}}}",
    {
      filter: { per_page: 1, sort: "rating", direction: "DESC" },
      sceneFilter: { performers },
      markedFilter: { performers, has_markers: "true" },
      includeMarkers: !fullScene,
    },
    { signal },
  );
  let media = data.top?.scenes[0] || null;
  const marked = data.marked?.scenes[0];
  if (!fullScene && marked && !signal?.aborted) {
    // Include all scenes tied at the best rating, so the earliest marker wins across ties.
    const markers = await DirtyPlugins.graphql<{
      markers: {
        scene_markers: Array<{
          id: string;
          title?: string;
          seconds: number;
          end_seconds?: number | null;
          scene: PreviewMedia;
        }>;
      };
    }>(
      "query DirtyRankEarliestMarker($filter:FindFilterType,$markerFilter:SceneMarkerFilterType){" +
        "markers:findSceneMarkers(filter:$filter,scene_marker_filter:$markerFilter){scene_markers{" +
        "id title seconds end_seconds scene{" +
        SCENE_FIELDS +
        "}}}}",
      {
        filter: { per_page: 1, sort: "seconds", direction: "ASC" },
        markerFilter: {
          performers,
          scene_filter: {
            rating100:
              marked.rating100 == null
                ? { value: 0, modifier: "IS_NULL" }
                : { value: marked.rating100, modifier: "EQUALS" },
          },
        },
      },
      { signal },
    );
    const marker = markers.markers.scene_markers[0];
    if (marker)
      media = {
        ...marker.scene,
        marker: {
          id: marker.id,
          title: marker.title,
          seconds: Number(marker.seconds) || 0,
          end_seconds: marker.end_seconds == null ? null : Number(marker.end_seconds),
        },
      };
  }
  if (revision === generation && !signal?.aborted) cache.set(key, media);
  return media;
}
export function scenePlaybackUrl(scene: PreviewMedia | null | undefined) {
  const streams = scene && Array.isArray(scene.sceneStreams) ? scene.sceneStreams : [];
  const directPath = scene && scene.paths && scene.paths.stream;
  const preferred =
    streams.find(stream => stream.mime_type === "video/mp4" && /direct/i.test(stream.label || "")) ||
    streams.find(stream => stream.mime_type === "video/mp4" && /720p/i.test(stream.label || "")) ||
    streams.find(stream => stream.mime_type === "video/mp4");
  // Stash's original stream can be a format the browser cannot play (e.g. WMV).
  return (preferred && preferred.url) || directPath || "";
}
export function needsNativePreview(scene: PreviewMedia | null | undefined) {
  return /\/stream\.(mp4|webm)(?:\?|$)/i.test(scenePlaybackUrl(scene));
}
