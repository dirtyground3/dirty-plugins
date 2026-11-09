import type * as R from "react";
import type { HubApi } from "../../DirtyPlugins/src/types";
export type SceneOrder = "random" | "fresh" | "unwatched" | "favorites" | "newest" | "mix" | "list";
export type Hub = Pick<HubApi, "graphql" | "react" | "native" | "getPluginSettings" | "captureEnabled" | "debugLog">;
export interface Settings {
  totalScreens: number;
  rows: number;
  columns: number;
  sceneOrder: SceneOrder;
  spreadScenes: boolean;
  avoidDuplicates: boolean;
  splitScenes: boolean;
  startMuted: boolean;
  randomStart: boolean;
  loopScenes: boolean;
  markerDuration: number;
  pauseWhenHidden: boolean;
  showPerformerNavigation: boolean;
}
export interface PlaybackSettings {
  startMuted: boolean;
  randomStart: boolean;
  loop: boolean;
  pauseWhenHidden: boolean;
}
export interface Performer {
  id: string;
  name?: string | null;
  image_path?: string | null;
}
export interface Scene {
  id: string;
  title?: string | null;
  resume_time?: number | null;
  paths?: { stream?: string | null; vtt?: string | null };
  sceneStreams?: { url: string; mime_type?: string; label?: string }[];
  files?: { duration?: number }[];
  play_count?: number | null;
  last_played_at?: string | null;
  o_counter?: number | null;
  rating100?: number | null;
  created_at?: string | null;
  performers?: Performer[];
  studio?: { id: string } | null;
}
export interface Marker {
  id: string;
  title: string;
  seconds: number;
  end_seconds?: number | null;
  primary_tag: { name: string };
  scene: Scene;
}
export interface Item {
  id: string;
  title: string;
  scene: Scene;
  playbackRange?: { start: number; end: number };
  /** Added to a pane from outside its page, so the saved session keeps it. */
  outsidePage?: boolean;
}
export interface SessionSearchResult {
  count: number;
  items: Item[];
}
export type SessionSearch = (text: string, page: number, signal: AbortSignal) => Promise<SessionSearchResult>;
/** The session's items featuring a performer; an ID list returns only the one after `playing`. */
export type FindPerformerItems = (
  performerId: string,
  playing: Item | undefined,
  signal: AbortSignal,
) => Promise<Item[]>;
export type ListKind = "scenes" | "markers";
export type OtherPluginLists = "off" | "known" | "any";
export interface ListSettings {
  allow: OtherPluginLists;
  limit: number;
}
/** One `stash-scenes:context` event after validation; `ids: null` withdraws the plugin's list for the path. */
export interface Announcement {
  source: string;
  path: string;
  kind: ListKind;
  ids: string[] | null;
  keepOrder: boolean;
  label: string;
}
/** A list another plugin announced, launched as IDs in its own order. */
export interface PluginList {
  source: "plugin-list";
  kind: ListKind;
  ids: string[];
  keepOrder: boolean;
  label: string;
}
type SelectionSource = "selection" | "marker-selection" | "performer-selection" | "studio-selection" | "tag-selection";
export type LaunchContext =
  | PluginList
  | { source: SelectionSource; selectedIds: string[] }
  | { source: "filter"; filter: Record<string, unknown>; sceneFilter: Record<string, unknown> }
  | { source: "marker-filter"; filter: Record<string, unknown>; markerFilter: Record<string, unknown> }
  | { source: "performer-filter"; filter: Record<string, unknown>; performerFilter: Record<string, unknown> }
  | { source: "studio-filter"; filter: Record<string, unknown>; studioFilter: Record<string, unknown> }
  | { source: "tag-filter"; filter: Record<string, unknown>; tagFilter: Record<string, unknown> }
  | { source: "performer-detail"; performerId: string }
  | { source: "studio-detail"; studioId: string }
  | { source: "tag-detail"; tagId: string };
export type MarkerContext =
  | Extract<LaunchContext, { source: "marker-filter" }>
  | { source: "marker-selection"; selectedIds: string[] }
  | (PluginList & { kind: "markers" });
export interface ListContext {
  filter: { makeFindFilter(): Record<string, unknown>; makeFilter(): Record<string, unknown> };
  selectedIds: Set<string>;
}
export interface QueryVariables extends Record<string, unknown> {
  filter: Record<string, unknown>;
  ids?: string[];
  /** A whole ID list, loaded `filter.per_page` IDs at a time. Never sent to Stash. */
  list?: string[];
  scene_filter?: Record<string, unknown>;
  scene_marker_filter?: Record<string, unknown>;
}
export interface QueryResult {
  findScenes: { count: number; scenes: Scene[] };
  findSceneMarkers: { count: number; scene_markers: Marker[] };
  findPerformers: { performers: { id: string }[] };
  findStudios: { studios: { id: string }[] };
  findTags: { tags: { id: string }[] };
}
export interface Player {
  currentTime(): number;
  currentTime(value: number): void;
  duration(): number;
  play(): Promise<unknown> | undefined;
  readyState(): number;
  volume(): number;
  volume(value: number): void;
  muted(): boolean;
  muted(value: boolean): void;
  isDisposed?(): boolean;
  persistVolume?(): { enabled: boolean; ready(): void };
  on(event: string, listener: () => void): void;
  off?(event: string, listener: () => void): void;
  ready(listener: () => void): void;
}
export interface VideoPlayerElement extends Element {
  player?: Player;
}
export interface AudioState {
  muted: boolean;
  volume: number;
}
/** Where one pane was; absent time and audio fall back to the pane's normal start. */
export interface SavedPane {
  page: number;
  itemId: string;
  /** The scene itself when no page of the session holds it for this pane. */
  item?: Item;
  time?: number;
  audio?: AudioState;
}
/** Enough to deal the same queue again: playlists are rebuilt from these seeds, never stored. */
export interface SavedSession {
  context: LaunchContext | null;
  queue: string;
  sort?: string;
  seed: number;
  now: number;
  panes: Array<SavedPane | null>;
}
export interface NativePlayerProps {
  scene: Scene;
  autoplay: boolean;
  hideScrubberOverride: boolean;
  initialTimestamp: number;
  permitLoop: boolean;
  onComplete(): void;
  onNext(): void;
  onPrevious(): void;
  sendSetTimestamp(callback: (seconds: number) => void): void;
}
export type NativePlayer = R.ComponentType<NativePlayerProps>;
export type UseFindScene = (id: string) => { loading: boolean; error?: Error; data?: { findScene?: Scene | null } };
// Native Stash patch props are host-owned and vary by version. This is the
// sole permissive boundary; domains, effects and component props stay typed.
export interface LoadedPlayerProps {
  audioState: AudioState;
  item: Item;
  nativePlayer: NativePlayer;
  nextItem(): void;
  previousItem(): void;
  onAudioStateChange(value: AudioState): void;
  onPositionChange(seconds: number): void;
  playback: PlaybackSettings;
  /** Takes precedence over every other start of this item. */
  resumeTime?: number;
  scene: Scene;
}
export interface TileProps {
  /** The audio this tile starts with instead of the start-muted setting. */
  audio?: AudioState;
  item: Item;
  nativePlayer: NativePlayer;
  nextItem(): void;
  onAudioChange(value: AudioState): void;
  onPositionChange(seconds: number): void;
  previousItem(): void;
  playback: PlaybackSettings;
  resumeTime?: number;
  useFindScene: UseFindScene;
}
export interface GridProps {
  avoidDuplicates: boolean;
  continuation?: { initialPage: number; pageCount: number; loadPage(page: number): Promise<Item[][]> };
  findPerformerItems: FindPerformerItems;
  columns: number;
  rows: number;
  totalScreens: number;
  nativePlayer: NativePlayer;
  onSessionChange(panes: Array<SavedPane | null>): void;
  onVisibleSceneIdsChange(ids: string[]): void;
  playback: PlaybackSettings;
  playlists: Item[][];
  /** Pane positions of a resumed session, read when the grid mounts. */
  savedPanes?: Array<SavedPane | null>;
  searchSession: SessionSearch;
  showPerformerNavigation: boolean;
  useFindScene: UseFindScene;
}
export interface CounterAction {
  busy: boolean;
  done: boolean;
  pendingIds: string[] | null;
}
