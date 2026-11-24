import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { createLocalQueryProbeFixtures } from '../../../../e2e/localRecordQueryProbeFixtures';
import type { SqlDatabase } from '@orot/storage';
import { openInterleavableRecentSourceDatabase } from '../../../storage/testSupport/interleavableRecentSourceDatabase';
import { createHealthEvidenceTestDatabase } from '../../../healthEvidence/localEvidenceTestSupport';
import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';
import type { AiFeatureLocalData } from '../localData';

export const chosen = 'selected-audio-source';
export const other = 'foreign-audio-source';

export async function withRecordings(
  run: (
    data: AiFeatureLocalData,
    correct: () => Promise<void>,
    storage: ReturnType<typeof createConversationArtifactStorage>,
    database: SqlDatabase,
  ) => Promise<void>,
  omitSelectedTranscript = false,
  useProtectedReadEpoch = false,
) {
  const { database, close } = useProtectedReadEpoch
    ? openInterleavableRecentSourceDatabase()
    : createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const writer = createRecordRepository(database);
    const f = createLocalQueryProbeFixtures();
    for (const id of [chosen, other])
      await writer.put('source_record', {
        ...f.audioSource,
        id,
        contentHash: 'sha256:' + (id === chosen ? 'a' : 'b').repeat(64),
      });
    const segment = (sourceId: string, text: string, revision = 1) => ({
      ...f.transcript,
      id: sourceId + ':segment:r' + revision,
      recordingSourceId: sourceId,
      transcriptId: sourceId + ':segment',
      text,
      revision,
      provenance: { ...f.transcript.provenance, sourceRecordIds: [sourceId] },
    });
    const old = segment(chosen, 'Synthetic transcript outdated');
    if (!omitSelectedTranscript) await writer.transcripts.append([old]);
    await writer.transcripts.append([
      segment(other, 'Synthetic transcript foreign'),
    ]);
    const current = omitSelectedTranscript
      ? undefined
      : await writer.transcripts.correct(
          old.id,
          'Synthetic transcript selected revision',
          '2090-01-02T00:00:00.000Z',
        );
    const data: AiFeatureLocalData = {
      ...createLocalEvidenceData(database),
      repository: createLocalHealthEvidenceRepository(database),
      memoryStorage: { listRecords: async () => [] },
      loadMemoryRecords: async () => {
        throw new Error('Selected recording cannot read unrelated memory');
      },
      rag: {
        index: async () => {},
        search: async (_query, chunks, limit = 6) =>
          chunks.slice(0, limit).map(chunk => ({
            chunk,
            score: 1,
            lexicalRank: 1,
            vectorRank: 1,
          })),
      },
    };
    await run(
      data,
      async () => {
        if (current)
          await writer.transcripts.correct(
            current.id,
            'Synthetic corrected reply',
            '2090-01-03T00:00:00.000Z',
          );
      },
      createConversationArtifactStorage(database),
      database,
    );
  } finally {
    close();
  }
}
