import type * as R from "react";
import { React } from "./runtime";
import { createSaveController } from "./save";
import type { SaveController, SaveControllerOptions, SaveState } from "./save";

export interface SettingsDraftOptions<T, Loaded, Serialized, Result> {
  initialValue: T;
  load(): Promise<Loaded>;
  normalize(value: Loaded): T;
  validate(value: T): string;
  comparable(value: T): string;
  /** Snapshot raw input; normalization must never erase an invalid edit. */
  serialize(value: T): Serialized;
  save(value: Serialized): Promise<Result>;
  onLoaded?(value: Loaded, draft: T): void;
  onSaved?(draft: T, result: Result, current: boolean): void;
  onError?(error: Error, draft: T, current: boolean): void;
  onDirtyChange?(dirty: boolean): void;
  delay?: number;
  setTimeout?: SaveControllerOptions<T, Result>["setTimeout"];
  clearTimeout?: SaveControllerOptions<T, Result>["clearTimeout"];
}
export interface SettingsDraft<T> {
  draft: T;
  setDraft: R.Dispatch<R.SetStateAction<T>>;
  dirty: boolean;
  invalid: string;
  ready: boolean;
  status: { state: "loading" | SaveState; message: string };
  error: string;
  reload(): Promise<void>;
  retry(): void;
}

/** Injectable host hooks for module tests; persistence/revision policy is external. */
export function createSettingsDraftHook(hooks: Pick<typeof R, "useState" | "useRef" | "useEffect" | "useCallback">) {
  return function useSettingsDraft<T, Loaded, Serialized, Result>(
    options: SettingsDraftOptions<T, Loaded, Serialized, Result>,
  ): SettingsDraft<T> {
    const { useState, useRef, useEffect, useCallback } = hooks;
    const latest = useRef(options);
    latest.current = options;
    const [draft, setDraft] = useState(options.initialValue);
    const [ready, setReady] = useState(false);
    const [status, setStatus] = useState<SettingsDraft<T>["status"]>({ state: "loading", message: "" });
    const [error, setError] = useState("");
    // The saved baseline is state, not a ref: React 17 can render, see an
    // unchanged update and bail out, keeping the new effect deps without
    // running the effect, so a ref-derived dirty flag would never report false.
    const [saved, setSaved] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const mounted = useRef(true),
      blocked = useRef(false),
      loading = useRef(0);
    const controller = useRef<SaveController<{ draft: T; serialized: Serialized }, Result> | null>(null);
    if (!controller.current)
      controller.current = createSaveController({
        delay: options.delay,
        setTimeout: options.setTimeout,
        clearTimeout: options.clearTimeout,
        save: request => latest.current.save(request.serialized),
        onSaved: (request, result, current) => {
          // A completed older write still advances the saved baseline. It must
          // never overwrite the draft that was edited during the request.
          setSaved(latest.current.comparable(request.draft));
          latest.current.onSaved?.(request.draft, result, current);
          setError("");
        },
        onError: (failure, request, current) => {
          blocked.current = true;
          latest.current.onError?.(failure, request.draft, current);
        },
        onStatus: value => {
          setStatus(value);
          if (value.state === "error" || value.state === "invalid") setError(value.message);
        },
      });
    const reload = useCallback(async () => {
      const request = ++loading.current;
      controller.current!.cancelPending();
      try {
        const value = await latest.current.load();
        if (!mounted.current || request !== loading.current) return;
        const normalized = latest.current.normalize(value);
        latest.current.onLoaded?.(value, normalized);
        setSaved(latest.current.comparable(normalized));
        blocked.current = false;
        setDraft(normalized);
        setReady(true);
        setStatus({ state: "saved", message: "" });
        setError("");
      } catch (failure) {
        if (mounted.current && request === loading.current)
          setError(failure instanceof Error ? failure.message : String(failure));
      }
    }, []);
    useEffect(() => {
      reload();
      return () => {
        mounted.current = false;
        loading.current += 1;
        controller.current!.dispose();
      };
    }, [reload]);
    // Nothing is unsaved before the first load provides a baseline.
    const dirty = saved !== null && latest.current.comparable(draft) !== saved;
    const invalid = latest.current.validate(draft);
    useEffect(() => {
      latest.current.onDirtyChange?.(dirty);
      return () => latest.current.onDirtyChange?.(false);
    }, [dirty]);
    useEffect(() => {
      if (ready && dirty && !blocked.current) {
        if (invalid) {
          setStatus({ state: "invalid", message: invalid });
          setError(invalid);
        } else {
          try {
            controller.current!.schedule({ draft, serialized: latest.current.serialize(draft) });
          } catch (failure) {
            const message = failure instanceof Error ? failure.message : String(failure);
            setStatus({ state: "invalid", message });
            setError(message);
          }
        }
      }
      return () => controller.current!.cancelPending();
    }, [draft, dirty, invalid, ready, attempt]);
    const edit: SettingsDraft<T>["setDraft"] = useCallback(value => {
      setDraft(value);
      setStatus({ state: "pending", message: "" });
    }, []);
    const retry = useCallback(() => {
      blocked.current = false;
      setError("");
      setAttempt(value => value + 1);
    }, []);
    return { draft, setDraft: edit, dirty, invalid, ready, status, error, reload, retry };
  };
}

export function useSettingsDraft<T, Loaded, Serialized, Result>(
  options: SettingsDraftOptions<T, Loaded, Serialized, Result>,
): SettingsDraft<T> {
  return createSettingsDraftHook(React)(options);
}
