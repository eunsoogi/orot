import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';

type Catalog = 'summary' | 'conversation';
type CursorState = {
  sequence: number;
  readonly tokens: Map<
    string,
    { scope: string; query: string; cursor: string }
  >;
};
// Only the live registry owns raw database cursors. Catalogs never share token namespaces.
const states = new WeakMap<
  LocalEvidenceReferenceRegistry,
  Map<Catalog, CursorState>
>();

export function artifactCursorState(
  registry: LocalEvidenceReferenceRegistry,
  catalog: Catalog,
): CursorState {
  let catalogs = states.get(registry);
  if (!catalogs) {
    catalogs = new Map();
    states.set(registry, catalogs);
  }
  let state = catalogs.get(catalog);
  if (!state) {
    state = { sequence: 0, tokens: new Map() };
    catalogs.set(catalog, state);
  }
  return state;
}

/** A new tool bundle does not erase old usable tokens. Refuse cold capture until tokens,
 * chooser state and subsequent user-page routing have an exact protected reconstruction contract. */
export function hasArtifactCursorState(
  registry: LocalEvidenceReferenceRegistry,
): boolean {
  const catalogs = states.get(registry);
  return Boolean(
    catalogs && [...catalogs.values()].some(state => state.tokens.size > 0),
  );
}
