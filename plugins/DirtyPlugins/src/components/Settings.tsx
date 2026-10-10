import { React } from "../runtime";
import type { SharedProps, ToggleProps } from "../types";
import { withClass } from "../shared/values";
export function SettingsCard(props: SharedProps) {
  const plugin = props.plugin || {};
  return (
    <section className={withClass("card dirty-ui-panel dirty-plugins-card", props.className)}>
      <div className="card-header dirty-plugins-card-header">
        <div>
          <h2>{plugin.name}</h2>
          {plugin.description && <p>{plugin.description}</p>}
        </div>
        <div className="dirty-plugins-plugin-meta">
          {plugin.version && <span>{"v" + plugin.version}</span>}
          {plugin.enabled === false && <span className="badge badge-secondary">Disabled</span>}
        </div>
      </div>
      <div className={withClass("card-body", props.bodyClassName)}>{props.children}</div>
      {props.footer}
    </section>
  );
}

export function SettingsSection(props: SharedProps) {
  return (
    <section className={withClass("dirty-ui-settings-section", props.className)}>
      <div className="dirty-ui-settings-section-heading">
        <h3>{props.title}</h3>
        {props.description && <p>{props.description}</p>}
      </div>
      {props.children}
    </section>
  );
}

export function SettingsToggle(props: ToggleProps) {
  return (
    <label className={withClass("dirty-ui-settings-toggle", props.className)}>
      <input
        checked={Boolean(props.checked)}
        disabled={Boolean(props.disabled)}
        onChange={event => props.onChange(event.target.checked)}
        type="checkbox"
      />
      <span>{props.label}</span>
    </label>
  );
}
