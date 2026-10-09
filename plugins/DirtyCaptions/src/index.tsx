import { readRuntime, PLUGIN_ID } from "./runtime";
import { createTracksService } from "./tracks";
import { createIndexUi } from "./indexUi";
import { createCaptionsController } from "./components/CaptionsController";
import type { ReactNode } from "react";
import type { Lifetime, NativeProps } from "./types";
const INSTANCE_KEY = "__dirtyCaptionsPlugin", globals = window as unknown as Record<string, unknown>;
if (!globals[INSTANCE_KEY]) {
  const runtime = readRuntime();
  if (runtime) {
    const { api, hub } = runtime, React = api.React, lifetime: Lifetime = { active: true, effects: new Set() };
    let patchAttempted = false, indexUi: ReturnType<typeof createIndexUi> | undefined;
    const instance = { status: "registering", destroy };
    globals[INSTANCE_KEY] = instance; globals.__dirtyCurrentPluginId = PLUGIN_ID;
    function destroy() {
      if (!lifetime.active) return;
      lifetime.active = false; instance.status = "destroyed";
      Array.from(lifetime.effects).forEach(release => release()); lifetime.effects.clear();
      if (indexUi) hub.unregisterSettingsAddon?.(PLUGIN_ID, indexUi.SettingsAddon);
    }
    try {
      const dependencies = { ...runtime, lifetime }, tracks = createTracksService(hub);
      indexUi = createIndexUi(dependencies);
      const CaptionsController = createCaptionsController(dependencies, tracks);
      hub.registerSettingsAddon(PLUGIN_ID, indexUi.SettingsAddon);
      const ui = indexUi;
      patchAttempted = true;
      api.patch.after("App", (...args) => {
        const result = args.pop() as ReactNode;
        return lifetime.active ? <React.Fragment>{result}<ui.Monitor /></React.Fragment> : result;
      });
      api.patch.after("FilteredSceneList", (...args) => {
        const result = args.pop() as ReactNode;
        if (!lifetime.active) return result;
        const intl = api.libraries?.Intl?.useIntl?.(); return ui.decorateList(result, intl);
      });
      api.patch.after("ScenePlayer", (...args) => {
        const result = args.pop() as ReactNode, props = args[0] as NativeProps | undefined;
        if (!lifetime.active || !props?.scene?.files?.length || !React.isValidElement<NativeProps>(result)) return result;
        const capture = hub.captureEnabled(window.location.search);
        const className = (result.props.className || "") + " dirty-captions-player" + (capture ? " dirty-captions-capture" : "");
        return React.cloneElement(result, { className }, result.props.children,
          <CaptionsController key="dirty-captions-controller" scene={props.scene} capture={capture} />);
      });
      instance.status = "active"; hub.debugLog?.(PLUGIN_ID, "Native scene player captions registered");
    } catch (error) {
      destroy(); instance.status = "failed"; if (!patchAttempted) delete globals[INSTANCE_KEY];
      console.error("[DirtyCaptions] registration failed", error);
    } finally { globals.__dirtyCurrentPluginId = null; }
  }
}
