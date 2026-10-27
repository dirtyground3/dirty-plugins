import * as hubSettings from "@generated/dirtyPlugins.settings";
import { CONFIGURATION_CHANGED_EVENT, MANAGED_PLUGIN_IDS, ROUTE_PATH } from "../constants";
import { PluginApi, React } from "../runtime";
import { settingsRoute } from "../settings";
import { coerceBoolean } from "../shared/values";
import { getPluginSettings } from "../transport";
import { NavAction } from "./Navigation";

/** Header button to the hub settings; appended after every plugin's button and hidden by `showSettingsInMenu`. */
export function SettingsNavLink() {
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    function refresh() {
      getPluginSettings("dirtyPlugins")
        .then(stored => {
          if (active) setVisible(coerceBoolean(stored.showSettingsInMenu, hubSettings.defaults.showSettingsInMenu));
        })
        .catch(error => console.error("DirtyPlugins could not refresh navigation settings", error));
    }
    function configurationChanged(event: Event) {
      const pluginId = (event as CustomEvent<{ pluginId?: string }>).detail?.pluginId;
      if (!pluginId || pluginId === "dirtyPlugins") refresh();
    }
    refresh();
    window.addEventListener(CONFIGURATION_CHANGED_EVENT, configurationChanged);
    return () => {
      active = false;
      window.removeEventListener(CONFIGURATION_CHANGED_EVENT, configurationChanged);
    };
  }, []);
  if (!visible) return null;
  return (
    <NavAction
      as={PluginApi.libraries.ReactRouterDOM.NavLink}
      className="dirty-plugins-nav"
      exact={true}
      to={ROUTE_PATH}
      label="Dirty Plugins settings"
      icon={
        <svg viewBox="2 2 20 20" aria-hidden={true}>
          <rect x={2} y={2} width={20} height={20} rx={0.3} fill="var(--dirty-ui-icon-white)" />
          <rect x={3} y={3} width={18} height={18} fill="var(--dirty-ui-icon-black)" />
          <rect x={5} y={6.6} width={14} height={0.9} fill="var(--dirty-ui-icon-white)" />
          <rect x={5} y={11.55} width={14} height={0.9} fill="var(--dirty-ui-icon-white)" />
          <rect x={5} y={16.5} width={14} height={0.9} fill="var(--dirty-ui-icon-white)" />
          <rect x={7} y={5.25} width={3.6} height={3.6} fill="var(--dirty-ui-icon-red)" />
          <rect x={13.2} y={10.2} width={3.6} height={3.6} fill="var(--dirty-ui-icon-blue)" />
          <rect x={9.4} y={15.15} width={3.6} height={3.6} fill="var(--dirty-ui-icon-white)" />
        </svg>
      }
    />
  );
}

export function SettingsLink(props: { pluginId: string }) {
  React.useEffect(() => {
    const frame = window.requestAnimationFrame(orderMainPluginSettingsGroups);
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return (
    <PluginApi.libraries.ReactRouterDOM.Link
      className="btn btn-primary dirty-ui-button dirty-plugins-settings-link"
      data-dirty-plugin-id={props.pluginId}
      to={settingsRoute(props.pluginId)}
    >
      Open Dirty Plugins settings
    </PluginApi.libraries.ReactRouterDOM.Link>
  );
}

export function orderMainPluginSettingsGroups() {
  let groups = MANAGED_PLUGIN_IDS.map(pluginId =>
    document.querySelector('[data-dirty-plugin-id="' + pluginId + '"]')?.closest(".setting-group"),
  ).filter((group): group is Element => Boolean(group));
  if (groups.length < 2) return;
  const parent = groups[0].parentElement;
  if (!parent) return;
  groups = groups.filter(group => group.parentElement === parent);
  if (groups.length < 2) return;
  const groupSet = new Set(groups);
  const firstGroup = Array.prototype.find.call(parent.children, (child: Element) => groupSet.has(child));
  if (!firstGroup) return;
  const marker = document.createComment("dirty-plugins-order");
  parent.insertBefore(marker, firstGroup);
  groups.forEach(group => parent.insertBefore(group, marker));
  parent.removeChild(marker);
}
