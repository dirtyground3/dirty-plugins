import type { Operation, Preview, PreviewFilter, Variable } from "../types";
export const PREVIEW_PAGE_SIZE = 50;
export function groupVariables(variables: Variable[]) {
  const groups = new Map<string, Variable[]>();
  variables.forEach(variable => {
    const group = variable[2] || "Variables";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(variable);
  });
  return Array.from(groups, ([header, variables]) => ({ header, variables }));
}
export function previewSlice(preview: Preview | null, filter: PreviewFilter, page: number) {
  const operations = preview && Array.isArray(preview.operations) ? preview.operations : [];
  const filtered =
    filter === "all"
      ? operations
      : operations.filter((operation: Operation) =>
          filter === "move" || filter === "rename"
            ? (operation.actions || []).includes(filter)
            : operation.status === filter,
        );
  return {
    total: filtered.length,
    pages: Math.max(1, Math.ceil(filtered.length / PREVIEW_PAGE_SIZE)),
    visible: filtered.slice((page - 1) * PREVIEW_PAGE_SIZE, page * PREVIEW_PAGE_SIZE),
  };
}
