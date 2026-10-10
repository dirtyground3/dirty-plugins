import { React } from "../runtime";
import type { IndexStatus as Status } from "../types";
export function IndexStatus({ status }: { status: Status | null }) {
  return (
    <React.Fragment>
      <p role="status">
        {status?.status
          ? status.status +
            " · " +
            (status.checked || 0) +
            " scenes checked · " +
            (status.probed || 0) +
            (status.forceRun ? " files reprobed · " : " new or changed files probed · ") +
            (Number(status.skipped) || 0) +
            " unchanged scenes skipped · " +
            (status.errors || 0) +
            " errors this run"
          : "The library has not been indexed yet."}
      </p>
      {status?.lastFullScan && <p>Last library check: {new Date(status.lastFullScan * 1000).toLocaleString()}</p>}
    </React.Fragment>
  );
}
