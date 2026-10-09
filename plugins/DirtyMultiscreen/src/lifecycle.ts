import type { Dependencies } from "./types";
import type { EffectCallback, DependencyList } from "react";
export function observeSubtree(target: Element, callback: () => void) { const observer = new MutationObserver(callback); observer.observe(target, { childList: true, subtree: true }); return observer; }
export function createLifecycle({ api, life }: Dependencies) {
  function useOwnedEffect(effect: EffectCallback, deps?: DependencyList) {
    api.React.useEffect(() => {
      if (!life.active) return;
      const cleanup = effect(); let released = false;
      function release() { if (released) return; released = true; life.effects.delete(release); cleanup?.(); }
      life.effects.add(release); return release;
    }, deps);
  }
  function useActive() {
    const [active, setActive] = api.React.useState(life.active);
    useOwnedEffect(() => () => { if (!life.active) setActive(false); }, []);
    return active && life.active;
  }
  return { useOwnedEffect, useActive };
}
