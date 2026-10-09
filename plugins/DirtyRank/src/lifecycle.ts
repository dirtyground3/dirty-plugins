import type * as R from "react";
export function createLifecycle(React: typeof R) {
  let active = true;
  const effects = new Set<() => void>();
  const useOwnedEffect: typeof R.useEffect = (effect, dependencies) => React.useEffect(() => {
    if (!active) return;
    const cleanup = effect(); let released = false;
    const release = () => { if (released) return; released = true; effects.delete(release); cleanup?.(); };
    effects.add(release); return release;
  }, dependencies);
  function useActive() {
    const [current, setCurrent] = React.useState(active);
    useOwnedEffect(() => () => { if (!active) setCurrent(false); }, []);
    return current && active;
  }
  return {
    isActive: () => active, useOwnedEffect, useActive,
    own(release: () => void) { effects.add(release); },
    destroy() {
      if (!active) return;
      active = false;
      for (const release of Array.from(effects)) {
        try { release(); } catch (error) { console.error("[DirtyRank] cleanup failed", error); }
      }
      effects.clear();
    }
  };
}
