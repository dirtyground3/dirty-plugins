import { React, ui } from "../runtime";
import { StrategyRow } from "./StrategyRow";
import { VariableMenu } from "./VariableMenu";
import type { Workflow } from "../workflow";
export function FolderStrategy({ workflow }: { workflow: Workflow }) {
  const { draft, openRow } = workflow.state;
  const levelsText = draft.hierarchyLevels.length ? draft.hierarchyLevels.join(" / ") + " /" : "No folder levels";
  return (
    <StrategyRow
      title="Move into folders"
      detail={levelsText + (draft.moveRequireStashId ? " · only scenes with a Stash ID" : "")}
      enabled={draft.moveEnabled}
      onEnabled={value => workflow.changed({ moveEnabled: value })}
      open={openRow === "move"}
      onToggle={() => workflow.view({ openRow: openRow === "move" ? "" : "move" })}
    >
      <div className="dirty-tidy-levels">
        {draft.hierarchyLevels.map((level, index) => (
          <div className="dirty-tidy-level" key={index}>
            <span className="dirty-tidy-level-number">{String(index + 1)}</span>
            <input
              aria-label={"Folder level " + (index + 1)}
              className="form-control"
              onChange={event => workflow.updateLevel(index, event.target.value)}
              type="text"
              value={level}
            />
            <VariableMenu
              ariaLabel={"Insert variable into folder level " + (index + 1)}
              onInsert={token => workflow.updateLevel(index, level + token)}
            />
            <ui.ActionMenu
              ariaLabel={"Actions for folder level " + (index + 1)}
              items={[
                { label: "Move up", disabled: index === 0, onSelect: () => workflow.moveLevel(index, -1) },
                {
                  label: "Move down",
                  disabled: index === draft.hierarchyLevels.length - 1,
                  onSelect: () => workflow.moveLevel(index, 1),
                },
                { label: "Remove level", tone: "danger", onSelect: () => workflow.removeLevel(index) },
              ]}
            />
          </div>
        ))}
        <div>
          <ui.Button compact tone="quiet" onClick={() => workflow.addLevel()}>
            + Add folder level
          </ui.Button>
        </div>
      </div>
      <p className="dirty-tidy-help">
        Folders are created inside each file's current library folder. Missing values become “Unknown”.
      </p>
      <ui.SettingsToggle
        checked={draft.moveRequireStashId}
        label="Only scenes with a Stash ID"
        onChange={value => workflow.changed({ moveRequireStashId: value })}
      />
    </StrategyRow>
  );
}
