type Readers = {
  read?: unknown;
  readMany?: unknown;
  beginReadOperation?: unknown;
};
const pairs = new WeakMap<object, { many: unknown; begin: unknown }>();
/** Provenance only; no validity is cached and custom reader pairs cannot borrow authority. */
export function registerConversationStrictReaders(readers: Readers) {
  pairs.set(readers.read as object, {
    many: readers.readMany,
    begin: readers.beginReadOperation,
  });
}
export function ownsConversationStrictReaders(readers: Readers) {
  const pair =
    typeof readers.read === 'function' ? pairs.get(readers.read) : undefined;
  return Boolean(
    pair &&
    pair.many === readers.readMany &&
    pair.begin === readers.beginReadOperation,
  );
}
