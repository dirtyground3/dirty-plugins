import { ContextualMultiscreenNavLink } from "./components/Navigation";
import { MultiscreenRoute } from "./components/Route";
import { contexts, DirtyPlugins, PLUGIN_ID, PluginApi, React } from "./runtime";

function captureList(component: string, path: string, key: string) {
  PluginApi.patch.before(component, props => {
    if (window.location.pathname === path && props.filter && props.selectedIds instanceof Set)
      contexts.captureList(key, { filter: props.filter, selectedIds: props.selectedIds });
    return [props];
  });
}
function captureDetail(component: string, prefix: string, entity: "performer" | "studio") {
  PluginApi.patch.before(component, props => {
    if (window.location.pathname.startsWith(prefix) && props[entity]?.id)
      contexts.captureDetail(entity + "-detail", props[entity].id);
    return [props];
  });
}

DirtyPlugins?.registerPlugin(PLUGIN_ID, () => {
  PluginApi.register.route("/plugins/multiscreen", MultiscreenRoute);
  captureList("SceneMarkerList", "/scenes/markers", "marker-list");
  captureList("SceneList", "/scenes", "scene-list");
  captureList("PerformerList", "/performers", "performer-list");
  captureDetail("PerformerPage", "/performers/", "performer");
  captureList("StudioList", "/studios", "studio-list");
  captureDetail("StudioPage", "/studios/", "studio");
  PluginApi.patch.before("MainNavBar.UtilityItems", props => [
    {
      children: (
        <React.Fragment>
          {props.children}
          <ContextualMultiscreenNavLink />
        </React.Fragment>
      ),
    },
  ]);
});
