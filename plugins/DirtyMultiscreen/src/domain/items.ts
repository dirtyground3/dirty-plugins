import type { Scene, Marker } from "../types";
export const getSceneTitle = (scene: Scene) => {
  const title = scene.title?.trim();
  return title && title.length > 0 ? title : `Scene ${scene.id}`;
};
export const getSceneStreamUrl = (scene: Scene) => {
  const directStream = scene.paths?.stream;
  if (directStream) return directStream;
  return scene.sceneStreams?.find(stream => !!stream.url)?.url ?? "";
};
export const getSceneItem = (scene: Scene) => {
  if (!getSceneStreamUrl(scene)) return null;
  return {
    id: scene.id,
    title: getSceneTitle(scene),
    scene,
  };
};
export const getMarkerItem = (marker: Marker, fallbackDuration: number) => {
  if (!getSceneStreamUrl(marker.scene)) return null;
  const title =
    marker.title.trim() ||
    marker.primary_tag.name.trim() ||
    `${getSceneTitle(marker.scene)} @ ${Math.floor(marker.seconds)}s`;
  const requestedEnd = marker.end_seconds ?? marker.seconds + fallbackDuration;
  const end = requestedEnd > marker.seconds ? requestedEnd : marker.seconds + fallbackDuration;
  return {
    id: `marker-${marker.id}`,
    title,
    playbackRange: {
      start: marker.seconds,
      end,
    },
    scene: marker.scene,
  };
};

export function orderSelected<T extends { id: string }>(items: T[], ids?: string[]): T[] {
  const byId = new Map(items.map(item => [item.id, item]));
  return ids ? ids.map(id => byId.get(id)).filter((item): item is T => !!item) : items;
}
