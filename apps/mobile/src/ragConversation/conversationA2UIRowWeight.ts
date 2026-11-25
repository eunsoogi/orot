/** Bounded number subset of the pinned Basic Catalog's proportional weight. */
export function isConversationA2UIRowWeight(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= 3
  );
}
