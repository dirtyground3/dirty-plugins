import { React } from "../runtime";
import { defaultFieldValue, fieldValuesEqual, settingsAddons } from "../settings";
import type { PluginCardProps } from "../types";
import { DatabaseBackupControl } from "./DatabaseBackup";
import { SettingInput } from "./SettingInput";
import { SettingsCard, SettingsSection } from "./Settings";
export function PluginCard({ plugin, draft = {}, status, actionRevision, onFieldChange, onReset }: PluginCardProps) {
  const settings = plugin.settings || [],
    Addon = settingsAddons[plugin.id];
  const atDefaults = settings.every(
    setting => !setting.metadata || fieldValuesEqual(setting, draft[setting.name], defaultFieldValue(setting)),
  );
  const footer = !plugin.settingsUnavailable && settings.length > 0 && (
    <div className="card-footer dirty-plugins-card-footer">
      <div
        className={"dirty-plugins-save-status" + (status && status.error ? " dirty-ui-text-error" : "")}
        role={status ? "status" : undefined}
      >
        {status && status.message}
      </div>
      <button
        type="button"
        className="btn btn-secondary dirty-ui-button"
        disabled={atDefaults}
        title={atDefaults ? "Every setting already has its default value." : undefined}
        onClick={() => onReset(plugin)}
      >
        Reset to defaults
      </button>
    </div>
  );
  const input = (setting: (typeof settings)[number]) => {
    const rule = setting.metadata?.disabledWhen;
    return (
      <SettingInput
        key={setting.name}
        actionRevision={actionRevision}
        disabled={!!rule && draft[rule.setting] === rule.value}
        pluginId={plugin.id}
        setting={setting}
        value={draft[setting.name]}
        onChange={value => onFieldChange(plugin.id, setting.name, value)}
      />
    );
  };
  // The hub can suppress a field it cannot offer on the current Stash page.
  const sections = (plugin.settingsSections || [])
    .map(section => ({
      ...section,
      settings: section.settings
        .map(name => settings.find(setting => setting.name === name))
        .filter(setting => setting !== undefined),
    }))
    .filter(section => section.settings.length > 0);
  const grouped = new Set(sections.flatMap(section => section.settings));
  const ungrouped = settings.filter(setting => !grouped.has(setting));
  return (
    <SettingsCard plugin={plugin} footer={footer}>
      {plugin.settingsUnavailable ? (
        <p className="dirty-plugins-empty">
          Install the current {plugin.name} package and reload plugins to edit these settings.
        </p>
      ) : settings.length === 0 ? (
        <p className="dirty-plugins-empty">This plugin has no settings.</p>
      ) : sections.length ? (
        <div className="dirty-plugins-sections">
          {sections.map(section => (
            <SettingsSection key={section.title} title={section.title} description={section.description}>
              {section.settings.map(input)}
            </SettingsSection>
          ))}
          {ungrouped.length > 0 && <SettingsSection title="Other">{ungrouped.map(input)}</SettingsSection>}
        </div>
      ) : (
        settings.map(input)
      )}
      {plugin.id === "dirtyPlugins" && <DatabaseBackupControl />}
      {Addon && <Addon plugin={plugin} configuration={draft} />}
    </SettingsCard>
  );
}
