import { captureEnabled } from "../capture";
import { React } from "../runtime";
import { fieldDefinition, getFieldAction } from "../settings";
import type { SettingInputProps } from "../types";
import { SettingsField } from "./SettingsField";
export function SettingInput({ disabled, pluginId, setting, value, onChange, actionRevision }: SettingInputProps) {
  const maskedValue = captureEnabled(window.location && window.location.search)
    ? setting.metadata?.capturePlaceholder
    : undefined;
  const action = React.useMemo(() => getFieldAction(pluginId, setting.name), [actionRevision, pluginId, setting.name]);
  const actionButton = action && (
    <button type="button" className="btn btn-secondary dirty-ui-button" onClick={event => action.onClick(event)}>
      {action.label}
    </button>
  );
  return (
    <SettingsField
      definition={fieldDefinition(pluginId, setting)}
      className="dirty-plugins-setting"
      value={maskedValue ?? value}
      disabled={maskedValue !== undefined || disabled}
      onChange={onChange}
      action={actionButton}
    />
  );
}
