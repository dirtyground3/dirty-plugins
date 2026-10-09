export const MUTATION_DEBOUNCE_MS = 150;
export const RELEVANT_MUTATION_SELECTOR = "#plugin-extractScenes-destinationFolder";
export interface MutationChanges { addedNodes: ArrayLike<Node>; removedNodes: ArrayLike<Node>; }
export function nodeInRelevantArea(node: Node): boolean {
  if (!node || node.nodeType !== 1) return false;
  const element = node as Element;
  return Boolean(element.matches?.(RELEVANT_MUTATION_SELECTOR) || element.querySelector?.(RELEVANT_MUTATION_SELECTOR));
}
export function hasRelevantMutations(records: MutationChanges[]): boolean {
  return records.some(record => Array.from(record.addedNodes).some(nodeInRelevantArea) || Array.from(record.removedNodes).some(nodeInRelevantArea));
}
