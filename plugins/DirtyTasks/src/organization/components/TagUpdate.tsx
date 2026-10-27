import { DirtyPlugins, PLUGIN_ID, React, ui } from "../runtime";
import { StrategyRow } from "./StrategyRow";
import type { ReactNode } from "react";
import type { Workflow } from "../workflow";

interface TaggerSource {
  endpoint: string;
  name: string;
}

export function TagUpdate({ workflow, trigger }: { workflow: Workflow; trigger?: ReactNode }) {
  const { draft, openRow } = workflow.state;
  const [sources, setSources] = React.useState<TaggerSource[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [attempt, retry] = React.useState(0);
  const [refreshing, setRefreshing] = React.useState(false);
  const [refreshError, setRefreshError] = React.useState("");
  const mounted = React.useRef(true);
  const open = openRow === "tags";
  React.useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    DirtyPlugins.graphql<{ configuration: { general: { stashBoxes: TaggerSource[] } } }>(
      "query DirtyTidyTaggers { configuration { general { stashBoxes { endpoint name } } } }",
    )
      .then(data => {
        if (active) setSources(data.configuration.general.stashBoxes);
      })
      .catch(() => {
        if (active) setError("Could not load tagger sources.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  const selected = sources.find(source => source.endpoint === draft.taggerEndpoint);
  async function refreshTags() {
    if (refreshing || workflow.dirty() || !draft.tagUpdateEnabled || !selected) return;
    setRefreshing(true);
    setRefreshError("");
    try {
      const result = await DirtyPlugins.graphql<{ runPluginTask: string }>(
        "mutation DirtyTidyRefreshTags($pluginId:ID!,$description:String,$args:Map){runPluginTask(plugin_id:$pluginId,description:$description,args_map:$args)}",
        {
          pluginId: PLUGIN_ID,
          description: "DirtyTasks: organization: refresh all scene tags (ignore one-day cache)",
          args: { task: "organization", mode: "updateTags", force: true },
        },
      );
      if (!result.runPluginTask) throw new Error("Stash did not return a task ID.");
      if (mounted.current)
        DirtyPlugins.ui.notify("DirtyTasks tag refresh queued as Stash job " + result.runPluginTask + ".");
    } catch {
      if (mounted.current) setRefreshError("Could not queue the tag refresh. Try again.");
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }
  return (
    <StrategyRow
      trigger={trigger}
      title="Update scene tags"
      detail={selected ? "stash-box: " + selected.name : "Choose a tagger source"}
      enabled={draft.tagUpdateEnabled}
      onEnabled={value => {
        workflow.changed({ tagUpdateEnabled: value }, false);
        if (value) workflow.view({ openRow: "tags" });
      }}
      open={open}
      onToggle={() => workflow.view({ openRow: open ? "" : "tags" })}
    >
      <ui.Field
        label="Tagger source"
        help="Add tags from this source to matched scenes when this action is triggered. Existing tags are always kept."
        error={error || (draft.tagUpdateEnabled && !draft.taggerEndpoint ? "Choose a tagger source." : "")}
      >
        <select
          aria-label="Tagger source"
          className="form-control dirty-ui-select"
          disabled={loading}
          value={draft.taggerEndpoint}
          onChange={event => workflow.changed({ taggerEndpoint: event.target.value }, false)}
        >
          <option value="">{loading ? "Loading sources…" : "Choose a source"}</option>
          {draft.taggerEndpoint && !selected && (
            <option value={draft.taggerEndpoint}>Saved source (unavailable)</option>
          )}
          {sources.map(source => (
            <option key={source.endpoint} value={source.endpoint}>
              {"stash-box: " + (source.name || source.endpoint)}
            </option>
          ))}
        </select>
      </ui.Field>
      {error && <ui.Button onClick={() => retry(value => value + 1)}>Retry sources</ui.Button>}
      {!loading && !error && sources.length === 0 && (
        <p className="dirty-tidy-help">Add a stash-box source in Stash Settings → Metadata Providers.</p>
      )}
      <p className="dirty-tidy-help">
        Save to enable this task. Choose Manual, Scan, or Generate for this action. Keep the Stash UI open until the
        selected job finishes. Tags are fetched in batches. Successful checks are cached for one day. Missing local tags
        are created; unmatched or ambiguous scenes are skipped.
      </p>
      <ui.Button
        busy={refreshing}
        disabled={
          refreshing || Boolean(workflow.state.busy) || workflow.dirty() || !draft.tagUpdateEnabled || !selected
        }
        onClick={refreshTags}
      >
        Refresh tags now
      </ui.Button>
      <p className="dirty-tidy-help">Refresh ignores the one-day cache and checks all scenes using the saved source.</p>
      {refreshError && (
        <p className="dirty-ui-text-error" role="alert">
          {refreshError}
        </p>
      )}
    </StrategyRow>
  );
}
