import type { DependencyList, EffectCallback } from "react";
import { life, React } from "./runtime";
export function observeSubtree(target: Element, callback: () => void) { const observer = new MutationObserver(callback); observer.observe(target, { childList: true, subtree: true }); return observer; }
/** useEffect whose cleanup also runs when the instance is destroyed. */
export function useOwnedEffect(effect: EffectCallback, deps?: DependencyList) {
  React.useEffect(() => {
    if (!life.active) return;
    const cleanup = effect(); let released = false;
    function release() { if (released) return; released = true; life.effects.delete(release); cleanup?.(); }
    life.effects.add(release); return release;
  }, deps);
}
export function useActive() {
  const [active, setActive] = React.useState(life.active);
  useOwnedEffect(() => () => { if (!life.active) setActive(false); }, []);
  return active && life.active;
}
