type DisplayTurn = { readonly kind: 'turn' | 'task'; readonly id: string };
const owners = new WeakMap<
  readonly string[],
  {
    readonly sessionId: string;
    readonly signal: AbortSignal;
  }
>();

/** The displayed page always uses explicit IDs. Only the current first timeline
 * selection may enable first-render hydration; copying the IDs conveys nothing. */
export function selectConversationDisplayTurnIds(
  items: readonly DisplayTurn[],
  sessionId: string,
  signal: AbortSignal,
  first: boolean,
): readonly string[] {
  const ids = items.filter(item => item.kind === 'turn').map(item => item.id);
  if (first && ids.length && !signal.aborted)
    owners.set(Object.freeze(ids), { sessionId, signal });
  return ids;
}

export function claimConversationFirstDisplay(
  ids: readonly string[] | undefined,
  sessionId: string,
  signal: AbortSignal,
) {
  const owner = ids && owners.get(ids);
  if (
    !ids ||
    !owner ||
    owner.sessionId !== sessionId ||
    owner.signal !== signal ||
    signal.aborted
  )
    return false;
  // This exact internal request may spend the first-display capability once.
  owners.delete(ids);
  return true;
}
