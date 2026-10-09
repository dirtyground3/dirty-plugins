import { React } from "../runtime";
import type { SharedProps, ToggleProps } from "../types";
export function SettingsCard(props: SharedProps) {
  var plugin = props.plugin || {};
  var className = "card dirty-ui-panel dirty-plugins-card" +
    (props.className ? " " + props.className : "");
  var bodyClassName = "card-body" +
    (props.bodyClassName ? " " + props.bodyClassName : "");
  return (<section
    className={className}>
    <div
      className="card-header dirty-plugins-card-header">
      <div>
        <h2>
          {plugin.name}
        </h2>
        {plugin.description && (<p>
          {plugin.description}
        </p>)}
      </div>
      <div
        className="dirty-plugins-plugin-meta">
        {plugin.version && (<span>
          {"v" + plugin.version}
        </span>)}
        {plugin.enabled === false && (<span
          className="badge badge-secondary">
          {"Disabled"}
        </span>)}
      </div>
    </div>
    <div
      className={bodyClassName}>
      {props.children}
    </div>
    {props.footer}
  </section>);
}

export function SettingsSection(props: SharedProps) {
  var className = "dirty-ui-settings-section" +
    (props.className ? " " + props.className : "");
  return (<section
    className={className}>
    <div
      className="dirty-ui-settings-section-heading">
      <h3>
        {props.title}
      </h3>
      {props.description && (<p>
        {props.description}
      </p>)}
    </div>
    {props.children}
  </section>);
}

export function SettingsToggle(props: ToggleProps) {
  return (<label
    className={"dirty-ui-settings-toggle" + (props.className ? " " + props.className : "")}>
    <input
      checked={Boolean(props.checked)}
      disabled={Boolean(props.disabled)}
      onChange={function(event) { props.onChange(event.target.checked); }}
      type="checkbox">

    </input>
    <span>
      {props.label}
    </span>
  </label>);
}
