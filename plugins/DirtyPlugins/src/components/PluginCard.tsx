import { React } from "../runtime";
import { settingsAddons } from "../settings";
import type { PluginCardProps } from "../types";
import { DatabaseBackupControl } from "./DatabaseBackup";
import { SettingInput } from "./SettingInput";
import { SettingsCard } from "./Settings";
export function PluginCard({ plugin, draft = {}, status, actionRevision, onFieldChange }: PluginCardProps) {
  const settings = plugin.settings || [],
    Addon = settingsAddons[plugin.id];
  const footer = settings.length > 0 && (
    <div className="card-footer dirty-plugins-card-footer">
      <div
        className={"dirty-plugins-save-status" + (status && status.error ? " dirty-ui-text-error" : "")}
        role={status ? "status" : undefined}
      >
        {status && status.message}
      </div>
    </div>
  );
  return (
    <SettingsCard plugin={plugin} footer={footer}>
      {settings.length === 0 ? (
        <p className="dirty-plugins-empty">This plugin has no settings.</p>
      ) : (
        settings.map(setting => (
          <SettingInput
            key={setting.name}
            actionRevision={actionRevision}
            pluginId={plugin.id}
            setting={setting}
            value={draft[setting.name]}
            onChange={value => onFieldChange(plugin.id, setting.name, value)}
          />
        ))
      )}
      {plugin.id === "dirtyPlugins" && <DatabaseBackupControl />}
      {Addon && <Addon plugin={plugin} configuration={draft} />}
    </SettingsCard>
  );
}
