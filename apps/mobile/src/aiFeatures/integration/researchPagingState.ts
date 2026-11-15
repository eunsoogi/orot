export type ResearchCursor = { query: string; scope: string; cursor: string };
export type ResearchPagingSnapshot = {
  version: 1;
  sequence: number;
  tokens: Array<ResearchCursor & { token: string }>;
};

/** Protected reconstruction only: no authority, source reads or dispatch is restored here.
 * The original run owns every token; raw row cursors must never enter provider-visible state. */
export function createResearchPagingState(restored?: {
  snapshot: unknown;
  operationRunId: string;
}) {
  const state = { sequence: 0, tokens: new Map<string, ResearchCursor>() };
  const decode = (value: unknown, run: string): ResearchPagingSnapshot => {
    const snapshot = JSON.parse(
      JSON.stringify(value),
    ) as ResearchPagingSnapshot;
    if (
      !snapshot ||
      snapshot.version !== 1 ||
      !Number.isSafeInteger(snapshot.sequence) ||
      snapshot.sequence < 0 ||
      Object.keys(snapshot).sort().join(',') !== 'sequence,tokens,version' ||
      !Array.isArray(snapshot.tokens) ||
      snapshot.tokens.length > 1024 ||
      !run
    )
      throw new Error('Invalid protected research paging state.');
    const seen = new Set<string>();
    for (const row of snapshot.tokens) {
      const number =
        row && typeof row.token === 'string'
          ? /^research-page-([1-9]\d*)$/u.exec(row.token)?.[1]
          : undefined;
      if (
        !row ||
        Object.keys(row).sort().join(',') !== 'cursor,query,scope,token' ||
        !number ||
        !Number.isSafeInteger(Number(number)) ||
        Number(number) > snapshot.sequence ||
        seen.has(row.token) ||
        row.scope !== run ||
        typeof row.query !== 'string' ||
        !row.query ||
        row.query.trim() !== row.query ||
        row.query.length > 240 ||
        typeof row.cursor !== 'string' ||
        !/^research-[1-9]\d*$/u.test(row.cursor) ||
        !Number.isSafeInteger(Number(row.cursor.slice(9)))
      )
        throw new Error('Research paging ownership changed.');
      seen.add(row.token);
    }
    return snapshot;
  };
  if (restored) {
    const snapshot = decode(restored.snapshot, restored.operationRunId);
    state.sequence = snapshot.sequence;
    for (const { token, ...cursor } of snapshot.tokens)
      state.tokens.set(token, cursor);
  }
  return {
    state,
    snapshot(operationRunId: string): ResearchPagingSnapshot {
      return decode(
        {
          version: 1,
          sequence: state.sequence,
          tokens: [...state.tokens].map(([token, cursor]) => ({
            token,
            ...cursor,
          })),
        },
        operationRunId,
      );
    },
  };
}
