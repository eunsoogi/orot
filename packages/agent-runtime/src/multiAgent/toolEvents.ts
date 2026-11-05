import type { EvidenceSourceKind, EvidenceReference } from './evidenceContracts';

export type ConversationToolStatus =
  'started' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type ToolSourceReference = Pick<
  EvidenceReference,
  'sourceKind' | 'sourceId' | 'sourceRevision' | 'evidenceId' | 'evidenceRevision'
>;

/** Public display contract v1 has no free-form input/output or reasoning fields. */
export interface ConversationToolEvent {
  readonly version: 1;
  readonly operationRunId: string;
  readonly callId: string;
  readonly toolName: string;
  readonly order: number;
  readonly status: ConversationToolStatus;
  readonly inputSummary: { readonly sourceKind: EvidenceSourceKind };
  readonly resultSummary?: { readonly referenceCount: number };
  readonly sources: readonly ToolSourceReference[];
}

const kinds: readonly string[] = [
  'personal_record',
  'reviewed_memory',
  'generated_artifact',
  'external_medical',
];
const statuses: readonly string[] = ['started', 'completed', 'failed', 'cancelled', 'interrupted'];
const identity = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 200;

/** Project supplied objects so extra provider content cannot enter storage. */
export function projectConversationToolEvent(value: unknown): ConversationToolEvent | null {
  if (!value || typeof value !== 'object') return null;
  const e = value as ConversationToolEvent;
  if (
    e.version !== 1 ||
    !identity(e.operationRunId) ||
    !identity(e.callId) ||
    !identity(e.toolName) ||
    !Number.isSafeInteger(e.order) ||
    e.order < 0 ||
    !statuses.includes(e.status) ||
    !kinds.includes(e.inputSummary?.sourceKind) ||
    !Array.isArray(e.sources) ||
    e.sources.length > 100 ||
    (e.resultSummary !== undefined &&
      (!Number.isSafeInteger(e.resultSummary.referenceCount) || e.resultSummary.referenceCount < 0))
  )
    return null;
  const sources: ToolSourceReference[] = [];
  for (const source of e.sources) {
    if (
      !source ||
      !kinds.includes(source.sourceKind) ||
      ![source.sourceId, source.sourceRevision, source.evidenceId, source.evidenceRevision].every(
        identity,
      )
    )
      return null;
    sources.push({
      sourceKind: source.sourceKind,
      sourceId: source.sourceId,
      sourceRevision: source.sourceRevision,
      evidenceId: source.evidenceId,
      evidenceRevision: source.evidenceRevision,
    });
  }
  return {
    version: 1,
    operationRunId: e.operationRunId,
    callId: e.callId,
    toolName: e.toolName,
    order: e.order,
    status: e.status,
    inputSummary: { sourceKind: e.inputSummary.sourceKind },
    ...(e.resultSummary
      ? { resultSummary: { referenceCount: e.resultSummary.referenceCount } }
      : {}),
    sources,
  };
}

/** A delayed start cannot reopen a terminal call; first terminal result wins conflicting replay. */
export function mergeConversationToolEvents(
  existing: readonly ConversationToolEvent[],
  incoming: ConversationToolEvent,
): readonly ConversationToolEvent[] {
  const event = projectConversationToolEvent(incoming);
  if (!event) throw new Error('Invalid conversation tool event.');
  const prior = existing.find(
    (e) => e.operationRunId === event.operationRunId && e.callId === event.callId,
  );
  if (
    prior &&
    (prior.toolName !== event.toolName ||
      prior.order !== event.order ||
      prior.inputSummary.sourceKind !== event.inputSummary.sourceKind)
  )
    throw new Error('Tool call identity changed.');
  if (prior && (prior.status !== 'started' || event.status === 'started')) return existing;
  return [...existing.filter((e) => e !== prior), event].sort(
    (a, b) =>
      a.operationRunId.localeCompare(b.operationRunId) ||
      a.order - b.order ||
      a.callId.localeCompare(b.callId),
  );
}
