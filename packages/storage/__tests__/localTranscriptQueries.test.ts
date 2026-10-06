import { createLocalRecordQueryRepository, runMigrations } from '../src';
import type { SqlDatabase } from '../src';
import { createRecordRepository } from '../src/repository';
import { createDatabase } from './sourceEvidenceTestSupport';
import { audioSource, transcriptSegment } from './localQueryTestSupport';

describe('bounded transcript evidence queries', () => {
  let database: SqlDatabase;
  let repository: ReturnType<typeof createRecordRepository>;
  let queries: ReturnType<typeof createLocalRecordQueryRepository>;

  beforeEach(async () => {
    database = createDatabase();
    await runMigrations(database);
    repository = createRecordRepository(database);
    queries = createLocalRecordQueryRepository(database);
  });

  afterEach(async () => database.closeAsync?.());

  it('returns only current source-linked transcript revisions and reports stale artifacts', async () => {
    const recording = audioSource('recording-query-1');
    await repository.sourceRecords.create(recording);
    const original = transcriptSegment(recording.id);
    await repository.transcripts.append([original]);
    await repository.put('visit_question', {
      id: 'question-from-old-transcript',
      effectiveAt: original.effectiveAt,
      recordedAt: original.recordedAt,
      ingestedAt: original.ingestedAt,
      provenance: { origin: 'derived', sourceRecordIds: [original.id] },
      reviewState: { status: 'unreviewed' },
      questionText: '어느 시간에 복용했나요?',
      priority: 'important',
      evidenceSpanIds: [],
    });
    const corrected = await repository.transcripts.correct(
      original.id,
      '복용 시간은 저녁이라고 들었어요.',
      '2026-10-01T00:00:06.000Z',
    );

    const result = await queries.queryTranscriptEvidence({
      recordingSourceId: recording.id,
      fromInclusive: '2026-10-01T00:00:00Z',
      toExclusive: '2026-10-02T00:00:00Z',
      limit: 1,
    });

    expect(result).toMatchObject({
      status: 'available',
      hasMore: false,
      records: [
        {
          id: corrected.id,
          revision: 2,
          supersedesId: original.id,
          text: '복용 시간은 저녁이라고 들었어요.',
          reviewState: { status: 'needs_review' },
          provenance: { sourceRecordIds: [recording.id, original.id] },
        },
      ],
      staleArtifacts: [
        {
          kind: 'visit_question',
          id: 'question-from-old-transcript',
          supersededSegmentId: original.id,
          currentSegmentId: corrected.id,
        },
      ],
      staleArtifactsHaveMore: false,
    });
  });

  it('treats an unknown or injection-shaped recording ID as a bounded empty lookup', async () => {
    const result = await queries.queryTranscriptEvidence({
      recordingSourceId: "' OR 1=1 --",
      fromInclusive: '2026-10-01T00:00:00Z',
      toExclusive: '2026-10-02T00:00:00Z',
    });

    expect(result).toMatchObject({
      status: 'no_local_records_in_range',
      records: [],
      staleArtifacts: [],
      hasMore: false,
    });
  });
});
