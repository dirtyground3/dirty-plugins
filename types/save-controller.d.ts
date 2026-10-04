type SaveState = "pending" | "saving" | "saved" | "invalid" | "error";
interface SaveControllerOptions<T, R> {
  delay?: number;
  validate?: (value: T) => string;
  save: (value: T) => Promise<R>;
  onSaved?: (value: T, result: R, current: boolean) => void;
  onError?: (error: Error, value: T, current: boolean) => void;
  onStatus?: (status: { state: SaveState; message: string }) => void;
  setTimeout?: (callback: () => void, delay: number) => any;
  clearTimeout?: (handle: any) => void;
}
interface SaveController<T, R> {
  schedule(value: T): void;
  cancelPending(): void;
  flush(): Promise<R | null | void>;
  saved(): { value: T; result: R } | null;
  dispose(): void;
}
