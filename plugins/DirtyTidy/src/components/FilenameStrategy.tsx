import { React, ui } from "../runtime";
import { StrategyRow } from "./StrategyRow";
import { VariableMenu } from "./VariableMenu";
import type { Workflow } from "../workflow";
export function FilenameStrategy({ workflow }: { workflow: Workflow }) {
  const { draft, openRow } = workflow.state;
  return <StrategyRow title="Rename files" detail={(draft.renamePattern || "No pattern") + ".ext" + (draft.renameRequireStashId ? " · only scenes with a Stash ID" : "")}
    enabled={draft.renameEnabled} onEnabled={value => workflow.changed({ renameEnabled: value })} open={openRow === "rename"}
    onToggle={() => workflow.view({ openRow: openRow === "rename" ? "" : "rename" })}>
    <ui.Field id="dirty-tidy-rename-pattern" label="Filename pattern" className="dirty-tidy-field"
      help="The extension is kept. Missing variables are skipped and invalid characters removed."
      action={<VariableMenu ariaLabel="Insert variable into filename pattern" onInsert={token => workflow.changed({ renamePattern: draft.renamePattern + token })} />}>
      <input className="form-control" onChange={event => workflow.changed({ renamePattern: event.target.value })} type="text" value={draft.renamePattern} />
    </ui.Field>
    <ui.SettingsToggle checked={draft.renameRequireStashId} label="Only scenes with a Stash ID" onChange={value => workflow.changed({ renameRequireStashId: value })} />
    <details className="dirty-tidy-advanced"><summary>{"Advanced · max " + draft.maxFilenameLength + " characters · separator “" + draft.multiValueSeparator + "”"}</summary>
      <div className="dirty-tidy-field-row">
        <ui.Field id="dirty-tidy-max-length" label="Maximum filename length" className="dirty-tidy-field">
          <input className="form-control" max={255} min={16} onChange={event => workflow.changed({ maxFilenameLength: Number(event.target.value) })} type="number" value={draft.maxFilenameLength} />
        </ui.Field>
        <ui.Field id="dirty-tidy-separator" label="Separator for multiple values" className="dirty-tidy-field" help="Used between performers or tags.">
          <input className="form-control" maxLength={10} onChange={event => workflow.changed({ multiValueSeparator: event.target.value })} type="text" value={draft.multiValueSeparator} />
        </ui.Field>
      </div>
    </details>
  </StrategyRow>;
}
