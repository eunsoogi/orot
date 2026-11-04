/** Compare parsed metadata paths so key order does not change the source revision. */
export function jsonValueChangedPredicate(
  oldValue: string,
  newValue: string,
  path = '$',
): string {
  const oldTree = `SELECT fullkey, type, atom FROM json_tree(${oldValue}, '${path}')`;
  const newTree = `SELECT fullkey, type, atom FROM json_tree(${newValue}, '${path}')`;
  return `(EXISTS (${oldTree} EXCEPT ${newTree}) OR EXISTS (${newTree} EXCEPT ${oldTree}))`;
}

export function memoryContentChangedPredicate(): string {
  return `json_extract(OLD.record_json, '$.text') IS NOT json_extract(NEW.record_json, '$.text')
    OR ${jsonValueChangedPredicate('OLD.record_json', 'NEW.record_json', '$.meta')}`;
}
