import { chunkTranscriptSegment, searchHybridEvidenceChunks } from '@orot/rag';
import { createRecordRepository } from '@orot/storage';
import { createLocalE5RagService } from '../../../rag/localE5RagService';
import { localE5NativeBackend } from '../../../rag/localE5NativeBackend';
import { SqlCipherRagEmbeddingStorage } from '../../../storage/ragEmbeddingStorage';
import { SqlCipherRagFullTextSearchStore } from '../../../storage/ragFullTextSearch';
import {
  installFingerprint,
  openDatabase,
} from '../../../storage/testSupport/vectorStore';
import {
  original,
  source,
} from '../../../transcription/testSupport/transcriptEvidenceServiceFixtures';
import { searchVisitQuestionEvidence } from '../evidenceSearch';

jest.mock('../../../rag/localE5NativeBackend', () => ({
  localE5NativeBackend: {
    prepare: jest.fn(),
    embedBatch: jest.fn(),
    cancel: jest.fn(),
  },
}));
jest.mock('../../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));

it('preserves real evidence citations and coverage through ranking, correction and recording deletion', async () => {
  installFingerprint();
  jest.mocked(localE5NativeBackend.prepare).mockImplementation(async () => {});
  jest
    .mocked(localE5NativeBackend.embedBatch)
    .mockImplementation(async texts =>
      texts.map(() => Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0))),
    );
  // Real SQLite/repository/FTS/vector operations, with only native E5 and SHA replaced by synthetic work.
  const opened = await openDatabase();
  try {
    const database = opened.database;
    const repository = createRecordRepository(database);
    await repository.put('source_record', source);
    const segments = [
      original,
      {
        ...original,
        id: 'synthetic-second:r1',
        transcriptId: 'synthetic-second',
        segmentOrdinal: 1,
      },
    ];
    await repository.transcripts.append(segments);
    let chunks = segments.map(chunkTranscriptSegment);
    const rag = createLocalE5RagService(database);
    const queryService = {
      searchMemory: jest.fn(async () => ({
        status: 'available' as const,
        hits: [],
        limit: 1,
      })),
      queryNextConfirmedCalendarAppointment: jest.fn(),
    };
    const input = {
      query: '합성 기록',
      maxEvidenceItems: 1,
      sourceKind: 'personal_record' as const,
      repository,
      queryService,
      buildChunks: async () => chunks,
    };
    const actual = await searchVisitQuestionEvidence({ ...input, rag });
    const legacy = await searchVisitQuestionEvidence({
      ...input,
      rag: {
        index: async () => {},
        search: (query, page, limit, options) =>
          searchHybridEvidenceChunks(
            query,
            page,
            rag.provider,
            new SqlCipherRagEmbeddingStorage(database),
            new SqlCipherRagFullTextSearchStore(database),
            limit,
            options,
          ),
      },
    });
    expect(actual).toEqual(legacy);
    expect(actual.batch.items).toHaveLength(1);
    expect(actual.batch.coverage[0]).toMatchObject({
      sourceKind: 'personal_record',
      returnedCount: 1,
      resultLimit: 1,
      truncated: true,
    });
    const item = actual.batch.items[0];
    expect(item).toMatchObject({
      sourceId: source.id,
      locator: { kind: 'audio_time_range', startMs: 250, endMs: 1801 },
    });
    const selected = segments.find(segment => segment.id === item.evidenceId)!;
    const corrected = await repository.transcripts.correct(
      selected.id,
      '수정된 합성 복약 기록',
      '2026-10-06T10:00:00Z',
    );
    chunks = [chunkTranscriptSegment(corrected)];
    const refreshed = await searchVisitQuestionEvidence({ ...input, rag });
    expect(refreshed.batch.items[0]).toMatchObject({
      evidenceId: corrected.id,
      content: corrected.text,
    });
    expect(refreshed.batch.items[0].evidenceRevision).not.toBe(
      item.evidenceRevision,
    );
    expect(refreshed.batch.coverage[0]).toMatchObject({
      returnedCount: 1,
      truncated: false,
    });
    // Cleanup joins the repository's transaction; old snapshots cannot regain either lexical or vector eligibility.
    await rag.prepare();
    await repository.transaction(async (writer, transaction) => {
      await rag.deleteChunks(chunks, [source.id], transaction);
      await writer.delete('source_record', source.id);
    });
    expect(await rag.search(input.query, chunks)).toEqual([]);
    chunks = [];
    const deleted = await searchVisitQuestionEvidence({ ...input, rag });
    expect(deleted.batch.items).toEqual([]);
    expect(deleted.batch.coverage[0]).toMatchObject({
      returnedCount: 0,
      truncated: false,
    });
    expect(queryService.searchMemory).not.toHaveBeenCalled();
  } finally {
    opened.close();
  }
});
