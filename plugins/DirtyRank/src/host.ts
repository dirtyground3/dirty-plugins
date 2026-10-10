/** The native Video.js player behind Stash's ScenePlayer. */
export interface NativePlayer {
  isDisposed(): boolean;
  pause(): void;
  muted(value: boolean): void;
  currentTime(): number;
  currentTime(value: number): void;
  ready(callback: () => void): void;
  on(event: string, callback: () => void): void;
  off(event: string, callback: () => void): void;
  persistVolume?(): { enabled: boolean; ready(): void };
}
