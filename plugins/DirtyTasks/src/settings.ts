import { hub } from "../../DirtyPlugins/src/shared/host";

type Section = "organization" | "encoding" | "execution";
const revisions: Partial<Record<Section, number>> = {};

export async function loadSettings(section: Section): Promise<Record<string, unknown>> {
  const result = await hub.runPluginOperation<{ settings: Record<string, unknown>; revision: number }>("dirtyTasks", {
    mode: "getTaskSettings",
    section,
  });
  revisions[section] = result.revision;
  return result.settings;
}

export async function saveSettings(section: Section, settings: Record<string, unknown>) {
  if (revisions[section] === undefined) await loadSettings(section);
  const result = await hub.runPluginOperation<{ settings: Record<string, unknown>; revision: number }>("dirtyTasks", {
    mode: "saveTaskSettings",
    section,
    settings,
    expectedRevision: revisions[section],
  });
  revisions[section] = result.revision;
  hub.notifyConfigurationChanged("dirtyTasks", { preserveSettingsPage: true });
  return result;
}
