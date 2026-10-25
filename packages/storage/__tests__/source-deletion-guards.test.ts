import type { TranscriptEvidenceSegment } from '@orot/domain';
import { openEncryptedStorage } from '../src';
import {
  audioSourceRecord,
  createDatabase,
  evidenceSpan,
  hashA,
  join,
  mkdtempSync,
  options,
  rmSync,
  sourceRecord,
  tmpdir,
} from './sourceEvidenceTestSupport';

function transcript(recordingSourceId: string): TranscriptEvidenceSegment {
  const transcriptId = `${recordingSourceId}:segment:0`;
  return {
    id: `${transcriptId}:r1`,
    transcriptId,
    recordingSourceId,
    segmentOrdinal: 0,
    revision: 1,
    text: 'synthetic transcript text',
    language: 'ko-KR',
    recordingDurationMs: 5000,
    audioRange: { startMs: 250, endMs: 1800 },
    effectiveAt: '2026-10-05T10:00:00.250Z',
    recordedAt: '2026-10-05T10:01:00.000Z',
    ingestedAt: '2026-10-05T10:01:00.000Z',
    provenance: {
      origin: 'derived',
      sourceRecordIds: [recordingSourceId],
      source: { system: 'Apple Speech', sourceIdentifier: 'synthetic', sourceVersion: '1' },
    },
    reviewState: { status: 'unreviewed' },
  };
}

describe('source deletion references and stale writes', () => {
  it('collects every persisted identity that source deletion cascades', async () => {
    const database = createDatabase();
    const repository = await openEncryptedStorage(options(database));
    const source = await repository.sourceRecords.create(audioSourceRecord('recording-source'));
    const span = await repository.evidenceSpans.create(
      evidenceSpan('recording-span', source.id, {
        kind: 'audio_time_range',
        startMs: 250,
        endMs: 1800,
      }),
    );
    const revision = transcript(source.id);
    await repository.transcripts.append([revision]);
    const metadata = {
      effectiveAt: '2026-01-01T00:00:00Z',
      recordedAt: '2026-01-01T00:00:00Z',
      ingestedAt: '2026-01-01T00:00:00Z',
      provenance: { origin: 'derived' as const, sourceRecordIds: [source.id] },
      reviewState: { status: 'unreviewed' as const },
    };
    await repository.put('encounter', {
      ...metadata,
      id: 'dependent-encounter',
      encounterKind: 'outpatient',
      summary: 'Synthetic dependent encounter.',
    });
    await repository.put('visit_question', {
      ...metadata,
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      id: 'cited-question',
      questionText: 'Synthetic question?',
      priority: 'routine',
      evidenceSpanIds: [span.id],
    });

    const references = await repository.listSourceDeletionReferences(source.id);

    expect(new Set(references)).toEqual(
      new Set([
        source.id,
        span.id,
        revision.id,
        revision.transcriptId,
        'dependent-encounter',
        'cited-question',
      ]),
    );
    await database.closeAsync?.();
  });

  it('rejects replayed dependent inserts, citation inserts, and updates after reopening', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-source-write-fence-'));
    const databasePath = join(directory, 'database.sqlite');
    const database = createDatabase(databasePath);
    const repository = await openEncryptedStorage(options(database));
    const source = await repository.sourceRecords.create(sourceRecord('deleted-source', hashA));
    const span = await repository.evidenceSpans.create(
      evidenceSpan('deleted-span', source.id, {
        kind: 'text_range',
        startOffset: 0,
        endOffset: 4,
      }),
    );
    const base = {
      effectiveAt: '2026-01-01T00:00:00Z',
      recordedAt: '2026-01-01T00:00:00Z',
      ingestedAt: '2026-01-01T00:00:00Z',
      reviewState: { status: 'unreviewed' as const },
    };
    const staleEncounter = {
      ...base,
      id: 'deleted-encounter',
      encounterKind: 'outpatient' as const,
      summary: 'Synthetic stale encounter.',
      provenance: { origin: 'derived' as const, sourceRecordIds: [source.id] },
    };
    const staleQuestion = {
      ...base,
      id: 'deleted-question',
      questionText: 'Synthetic stale question?',
      priority: 'routine' as const,
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
      evidenceSpanIds: [span.id],
    };
    const retainedEncounter = {
      ...base,
      id: 'retained-encounter',
      encounterKind: 'outpatient' as const,
      summary: 'Synthetic retained encounter.',
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
    };
    await repository.put('encounter', staleEncounter);
    await repository.put('visit_question', staleQuestion);
    await repository.put('encounter', retainedEncounter);
    expect(await repository.sourceRecords.delete(source.id)).toBe(true);
    await database.closeAsync?.();

    const reopenedDatabase = createDatabase(databasePath);
    const reopenedRepository = await openEncryptedStorage(options(reopenedDatabase));
    await expect(reopenedRepository.put('encounter', staleEncounter)).rejects.toThrow(
      'Deleted evidence cannot be reinserted.',
    );
    await expect(
      reopenedRepository.put('encounter', {
        ...staleEncounter,
        provenance: { origin: 'user_reported', sourceRecordIds: [] },
      }),
    ).rejects.toThrow('Deleted evidence cannot be reinserted.');
    await expect(
      reopenedRepository.transaction((writer) => writer.put('visit_question', staleQuestion)),
    ).rejects.toThrow('Deleted evidence cannot be reinserted.');
    await expect(
      reopenedRepository.put('encounter', {
        ...retainedEncounter,
        provenance: { origin: 'derived', sourceRecordIds: [source.id] },
      }),
    ).rejects.toThrow('Deleted evidence cannot be reinserted.');
    expect(await reopenedRepository.get('encounter', staleEncounter.id)).toBeNull();
    expect(await reopenedRepository.get('visit_question', staleQuestion.id)).toBeNull();
    await reopenedDatabase.closeAsync?.();
    rmSync(directory, { recursive: true, force: true });
  });

  it('keeps deleted evidence-span and transcript-family IDs fenced under a new source', async () => {
    const database = createDatabase();
    const repository = await openEncryptedStorage(options(database));
    const source = await repository.sourceRecords.create(audioSourceRecord('recording-source'));
    const span = await repository.evidenceSpans.create(
      evidenceSpan('recording-span', source.id, {
        kind: 'audio_time_range',
        startMs: 250,
        endMs: 1800,
      }),
    );
    const revision = transcript(source.id);
    await repository.transcripts.append([revision]);
    expect(await repository.sourceRecords.delete(source.id)).toBe(true);

    const replacement = await repository.sourceRecords.create(
      audioSourceRecord('replacement-recording'),
    );
    await expect(
      repository.evidenceSpans.create(
        evidenceSpan(span.id, replacement.id, {
          kind: 'audio_time_range',
          startMs: 250,
          endMs: 1800,
        }),
      ),
    ).rejects.toThrow('Deleted evidence cannot be reinserted.');
    await expect(
      repository.transcripts.append([
        {
          ...transcript(replacement.id),
          id: revision.id,
          transcriptId: revision.transcriptId,
        },
      ]),
    ).rejects.toThrow('Deleted evidence cannot be reinserted.');
    await database.closeAsync?.();
  });
});
