import type * as R from "react";
import { React } from "../runtime";

const startEvents = ["playing", "seeked"];
const stopEvents = ["pause", "waiting", "seeking", "ended", "emptied"];
const isPlaying = (video: HTMLVideoElement) => !video.paused && !video.ended && !video.seeking && video.readyState >= 3;
/** Each item plays up to 10% shorter or longer than the duration, so the screens do not all change together. */
const TV_MODE_VARIATION = 0.1;

/** Time spent watching this item, independent of its initial position and any seeks or loops. */
export function useTvMode(tileRef: R.RefObject<HTMLDivElement>, duration: number | null, advance: () => void) {
  React.useEffect(() => {
    const tile = tileRef.current;
    if (!tile || duration === null) return;
    let remaining = duration * 1000 * (1 + TV_MODE_VARIATION * (2 * Math.random() - 1));
    let pending: { video: HTMLVideoElement; timer: number; startedAt: number } | undefined;
    let advanced = false;

    const stop = () => {
      if (!pending) return;
      window.clearTimeout(pending.timer);
      remaining = Math.max(0, remaining - (performance.now() - pending.startedAt));
      pending = undefined;
    };
    const start = (video: HTMLVideoElement) => {
      if (advanced || pending?.video === video || !isPlaying(video)) return;
      stop();
      pending = {
        video,
        startedAt: performance.now(),
        timer: window.setTimeout(() => {
          stop();
          if (tile.querySelector("video") !== video || !isPlaying(video)) return;
          advanced = true;
          advance();
        }, remaining),
      };
    };
    const onStart = (event: Event) => {
      if (event.target instanceof HTMLVideoElement) start(event.target);
    };
    const onStop = (event: Event) => {
      if (event.target === pending?.video) stop();
    };
    for (const event of startEvents) tile.addEventListener(event, onStart, true);
    for (const event of stopEvents) tile.addEventListener(event, onStop, true);
    const video = tile.querySelector("video");
    if (video) start(video);
    return () => {
      stop();
      for (const event of startEvents) tile.removeEventListener(event, onStart, true);
      for (const event of stopEvents) tile.removeEventListener(event, onStop, true);
    };
  }, [tileRef, duration, advance]);
}
