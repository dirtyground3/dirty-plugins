import { React, DirtyPlugins, PLUGIN_ID } from "./runtime";
import { createWorkflow, type Workflow } from "./workflow";
import type { Lifetime, Preview, SettingsProps } from "./types";

export function useWorkflow(props: SettingsProps, lifetime: Lifetime): Workflow {
  const ref = React.useRef<Workflow | null>(null), mounted = React.useRef(true);
  const latest = React.useRef(props); latest.current = props;
  const [, render] = React.useState(0);
  if (!ref.current) ref.current = createWorkflow(props.configuration, {
    getSettings: () => DirtyPlugins.getPluginSettings(PLUGIN_ID),
    runPreview: settings => DirtyPlugins.runPluginOperation<Preview>(PLUGIN_ID, { includeAll: true, mode: "preview", settings }),
    configurePlugin: settings => DirtyPlugins.configurePlugin(PLUGIN_ID, settings),
    queueExecution: async strategyHash => {
      const data = await DirtyPlugins.graphql<{ runPluginTask: string }>(
        "mutation DirtyTidyExecute($pluginId:ID!,$description:String,$args:Map){runPluginTask(plugin_id:$pluginId,description:$description,args_map:$args)}",
        { pluginId: PLUGIN_ID, description: "DirtyTidy: apply confirmed file organization plan", args: { mode: "execute", expectedStrategyHash: strategyHash } });
      return data.runPluginTask;
    },
    notify: message => DirtyPlugins.ui.notify(message),
  });
  const workflow = ref.current;
  React.useEffect(() => {
    const unsubscribe = workflow.subscribe(() => { if (mounted.current) render(value => value + 1); });
    let released = false;
    const release = () => {
      if (released) return; released = true;
      workflow.destroy(); unsubscribe(); lifetime.effects.delete(release); latest.current.onDirtyChange?.(PLUGIN_ID, false);
    };
    lifetime.effects.add(release); void workflow.load();
    return () => { mounted.current = false; release(); };
  }, []);
  const dirty = workflow.dirty();
  React.useEffect(() => { props.onDirtyChange?.(PLUGIN_ID, dirty); }, [props.onDirtyChange, dirty]);
  return workflow;
}
