export type SaveState = "pending" | "saving" | "saved" | "invalid" | "error";
export interface SaveControllerOptions<T, R> {
  delay?: number;
  validate?: (value: T) => string;
  save: (value: T) => Promise<R>;
  onSaved?: (value: T, result: R, current: boolean) => void;
  onError?: (error: Error, value: T, current: boolean) => void;
  onStatus?: (status: { state: SaveState; message: string }) => void;
  setTimeout?: (callback: () => void, delay: number) => number;
  clearTimeout?: (handle: number) => void;
}
export interface SaveController<T, R> {
  schedule(value: T): void;
  cancelPending(): void;
  flush(): Promise<R | null | void>;
  saved(): { value: T; result: R } | null;
  dispose(): void;
}

/** Debounce edits and serialize writes; persistence/conflict policy stays with callers. */
export function createSaveController<T, R>(options: SaveControllerOptions<T, R>): SaveController<T, R> {
  let timer: ReturnType<typeof window.setTimeout> | null = null;
  let generation = 0, disposed = false;
  let chain: Promise<R | null | void> = Promise.resolve();
  let saved: { value: T; result: R; } | null = null;
  const scheduleTimer = options.setTimeout || ((callback, delay) => window.setTimeout(callback, delay));
  const clearTimer = options.clearTimeout || (handle => window.clearTimeout(handle));
  function publish(state: SaveState, message = "") {
    if (!disposed && options.onStatus) options.onStatus({ state, message });
  }
  function cancelPending() {
    generation += 1;
    if (timer !== null) clearTimer(timer);
    timer = null;
  }
  function enqueue(value: T, edit: number) {
    const write = chain.catch(() => { }).then(() => {
      if (disposed) return null;
      if (edit === generation) publish("saving");
      return Promise.resolve().then(() => options.save(value)).then(result => {
        saved = { value, result };
        if (!disposed && options.onSaved) options.onSaved(value, result, edit === generation);
        if (edit === generation) publish("saved");
        return result;
      }).catch((error: Error) => {
        if (!disposed && options.onError) options.onError(error, value, edit === generation);
        if (edit === generation) publish("error", error.message || String(error));
        return null;
      });
    });
    chain = write;
    return write;
  }
  function schedule(value: T) {
    if (disposed) return;
    cancelPending();
    const edit = generation, invalid = options.validate && options.validate(value);
    if (invalid) { publish("invalid", invalid); return; }
    publish("pending");
    timer = scheduleTimer(() => { timer = null; enqueue(value, edit); }, options.delay === undefined ? 350 : options.delay);
  }
  return {
    schedule, cancelPending, flush: () => chain, saved: () => saved,
    dispose: () => { cancelPending(); disposed = true; }
  };
}
