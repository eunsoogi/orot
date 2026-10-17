type StructuralValue = string | boolean | null | readonly (string | null)[];
type Observation = Readonly<Record<string, StructuralValue | number>>;
let observer: ((observation: Observation) => void) | undefined;

/** The test entry alone installs this sink; production never loads the native test bridge. */
export function registerNavigationTestObserver(
  next: (observation: Observation) => void,
) {
  observer = next;
  return () => {
    if (observer === next) observer = undefined;
  };
}

/** Structural keys and fixed event names only: no route content or user data. */
export function observeNavigationTest(
  event: string,
  fields: Readonly<Record<string, StructuralValue>>,
) {
  if (!observer) return;
  try {
    observer({ event, ...fields, atMs: Date.now() });
  } catch {
    // A diagnostic must never alter the route's permission or transition result.
  }
}
