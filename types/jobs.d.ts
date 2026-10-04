interface StashJobEvent {
  type: string;
  job?: {id?: string | number; startTime?: string; status?: string; description?: string};
}
interface CompletedJob { kind: "scan" | "generate"; jobId: string; startTime: string; key: string; }
interface JobReplayTracker { claim(key: string): boolean; release(key: string): void; }
type JobCompletionHandler = (job: CompletedJob) => Promise<unknown>;
type CompletedJobHook = (event: StashJobEvent | null | undefined, handle: JobCompletionHandler, onError: (error: Error) => void, kind?: CompletedJob["kind"]) => void;
