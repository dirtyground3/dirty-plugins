import { React, transport } from "../runtime";
import type { FieldValue, PluginCardProps } from "../types";
import { DatabaseBackupControl } from "./DatabaseBackup";
import { SettingInput } from "./SettingInput";
import { SettingsCard } from "./Settings";
export function PluginCard(props: PluginCardProps) {
  var plugin = props.plugin;
  var draft = props.draft || {};
  var status = props.status;
  var actionRevision = props.actionRevision;
  var onFieldChange = props.onFieldChange;
  var footer = (plugin.settings || []).length > 0 && (<div
    className="card-footer dirty-plugins-card-footer">
    <div
      className={"dirty-plugins-save-status" + (status && status.error ? " dirty-ui-text-error" : "")}
      role={status ? "status" : undefined}>
      {status && status.message}
    </div>
  </div>);

  return (<SettingsCard
    plugin={plugin}
    footer={footer}>
    {(plugin.settings || []).length === 0
      ? (<p
        className="dirty-plugins-empty">
        {"This plugin has no settings."}
      </p>)
      : (plugin.settings || []).map(function(setting) {
        return (<SettingInput
          key={setting.name}
          actionRevision={actionRevision}
          pluginId={plugin.id}
          setting={setting}
          value={draft[setting.name]}
          onChange={function(value: FieldValue) {
            onFieldChange(plugin.id, setting.name, value);
          }}>

        </SettingInput>);
      })}
    {plugin.id === "dirtyPlugins" && (<DatabaseBackupControl>

    </DatabaseBackupControl>)}
    {transport.settingsAddons[plugin.id] && (React.createElement(transport.settingsAddons[plugin.id], { "plugin": plugin, "configuration": draft }))}
  </SettingsCard>);
}
