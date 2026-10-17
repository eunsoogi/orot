import { SourceRecordSchema, SymptomEntrySchema } from '@orot/domain';
import type { EvidenceChunk } from '@orot/rag';
import { openLocalStorage } from '../src/storage/secureDatabase';

const ownedIds = new Set([
  'korean-bp-medication',
  'korean-stomach-symptom',
  'korean-sleep',
  'korean-walk',
  'korean-lab',
  'korean-weight',
  'hybrid-synthetic-medication',
  'hybrid-synthetic-sleep',
]);

/** Search fences require live backing rows. These fixed synthetic corpora use real typed storage; no missing-source guard is bypassed. */
export async function prepareRetrievalCorpus(
  chunks: readonly EvidenceChunk[],
  mode: 'fresh' | 'restart',
) {
  if (mode !== 'fresh' && mode !== 'restart')
    throw new Error('Unsupported synthetic retrieval persistence mode');
  if (chunks.length === 0)
    throw new Error('Synthetic retrieval corpus must contain records');
  if (new Set(chunks.map(chunk => chunk.id)).size !== chunks.length)
    throw new Error('Synthetic retrieval corpus identifiers must be unique');
  const records = chunks.map(chunk => {
    if (
      !ownedIds.has(chunk.id) ||
      chunk.metadata.sourceId !== chunk.id ||
      chunk.metadata.sourceRecordIds.length !== 1 ||
      chunk.metadata.sourceRecordIds[0] !== chunk.id
    )
      throw new Error(
        'Synthetic retrieval corpus has a foreign source identity',
      );
    const timestamp =
      chunk.metadata.effectiveTime ?? '2035-06-01T00:00:00.000Z';
    const metadata = {
      id: chunk.id,
      effectiveAt: timestamp,
      recordedAt: timestamp,
      ingestedAt: timestamp,
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
      reviewState: chunk.metadata.reviewState,
    };
    const locator = chunk.metadata.evidenceLocator;
    if (locator.kind === 'structured_record') {
      if (
        locator.recordId !== chunk.id ||
        chunk.metadata.evidenceId !== chunk.id ||
        chunk.metadata.recordType !== 'symptom_entry'
      )
        throw new Error(
          'Synthetic structured retrieval rows must match their locator',
        );
      return {
        kind: 'symptom_entry' as const,
        value: SymptomEntrySchema.parse({
          ...metadata,
          description: chunk.text,
        }),
      };
    }
    return {
      kind: 'source_record' as const,
      value: SourceRecordSchema.parse({
        ...metadata,
        sourceKind: 'user_note',
        title: `Synthetic retrieval source ${chunk.id}`,
      }),
    };
  });
  const repository = await openLocalStorage();
  for (const record of records) {
    const existing = await repository.get(record.kind, record.value.id);
    if (mode === 'fresh') {
      // Even an identical pre-existing row is not ours to overwrite in a fresh isolated corpus.
      if (existing)
        throw new Error('Fresh synthetic retrieval source already exists');
      await repository.put(record.kind, record.value);
    } else if (JSON.stringify(existing) !== JSON.stringify(record.value)) {
      throw new Error(
        'Persisted synthetic retrieval source did not survive unchanged',
      );
    }
  }
}
