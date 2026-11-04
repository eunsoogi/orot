/** Compare parsed metadata paths so key order does not change the source revision. */
export function memoryContentChangedPredicate(): string {
  const oldTree =
    "SELECT fullkey, type, atom FROM json_tree(OLD.record_json, '$.meta')";
  const newTree =
    "SELECT fullkey, type, atom FROM json_tree(NEW.record_json, '$.meta')";
  return `json_extract(OLD.record_json, '$.text') IS NOT json_extract(NEW.record_json, '$.text')
    OR EXISTS (${oldTree} EXCEPT ${newTree}) OR EXISTS (${newTree} EXCEPT ${oldTree})`;
}
