import type { Kind, Selection } from "../types";
export function selectionFor(kind: Kind, selectedIds: Iterable<unknown>): Selection {
  return { kind, ids: Array.from(selectedIds).map(id => String(id)), singular: kind,
    plural: kind === "image" ? "images" : kind + "s" };
}
export function selectionLabel(selection: Selection, busy: boolean): string {
  const count = selection.ids.length;
  return busy ? "Queuing extraction…" : count === 1 ? "Extract selected " + selection.singular
    : "Extract " + count + " selected " + selection.plural;
}
export function taskRequest(selection: Selection) {
  return { query: "mutation ExtractScenesRun($pluginId:ID!,$description:String!,$args:Map){runPluginTask(plugin_id:$pluginId,description:$description,args_map:$args)}",
    variables: { pluginId: "extractScenes", description: "Copy files for " + selection.ids.length + " selected " +
      (selection.ids.length === 1 ? selection.singular : selection.plural), args: { [selection.kind + "_ids"]: selection.ids } } };
}
export function pickerPathLabel(path: string | null): string {
  const parts = String(path || "").split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(path || "Computer");
}
