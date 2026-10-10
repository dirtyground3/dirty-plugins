import type * as R from "react";
export interface StashJobEvent {
  type: string;
  job?: { id?: string | number; startTime?: string; status?: string; description?: string };
}
export interface CompletedJob {
  kind: "scan" | "generate";
  jobId: string;
  startTime: string;
  key: string;
}
export interface JobReplayTracker {
  claim(key: string): boolean;
  release(key: string): void;
}
export type JobCompletionHandler = (job: CompletedJob) => Promise<unknown>;
export type CompletedJobHook = (
  event: StashJobEvent | null | undefined,
  handle: JobCompletionHandler,
  onError: (error: Error) => void,
  kind?: CompletedJob["kind"],
) => void;
export function completedJob(event: StashJobEvent | null | undefined): CompletedJob | null {
  const job = event && event.job;
  if (!job || event.type !== "REMOVE" || job.status !== "FINISHED" || !job.id || !job.startTime) return null;
  const kind = job.description === "Scanning..." ? "scan" : job.description === "Generating..." ? "generate" : null;
  if (!kind) return null;
  const jobId = String(job.id),
    startTime = job.startTime;
  return { kind, jobId, startTime, key: JSON.stringify([kind, jobId, startTime]) };
}
export function createReplayTracker(capacity?: number): JobReplayTracker {
  const limit = Math.max(1, Math.floor(capacity || 50));
  let keys: string[] = [];
  return {
    claim(key) {
      if (keys.indexOf(key) >= 0) return false;
      keys.push(key);
      if (keys.length > limit) keys.splice(0, keys.length - limit);
      return true;
    },
    release(key) {
      keys = keys.filter(item => item !== key);
    },
  };
}
export function createJobHook(React: Pick<typeof R, "useRef" | "useEffect">): CompletedJobHook {
  return function useCompletedJob(event, handle, onError, kind) {
    const seen = React.useRef<JobReplayTracker | null>(null),
      job = event && event.job;
    if (!seen.current) seen.current = createReplayTracker();
    React.useEffect(() => {
      const completion = completedJob(event);
      if (!completion || (kind && completion.kind !== kind) || !seen.current!.claim(completion.key)) return;
      handle(completion).catch(error => {
        seen.current!.release(completion.key);
        onError(error);
      });
    }, [event && event.type, job && job.id, job && job.status, job && job.description, job && job.startTime]);
  };
}
