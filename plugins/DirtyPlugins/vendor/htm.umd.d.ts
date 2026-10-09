/** The existing vendored HTM runtime binds exclusively to Stash's React. */
declare const htm: { bind(factory: (...args: any[]) => any): HtmlRenderer };
export default htm;
