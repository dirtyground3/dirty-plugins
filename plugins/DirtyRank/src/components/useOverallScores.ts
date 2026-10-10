import {
  getOverallSortRevision,
  overallScoresReady,
  prepareOverallScores,
  subscribeToOverallSortSettings,
} from "../domain/rank";
import { React } from "../runtime";
import type { RankSettings } from "../types";

/** Render only complete comparisons; warmed votes remain immediately ready. */
export function useOverallScores(settings: RankSettings | null, cohorts: string[], enabled = true) {
  const [revision, setRevision] = React.useState(getOverallSortRevision);
  const [attempt, setAttempt] = React.useState(0);
  const [failure, setFailure] = React.useState<{ settings: RankSettings | null; key: string; message: string } | null>(
    null,
  );
  const cohortKey = JSON.stringify(cohorts);
  const key = revision + ":" + cohortKey;
  const ready = !enabled || !settings || overallScoresReady(settings, cohorts);
  React.useEffect(() => {
    const unsubscribe = subscribeToOverallSortSettings(setRevision);
    setRevision(getOverallSortRevision());
    return unsubscribe;
  }, []);
  React.useEffect(() => {
    if (ready || !settings) return;
    const controller = new AbortController();
    setFailure(null);
    void prepareOverallScores(settings, cohorts, controller.signal)
      .then(() => {
        if (!controller.signal.aborted) setAttempt(value => value + 1);
      })
      .catch(error => {
        if (!controller.signal.aborted) setFailure({ settings, key, message: error.message || String(error) });
      });
    return () => controller.abort();
  }, [settings, cohortKey, revision, attempt, enabled, ready]);
  return {
    ready,
    revision,
    error: failure?.settings === settings && failure?.key === key ? failure.message : "",
    retry: () => setAttempt(value => value + 1),
  };
}
