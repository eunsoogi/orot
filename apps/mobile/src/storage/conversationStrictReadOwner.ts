type Readers = { read: unknown; readMany: unknown };
const pairs = new WeakMap<object, unknown>();
/** Provenance only; no validity is cached and custom reader pairs cannot borrow authority. */
export function registerConversationStrictReaders(readers: Readers) {
  pairs.set(readers.read as object, readers.readMany);
}
export function ownsConversationStrictReaders(readers: Readers) {
  return (
    typeof readers.read === 'function' &&
    pairs.get(readers.read) === readers.readMany
  );
}
