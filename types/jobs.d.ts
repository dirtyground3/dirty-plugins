interface StashJobEvent {
  type: string;
  job?: {id?: string | number; startTime?: string; status?: string; description?: string};
}
interface CompletedJob { kind: "scan" | "generate"; jobId: string; startTime: string; key: string; }
interface JobReplayTracker { claim(key: string): boolean; release(key: string): void; }
