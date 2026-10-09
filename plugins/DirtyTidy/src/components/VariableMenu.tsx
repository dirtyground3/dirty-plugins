import { React, ui } from "../runtime";
import { VARIABLES } from "../domain/settings";
import { groupVariables } from "../domain/preview";
export function VariableMenu({ ariaLabel, onInsert }: { ariaLabel: string; onInsert(token: string): void }) {
  const items = groupVariables(VARIABLES).flatMap(group => [{ header: group.header }, ...group.variables.map(variable => ({
    key: variable[0], label: <React.Fragment>{variable[1]} <span className="dirty-tidy-token">{"{" + variable[0] + "}"}</span></React.Fragment>,
    onSelect: () => onInsert("{" + variable[0] + "}"),
  }))]);
  return <ui.ActionMenu className="dirty-tidy-variable-menu" label="+ Variable" ariaLabel={ariaLabel} items={items} />;
}
