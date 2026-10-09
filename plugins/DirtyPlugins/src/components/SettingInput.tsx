import { React, hubApi } from "../runtime";
import { fieldDefinition, getFieldAction } from "../settings";
import type { SettingInputProps } from "../types";
import { SettingsField } from "./SettingsField";
export function SettingInput(props: SettingInputProps) {
  var pluginId = props.pluginId;
  var setting = props.setting;
  var value = props.value;
  var onChange = props.onChange;
  var actionRevision = props.actionRevision;
  var maskedPath = pluginId === "extractScenes" && setting.name === "destinationFolder" && hubApi.captureEnabled(window.location && window.location.search);
  var action = React.useMemo(function() {
    return getFieldAction(pluginId, setting.name);
  }, [actionRevision, pluginId, setting.name]);

  var actionButton = action && (<button
    type="button"
    className="btn btn-secondary dirty-ui-button"
    onClick={function(event) { action.onClick(event); }}>
    {action.label}
  </button>);
  return (<SettingsField
    definition={fieldDefinition(pluginId, setting)}
    className="dirty-plugins-setting"
    value={maskedPath ? "Path hidden for documentation" : value}
    disabled={maskedPath}
    onChange={onChange}
    action={actionButton} />);
}
