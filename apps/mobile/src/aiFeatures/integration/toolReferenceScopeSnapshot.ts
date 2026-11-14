import type {
  EvidenceReference,
  ToolSourceReference,
} from '@orot/agent-runtime';
import { stableJson } from './evidenceUtils';

export type ToolRunScope = {
  readonly sessionId: string;
  readonly operationRunId: string;
};
export type ResearchAliasResolver = (
  alias: EvidenceReference,
) => EvidenceReference | undefined;
type Binding = {
  readonly callId: string;
  readonly source: ToolSourceReference;
  readonly target: {
    readonly alias: EvidenceReference;
    readonly original: EvidenceReference;
  } | null;
};
/** Protected provenance only. Pending/ready stages and ambiguity tombstones never confer dispatch permission. */
export interface ToolReferenceScopeSnapshot {
  readonly version: 1;
  readonly scope: ToolRunScope;
  readonly knownCallIds: readonly string[];
  readonly ready: readonly Binding[];
  readonly pending: readonly Binding[];
}
export type ToolScopeReceipt = Readonly<ToolRunScope>;

export function sourceKey(value: ToolSourceReference) {
  return JSON.stringify([
    value.sourceKind,
    value.sourceId,
    value.sourceRevision,
    value.evidenceId,
    value.evidenceRevision,
  ]);
}
export function researchKey(
  value: ToolSourceReference,
  scope: ToolRunScope,
  callId: string,
) {
  return JSON.stringify([
    scope.sessionId,
    scope.operationRunId,
    callId,
    sourceKey(value),
  ]);
}
function calls(values: readonly string[]) {
  if (
    !Array.isArray(values) ||
    values.some(id => typeof id !== 'string' || !id.trim()) ||
    new Set(values).size !== values.length
  )
    throw new Error('Invalid protected tool call identities.');
  return [...values].sort();
}
function exact<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function captureToolScope(
  scope: ToolRunScope,
  knownCallIds: readonly string[],
  resolve: ResearchAliasResolver,
  research: ReadonlyMap<string, EvidenceReference | null>,
  pending: ReadonlyMap<string, EvidenceReference | null>,
): ToolReferenceScopeSnapshot {
  const select = (
    entries: ReadonlyMap<string, EvidenceReference | null>,
  ): Binding[] =>
    [...entries].flatMap(([key, alias]) => {
      const [sessionId, operationRunId, callId, source] = JSON.parse(key);
      if (
        sessionId !== scope.sessionId ||
        operationRunId !== scope.operationRunId
      )
        return [];
      const [
        sourceKind,
        sourceId,
        sourceRevision,
        evidenceId,
        evidenceRevision,
      ] = JSON.parse(source);
      const original = alias && resolve(alias);
      if (alias && !original)
        throw new Error('Scoped research alias is unavailable.');
      return [
        {
          callId,
          source: {
            sourceKind,
            sourceId,
            sourceRevision,
            evidenceId,
            evidenceRevision,
          },
          target: alias ? { alias, original: original! } : null,
        },
      ];
    });
  const snapshot = exact({
    version: 1 as const,
    scope,
    knownCallIds: calls(knownCallIds),
    ready: select(research),
    pending: select(pending),
  });
  restoreToolScope(snapshot, scope, knownCallIds, resolve);
  return snapshot;
}

/** Caller obtains knownCallIds from protected graph/tool journal, never newly allocated call numbers. */
export function restoreToolScope(
  value: ToolReferenceScopeSnapshot,
  scope: ToolRunScope,
  knownCallIds: readonly string[],
  resolve: ResearchAliasResolver,
) {
  if (
    !scope ||
    typeof scope.sessionId !== 'string' ||
    !scope.sessionId.trim() ||
    typeof scope.operationRunId !== 'string' ||
    !scope.operationRunId.trim() ||
    !value ||
    value.version !== 1 ||
    stableJson(value.scope) !== stableJson(scope) ||
    stableJson(calls(value.knownCallIds)) !== stableJson(calls(knownCallIds)) ||
    !Array.isArray(value.ready) ||
    !Array.isArray(value.pending)
  )
    throw new Error('Missing or foreign protected tool scope.');
  const snapshot = exact(value);
  const known = new Set(knownCallIds),
    aliases = new Set<string>();
  let ambiguous = false;
  const restore = (rows: readonly Binding[]) => {
    const entries = new Map<string, EvidenceReference | null>();
    for (const row of rows) {
      if (
        !row ||
        !known.has(row.callId) ||
        !row.source ||
        row.source.sourceKind !== 'external_medical' ||
        [
          row.source.sourceId,
          row.source.sourceRevision,
          row.source.evidenceId,
          row.source.evidenceRevision,
        ].some(field => typeof field !== 'string' || !field)
      )
        throw new Error('Invalid scoped tool source or call.');
      const key = researchKey(row.source, scope, row.callId);
      if (entries.has(key)) throw new Error('Duplicate scoped tool source.');
      if (row.target === null) {
        ambiguous = true;
        entries.set(key, null);
        continue;
      }
      const original = row.target?.alias && resolve(row.target.alias);
      const locator = original?.locator as
        { kind?: unknown; type?: unknown } | undefined;
      if (
        !original ||
        !row.target?.original ||
        stableJson(original) !== stableJson(row.target.original) ||
        original.sourceKind !== 'generated_artifact' ||
        !/^research-[1-9][0-9]*$/.test(original.sourceId) ||
        original.sourceId !== original.evidenceId ||
        original.sourceRevision !== original.evidenceRevision ||
        locator?.kind !== 'generated_artifact' ||
        !['research_publication', 'research_web_explanation'].includes(
          String(locator.type),
        )
      )
        throw new Error('Scoped research original changed or is unavailable.');
      aliases.add(stableJson(row.target.alias));
      entries.set(key, row.target.alias);
    }
    return entries;
  };
  const ready = restore(snapshot.ready),
    pending = restore(snapshot.pending);
  return { ready, pending, aliases, ambiguous, scope: exact(scope) };
}
