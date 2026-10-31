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
  splitScenes: boolean;
  startMuted: boolean;
  randomStart: boolean;
  loopScenes: boolean;
  markerDuration: number;
  pauseWhenHidden: boolean;
}
export interface PlaybackSettings {
  startMuted: boolean;
  randomStart: boolean;
  loop: boolean;
  pauseWhenHidden: boolean;
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
  performers?: { id: string }[];
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
}
export interface SessionSearchResult {
  count: number;
  items: Item[];
}
export type SessionSearch = (text: string, page: number, signal: AbortSignal) => Promise<SessionSearchResult>;
type SelectionSource = "selection" | "marker-selection" | "performer-selection" | "studio-selection";
export type LaunchContext =
  | { source: SelectionSource; selectedIds: string[] }
  | { source: "filter"; filter: Record<string, unknown>; sceneFilter: Record<string, unknown> }
  | { source: "marker-filter"; filter: Record<string, unknown>; markerFilter: Record<string, unknown> }
  | { source: "performer-filter"; filter: Record<string, unknown>; performerFilter: Record<string, unknown> }
  | { source: "studio-filter"; filter: Record<string, unknown>; studioFilter: Record<string, unknown> }
  | { source: "performer-detail"; performerId: string }
  | { source: "studio-detail"; studioId: string };
export type MarkerContext =
  | Extract<LaunchContext, { source: "marker-filter" }>
  | { source: "marker-selection"; selectedIds: string[] };
export interface ListContext {
  filter: { makeFindFilter(): Record<string, unknown>; makeFilter(): Record<string, unknown> };
  selectedIds: Set<string>;
}
export interface QueryVariables extends Record<string, unknown> {
  filter: Record<string, unknown>;
  ids?: string[];
  scene_filter?: Record<string, unknown>;
  scene_marker_filter?: Record<string, unknown>;
}
export interface QueryResult {
  findScenes: { count: number; scenes: Scene[] };
  findSceneMarkers: { count: number; scene_markers: Marker[] };
  findPerformers: { performers: { id: string }[] };
  findStudios: { studios: { id: string }[] };
}
export interface Player {
  currentTime(): number;
  currentTime(value: number): void;
  duration(): number;
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
  playback: PlaybackSettings;
  scene: Scene;
}
export interface TileProps {
  item: Item;
  nativePlayer: NativePlayer;
  nextItem(): void;
  previousItem(): void;
  playback: PlaybackSettings;
  useFindScene: UseFindScene;
}
export interface GridProps {
  continuation?: { initialPage: number; pageCount: number; loadPage(page: number): Promise<Item[][]> };
  columns: number;
  rows: number;
  totalScreens: number;
  nativePlayer: NativePlayer;
  onVisibleSceneIdsChange(ids: string[]): void;
  playback: PlaybackSettings;
  playlists: Item[][];
  searchSession: SessionSearch;
  useFindScene: UseFindScene;
}
export interface CounterAction {
  busy: boolean;
  done: boolean;
  pendingIds: string[] | null;
}
