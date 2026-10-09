import type { Dependencies } from "../types";
import type { SharedProps } from "../../../DirtyPlugins/src/types";
export function createControls({ api, hub: DirtyPlugins }: Dependencies) {
  const React = api.React, icons = api.libraries.FontAwesomeSolid ?? {};
  const ICONS = {    
close: icons.faXmark ?? icons.faTimes, error: icons.faTriangleExclamation ?? icons.faExclamationTriangle, next: icons.faForwardStep ?? icons.faStepForward,
    oCounter: icons.faDroplet ?? icons.faTint, previous: icons.faBackwardStep ?? icons.faStepBackward, reload: icons.faRotateRight ?? icons.faRedo, success: icons.faCheck  
};
  function PluginIconButton(props: SharedProps) { return <DirtyPlugins.react.IconButton {...props} className="ms-button" />; }
  function StateView({ detail, onRetry, title }: { detail?: string; onRetry?: () => void; title: string }) {    
return <DirtyPlugins.react.StateView
      className="ms-state"
      detail={detail}
      title={title}

      actions={onRetry ? <PluginIconButton
        ariaLabel="Retry"
        fallback="reload"
        icon={ICONS.reload}
        onClick={onRetry}
      /> : null}
    />;  
}
  return { PluginIconButton, StateView, ICONS };
}
