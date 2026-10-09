import type * as R from "react";
import type { HubApi } from "../../DirtyPlugins/src/types";
export type Hub = Pick<HubApi, "graphql" | "values" | "settingsMetadata" | "react" | "native" | "getPluginSettings" | "captureEnabled" | "debugLog">;
export interface Settings { totalScreens: number; rows: number; columns: number; randomize: boolean; splitScenes: boolean; startMuted: boolean; randomStart: boolean; loopScenes: boolean; markerDuration: number; pauseWhenHidden: boolean; }
export interface PlaybackSettings { startMuted: boolean; randomStart: boolean; loop: boolean; pauseWhenHidden: boolean; }
export interface Scene { id: string; title?: string | null; paths?: { stream?: string | null }; sceneStreams?: { url: string; mime_type?: string; label?: string }[]; files?: { duration?: number }[]; }
export interface Marker { id: string; title: string; seconds: number; end_seconds?: number | null; primary_tag: { name: string }; scene: Scene; }
export interface Item { id: string; title: string; scene: Scene; playbackRange?: { start: number; end: number }; }
type SelectionSource = "selection" | "marker-selection" | "performer-selection" | "studio-selection";
export type LaunchContext = { source: SelectionSource; selectedIds: string[] } |
{ source: "filter"; filter: Record<string, unknown>; sceneFilter: Record<string, unknown> } |
{ source: "marker-filter"; filter: Record<string, unknown>; markerFilter: Record<string, unknown> } |
{ source: "performer-filter"; filter: Record<string, unknown>; performerFilter: Record<string, unknown> } |
{ source: "studio-filter"; filter: Record<string, unknown>; studioFilter: Record<string, unknown> } |
{ source: "performer-detail"; performerId: string } | { source: "studio-detail"; studioId: string };
export type MarkerContext = Extract<LaunchContext, { source: "marker-filter" }> | { source: "marker-selection"; selectedIds: string[] };
export interface ListContext { filter: { makeFindFilter(): Record<string, unknown>; makeFilter(): Record<string, unknown> }; selectedIds: Set<string>; }
export interface QueryVariables extends Record<string, unknown> { filter: Record<string, unknown>; ids?: string[]; scene_filter?: Record<string, unknown>; scene_marker_filter?: Record<string, unknown>; }
export interface QueryResult { findScenes: { count: number; scenes: Scene[] }; findSceneMarkers: { count: number; scene_markers: Marker[] }; findPerformers: { performers: { id: string }[] }; findStudios: { studios: { id: string }[] }; }
export interface Player { volume(): number; volume(value: number): void; muted(): boolean; muted(value: boolean): void; isDisposed?(): boolean; persistVolume?(): { enabled: boolean; ready(): void }; on(event: string, listener: () => void): void; off?(event: string, listener: () => void): void; ready(listener: () => void): void; }
export interface VideoPlayerElement extends Element { player?: Player; }
export interface AudioState { muted: boolean; volume: number; }
export interface NativePlayerProps { scene: Scene; autoplay: boolean; hideScrubberOverride: boolean; initialTimestamp: number; permitLoop: boolean; onComplete(): void; onNext(): void; onPrevious(): void; sendSetTimestamp(callback: (seconds: number) => void): void; }
export type NativePlayer = R.ComponentType<NativePlayerProps>;
export type UseFindScene = (id: string) => { loading: boolean; error?: Error; data?: { findScene?: Scene | null } };
// Native Stash patch props are host-owned and vary by version. This is the
// sole permissive boundary; domains, effects and component props stay typed.
export interface Host {  
React: typeof R; register: { route(path: string, component: R.ComponentType): void }; patch: { before(name: string, handler: (props: Record<string, any>) => unknown[]): void };
  libraries: { ReactRouterDOM: { NavLink: R.ComponentType<Record<string, unknown>>; useLocation(): { pathname: string } }; FontAwesomeSolid?: Record<string, unknown> }; components?: { ScenePlayer?: NativePlayer }; utils?: { StashService?: { useFindScene: UseFindScene } };
}
export interface Lifetime { active: boolean; effects: Set<() => void>; }
export interface Dependencies { api: Host; hub: Hub; life: Lifetime; }
export interface LoadedPlayerProps { audioState: AudioState; item: Item; nativePlayer: NativePlayer; nextItem(): void; previousItem(): void; onAudioStateChange(value: AudioState): void; playback: PlaybackSettings; scene: Scene; }
export interface TileProps { item: Item; nativePlayer: NativePlayer; nextItem(): void; previousItem(): void; playback: PlaybackSettings; useFindScene: UseFindScene; }
export interface GridProps { columns: number; rows: number; totalScreens: number; nativePlayer: NativePlayer; onVisibleSceneIdsChange(ids: string[]): void; playback: PlaybackSettings; playlists: Item[][]; useFindScene: UseFindScene; }
export interface CounterAction { busy: boolean; done: boolean; pendingIds: string[] | null; }
export interface ComponentDependencies extends Dependencies {  
React: typeof R; contexts: ReturnType<typeof import("./contexts").createContexts>; queries: ReturnType<typeof import("./queries").createQueries>; settingsDomain: ReturnType<typeof import("./domain/settings").createSettingsDomain>;
  controls: ReturnType<typeof import("./components/Controls").createControls>; counts: ReturnType<typeof import("./counts").createCounts>; observeSubtree: typeof import("./lifecycle").observeSubtree; useOwnedEffect: typeof R.useEffect; useActive(): boolean;
  LoadedNativePlayer?: R.ComponentType<LoadedPlayerProps>; NativePlayerTile?: R.ComponentType<TileProps>; Grid?: R.ComponentType<GridProps>; Counter?: R.ComponentType<{ sceneIds: string[] }>; hooks?: ReturnType<typeof import("./hooks").createHooks>;
}
