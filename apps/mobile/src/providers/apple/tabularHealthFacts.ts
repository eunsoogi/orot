/** A typed context table preserves omitted cells separately from observed nulls.
 * Only repeated object arrays are encoded; no source row, field or value is dropped.
 */
export function tabularHealthFacts(value: unknown): unknown {
  if (!Array.isArray(value)) {
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        tabularHealthFacts(item),
      ]),
    );
  }
  if (
    value.length < 2 ||
    value.some(item => !item || typeof item !== 'object' || Array.isArray(item))
  ) {
    return value.map(tabularHealthFacts);
  }
  const records = value as Record<string, unknown>[];
  const columns = [...new Set(records.flatMap(item => Object.keys(item)))];
  const omittedCells: [number, number][] = [];
  const rows = records.map((record, row) =>
    columns.map((key, column) => {
      if (!Object.hasOwn(record, key)) {
        omittedCells.push([row, column]);
        return null;
      }
      return tabularHealthFacts(record[key]);
    }),
  );
  const table = {
    columns,
    rows,
    ...(omittedCells.length ? { omittedCells } : {}),
  };
  // Small heterogeneous arrays may grow in table form; retain the original shape then.
  return JSON.stringify(table).length < JSON.stringify(value).length
    ? table
    : value;
}
