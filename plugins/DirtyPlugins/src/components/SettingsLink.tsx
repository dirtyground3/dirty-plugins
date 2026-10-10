import { MANAGED_PLUGIN_IDS } from "../constants";
import { PluginApi, React } from "../runtime";
import { settingsRoute } from "../settings";
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
