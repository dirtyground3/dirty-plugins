import { FIELD_DISABLED_WHEN, PLUGIN_SECTIONS } from "../constants";
import { React } from "../runtime";
import { settingsAddons } from "../settings";
import type { PluginCardProps } from "../types";
import { DatabaseBackupControl } from "./DatabaseBackup";
import { SettingInput } from "./SettingInput";
import { SettingsCard, SettingsSection } from "./Settings";
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
  const rules = FIELD_DISABLED_WHEN[plugin.id] || {};
  const input = (setting: (typeof settings)[number]) => {
    const rule = rules[setting.name];
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
  // Settings Stash does not report (an older manifest) drop out of their section.
  const sections = (PLUGIN_SECTIONS[plugin.id] || [])
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
      {settings.length === 0 ? (
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
