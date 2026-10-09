// Documentation capture (?docsCapture=1) blurs private paths and media. The
// flag sticks for the page until ?docsCapture=0 is visited.
let captureInThisPage = false;

export function captureEnabled(search?: string) {
  try {
    const currentSearch = window.location && window.location.search || "";
    const query = new URLSearchParams(search == null ? currentSearch : search);
    const currentLocation = search == null || search === currentSearch;
    if (query.get("docsCapture") === "0") {
      if (currentLocation) captureInThisPage = false;
      return false;
    }
    if (query.get("docsCapture") === "1") {
      if (currentLocation) captureInThisPage = true;
      return true;
    }
    return currentLocation && captureInThisPage;
  } catch (_error) {
    return false;
  }
}

/** Keep capture mode on internal links while it is enabled. */
export function captureUrl(to: string, search?: string) {
  if (typeof to !== "string" || !captureEnabled(search == null ? undefined : search)) return to;
  if (/[?&]docsCapture=1(?:&|#|$)/.test(to)) return to;
  if (/[?&]docsCapture=/.test(to)) return to.replace(/([?&]docsCapture=)[^&#]*/, (_match, prefix) => prefix + "1");
  const hash = to.indexOf("#"), beforeHash = hash < 0 ? to : to.slice(0, hash), afterHash = hash < 0 ? "" : to.slice(hash);
  return beforeHash + (beforeHash.indexOf("?") < 0 ? "?" : "&") + "docsCapture=1" + afterHash;
}
