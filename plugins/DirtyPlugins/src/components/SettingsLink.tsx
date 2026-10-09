import { MAIN_PAGE_PLUGIN_IDS } from "../constants";
import { PluginApi, React } from "../runtime";
import { settingsRoute } from "../settings";
export function SettingsLink(props: { pluginId: string; }) {
  React.useEffect(function() {
    var frame = window.requestAnimationFrame(orderMainPluginSettingsGroups);
    return function() { window.cancelAnimationFrame(frame); };
  }, []);
  return (<PluginApi.libraries.ReactRouterDOM.Link
    className="btn btn-primary dirty-ui-button dirty-plugins-settings-link"
    data-dirty-plugin-id={props.pluginId}
    to={settingsRoute(props.pluginId)}>
    {"Open Dirty Plugins settings"}
  </PluginApi.libraries.ReactRouterDOM.Link>);
}

export function orderMainPluginSettingsGroups() {
  var groups = MAIN_PAGE_PLUGIN_IDS.map(function(pluginId) {
    var link = document.querySelector(
      '[data-dirty-plugin-id="' + pluginId + '"]'
    );
    return link && link.closest(".setting-group");
  }).filter((group): group is Element => Boolean(group));
  if (groups.length < 2) return;

  var parent = groups[0].parentElement;
  if (!parent) return;
  groups = groups.filter(function(group) { return group.parentElement === parent; });
  if (groups.length < 2) return;

  var groupSet = new Set(groups);
  var firstGroup = Array.prototype.find.call(parent.children, function(child) {
    return groupSet.has(child);
  });
  if (!firstGroup) return;

  var marker = document.createComment("dirty-plugins-order");
  parent.insertBefore(marker, firstGroup);
  groups.forEach(function(group) { parent!.insertBefore(group, marker); });
  parent.removeChild(marker);
}
