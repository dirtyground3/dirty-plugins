import type { ReactNode } from "react";
import { CaptionsController } from "./components/CaptionsController";
import { IndexMonitor } from "./components/IndexMonitor";
import { IndexSettings } from "./components/IndexSettings";
import { decorateList } from "./filterView";
import { hub, PLUGIN_ID, PluginApi, React } from "./runtime";
import type { NativeProps } from "./types";

hub?.registerPlugin(PLUGIN_ID, () => {
  hub.registerSettingsAddon(PLUGIN_ID, IndexSettings);
  PluginApi.patch.after("App", (...args) => {
    const result = args.pop() as ReactNode;
    return (
      <React.Fragment>
        {result}
        <IndexMonitor />
      </React.Fragment>
    );
  });
  PluginApi.patch.after("FilteredSceneList", (...args) => {
    const result = args.pop() as ReactNode;
    return decorateList(result, PluginApi.libraries.Intl.useIntl());
  });
  PluginApi.patch.after("ScenePlayer", (...args) => {
    const result = args.pop() as ReactNode,
      props = args[0] as NativeProps | undefined;
    if (!props?.scene?.files?.length || !React.isValidElement<NativeProps>(result)) return result;
    const capture = hub.captureEnabled(window.location.search);
    const className =
      (result.props.className || "") + " dirty-captions-player" + (capture ? " dirty-captions-capture" : "");
    return React.cloneElement(
      result,
      { className },
      result.props.children,
      <CaptionsController key="dirty-captions-controller" scene={props.scene} capture={capture} />,
    );
  });
});
