import type { EmbeddingProvider } from '@orot/agent-memory';
import type { RecordMap } from '@orot/storage';
import { AGENT_MEMORY_PROBE_CHUNK_ID } from './agentMemoryRagProbe';

const defaultSourceRecord = {
  id: 'agent-memory-synthetic-source',
  effectiveAt: '2026-01-02T00:00:00Z',
  recordedAt: '2026-01-02T00:00:00Z',
  ingestedAt: '2026-01-02T00:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  sourceKind: 'user_note',
  title: 'Synthetic preference source',
  contentHash: 'sha256:' + 'a'.repeat(64),
} satisfies RecordMap['source_record'];

export const originalText =
  '사용자는 외래 일정 알림을 하루 전에 받고 싶어 한다.';
export const correctedText =
  '사용자는 외래 일정 알림을 오전 10시에 받고 싶어 한다.';
const memoryInput = {
  memoryKey: 'preference:outpatient-reminder',
  kind: 'preference' as const,
  provenance: {
    sourceIds: [defaultSourceRecord.id],
    sourceDates: [
      {
        sourceId: defaultSourceRecord.id,
        date: defaultSourceRecord.recordedAt,
      },
    ],
    reviewState: 'user_confirmed' as const,
  },
};

export const deterministicProvider: EmbeddingProvider = {
  kind: 'embedding',
  id: 'agent-memory-e2e-fixture',
  displayName: 'Synthetic test embedding',
  capabilities: { inputTypes: ['text'] },
  async embed({ input }) {
    return {
      ok: true,
      value: { vectors: input.map(deterministicVector) },
    };
  },
};

/** Separate each new integration case from durable deletion fences while retaining the legacy fixture by default. */
export function createAgentMemoryProbeFixture(
  identifier = defaultSourceRecord.id,
) {
  if (
    identifier !== defaultSourceRecord.id &&
    !/^test-memory-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      identifier,
    )
  )
    throw new Error('Invalid synthetic memory fixture identifier');
  const scoped = identifier !== defaultSourceRecord.id;
  const sourceRecord = {
    ...defaultSourceRecord,
    id: identifier,
    // Scoped synthetic hashes prevent cross-case deduplication; they do not claim to hash a real recording.
    contentHash: scoped
      ? 'sha256:' +
        identifier
          .slice('test-memory-'.length)
          .toLowerCase()
          .replace(/-/g, '')
          .repeat(2)
      : defaultSourceRecord.contentHash,
  };
  return {
    sourceRecord,
    // Vector deletion fences are durable too; every isolated case needs its own chunk identity.
    chunkId: scoped ? identifier + ':chunk' : AGENT_MEMORY_PROBE_CHUNK_ID,
    memoryInput: {
      ...memoryInput,
      memoryKey: scoped
        ? 'preference:' + identifier + ':outpatient-reminder'
        : memoryInput.memoryKey,
      provenance: {
        ...memoryInput.provenance,
        sourceIds: [identifier],
        sourceDates: [{ sourceId: identifier, date: sourceRecord.recordedAt }],
      },
    },
  };
}

function deterministicVector(text: string): number[] {
  const vector = new Array<number>(64).fill(0);
  for (let index = 0; index < text.length; index += 1) {
    const bucket = text.charCodeAt(index) % vector.length;
    vector[bucket] += (index % 3) + 1;
  }
  return vector;
}
