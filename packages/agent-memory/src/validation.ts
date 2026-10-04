import type {
  AgentMemoryInput,
  AgentMemoryKind,
  AgentMemoryProvenance,
  PersistedMemoryRecord,
} from './types';

interface StoredMetadata {
  readonly memoryKey?: unknown;
  readonly kind?: unknown;
  readonly provenance?: unknown;
}

export function validateInput(input: AgentMemoryInput): AgentMemoryInput {
  if (!input.memoryKey.trim()) throw new Error('A stable memory key is required.');
  if (!input.text.trim()) throw new Error('A non-empty memory text is required.');
  if (!isAgentMemoryKind(input.kind)) throw new Error('This memory kind is not allowed.');
  if (!isProvenance(input.provenance)) {
    throw new Error('Memory must be user-confirmed or human-reviewed with valid provenance.');
  }
  const importance = input.importance ?? 0.8;
  if (!Number.isFinite(importance) || importance < 0 || importance > 1) {
    throw new Error('Memory importance must be between 0 and 1.');
  }
  return {
    ...input,
    memoryKey: input.memoryKey.trim(),
    text: input.text.trim(),
    provenance: normalizeProvenance(input.provenance),
    importance,
  };
}

export function isAgentMemoryKind(value: unknown): value is AgentMemoryKind {
  return value === 'preference' || value === 'reviewed_interaction' || value === 'task_context';
}

export function metadataFrom(value: Record<string, unknown>): StoredMetadata {
  return value && typeof value === 'object' ? (value as StoredMetadata) : {};
}

export function provenanceFrom(value: Record<string, unknown>): AgentMemoryProvenance | null {
  const provenance = metadataFrom(value).provenance;
  return isProvenance(provenance) ? provenance : null;
}

export function samePayload(record: PersistedMemoryRecord, input: AgentMemoryInput): boolean {
  const metadata = metadataFrom(record.meta);
  return (
    record.text === input.text &&
    record.importance === input.importance &&
    metadata.kind === input.kind &&
    JSON.stringify(metadata.provenance) === JSON.stringify(input.provenance)
  );
}

function normalizeProvenance(value: AgentMemoryProvenance): AgentMemoryProvenance {
  const sourceIds = [...new Set(value.sourceIds.map((sourceId) => sourceId.trim()))].sort();
  const sourceDates = value.sourceDates
    ?.map((sourceDate) => ({
      sourceId: sourceDate.sourceId.trim(),
      date: sourceDate.date.trim(),
    }))
    .sort(
      (left, right) =>
        left.sourceId.localeCompare(right.sourceId) || left.date.localeCompare(right.date),
    );
  return sourceDates === undefined
    ? { sourceIds, reviewState: value.reviewState }
    : { sourceIds, sourceDates, reviewState: value.reviewState };
}

export function isProvenance(value: unknown): value is AgentMemoryProvenance {
  if (!value || typeof value !== 'object') return false;
  const provenance = value as Partial<AgentMemoryProvenance>;
  if (provenance.reviewState !== 'user_confirmed' && provenance.reviewState !== 'human_reviewed')
    return false;
  if (
    !Array.isArray(provenance.sourceIds) ||
    provenance.sourceIds.some((id) => typeof id !== 'string' || !id.trim())
  )
    return false;
  if (provenance.sourceDates !== undefined) {
    if (!Array.isArray(provenance.sourceDates)) return false;
    if (
      provenance.sourceDates.some(
        (item) =>
          !item ||
          typeof item.sourceId !== 'string' ||
          typeof item.date !== 'string' ||
          !provenance.sourceIds?.includes(item.sourceId) ||
          !item.date.trim(),
      )
    )
      return false;
  }
  return true;
}
