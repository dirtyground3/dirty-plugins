import { React } from "./runtime";
const pageTitleOwners: { title: string; previousTitle: string }[] = [];
export function usePageTitle(pluginName: string, viewTitle?: string) {
  React.useEffect(() => {
    const title = (viewTitle ? viewTitle + " - " : "") + pluginName;
    const owner = { title, previousTitle: document.title };
    pageTitleOwners.push(owner);
    function updateTitle() {
      // Overlapping routes must not fight in a MutationObserver microtask
      // loop. Only the most recently mounted title effect may write.
      if (pageTitleOwners[pageTitleOwners.length - 1] === owner && document.title !== title) document.title = title;
    }
    updateTitle();
    // Native Stash lists can update their Helmet title after loading. Keep
    // the plugin page's title until its route unmounts.
    let observer: MutationObserver | null = null;
    if (window.MutationObserver && document.head) {
      observer = new window.MutationObserver(updateTitle);
      observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    }
    return () => {
      if (observer) observer.disconnect();
      const index = pageTitleOwners.indexOf(owner);
      if (index === -1) return;
      const wasActive = index === pageTitleOwners.length - 1;
      pageTitleOwners.splice(index, 1);
      // Preserve the original title when an older route unmounts first.
      if (pageTitleOwners[index]) pageTitleOwners[index].previousTitle = owner.previousTitle;
      if (wasActive && document.title === title) {
        const activeOwner = pageTitleOwners[pageTitleOwners.length - 1];
        document.title = activeOwner ? activeOwner.title : owner.previousTitle;
      }
    };
  }, [pluginName, viewTitle]);
}
