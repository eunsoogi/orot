import { openEncryptedStorage } from '../src';
import type { TranscriptEvidenceSegment } from '@orot/domain';
import {
  audioSourceRecord,
  createDatabase,
  hashB,
  options,
  sourceRecord,
} from './sourceEvidenceTestSupport';

function transcript(recordingSourceId: string): TranscriptEvidenceSegment {
  const transcriptId = `${recordingSourceId}:segment:0`;
  return {
    id: `${transcriptId}:r1`,
    transcriptId,
    recordingSourceId,
    segmentOrdinal: 0,
    revision: 1,
    text: '복용하지 않았어요.',
    language: 'ko-KR',
    recordingDurationMs: 5000,
    audioRange: { startMs: 250, endMs: 1800 },
    effectiveAt: '2026-10-05T10:00:00.250Z',
    recordedAt: '2026-10-05T10:01:00.000Z',
    ingestedAt: '2026-10-05T10:01:00.000Z',
    provenance: {
      origin: 'derived',
      sourceRecordIds: [recordingSourceId],
      source: {
        system: 'Apple Speech',
        sourceIdentifier: 'dictation_transcriber',
        sourceVersion: 'iOS 26.2 (23C54)',
      },
    },
    reviewState: { status: 'unreviewed' },
  };
}

describe('persisted transcript evidence', () => {
  it('migrates v5 storage, appends immutable revisions, and invalidates derived artifacts atomically', async () => {
    const database = createDatabase();
    await database.execute(
      'CREATE TABLE source_records (id TEXT PRIMARY KEY NOT NULL, effective_at TEXT NOT NULL, recorded_at TEXT NOT NULL, ingested_at TEXT NOT NULL, payload_json TEXT NOT NULL CHECK (json_valid(payload_json)))',
    );
    const audio = audioSourceRecord('recording-1');
    await database.execute(
      'INSERT INTO source_records (id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)',
      [audio.id, audio.effectiveAt, audio.recordedAt, audio.ingestedAt, JSON.stringify(audio)],
    );
    await database.execute('PRAGMA user_version = 5');
    const repository = await openEncryptedStorage(options(database));
    expect((await database.execute('PRAGMA user_version')).rows[0]?.user_version).toBe(9);
    const original = transcript(audio.id);
    await repository.transcripts.append([original]);
    await repository.put('visit_question', {
      id: 'question-1',
      effectiveAt: original.effectiveAt,
      recordedAt: original.recordedAt,
      ingestedAt: original.ingestedAt,
      provenance: { origin: 'derived', sourceRecordIds: [original.id] },
      reviewState: { status: 'unreviewed' },
      questionText: 'Did the patient take the medication?',
      priority: 'important',
      evidenceSpanIds: [],
    });
    await expect(repository.put('transcript_segment', original)).rejects.toThrow(
      'Transcript revisions must be appended',
    );
    await expect(repository.delete('transcript_segment', original.id)).rejects.toThrow(
      'Transcript revisions cannot be deleted',
    );

    await database.execute(
      "CREATE TRIGGER reject_transcript_invalidation BEFORE INSERT ON transcript_artifact_staleness BEGIN SELECT RAISE(ABORT, 'invalidation unavailable'); END",
    );
    await expect(
      repository.transcripts.correct(
        original.id,
        '복용했다고 말했어요.',
        '2026-10-05T10:02:00.000Z',
      ),
    ).rejects.toThrow('invalidation unavailable');
    expect(await repository.transcripts.listForRecording(audio.id)).toEqual([original]);
    expect(await repository.transcripts.listStaleArtifacts(original.transcriptId)).toEqual([]);
    await database.execute('DROP TRIGGER reject_transcript_invalidation');

    const corrected = await repository.transcripts.correct(
      original.id,
      '복용했다고 말했어요.',
      '2026-10-05T10:02:00.000Z',
    );
    expect(corrected).toMatchObject({
      revision: 2,
      supersedesId: original.id,
      reviewState: { status: 'needs_review' },
      provenance: { origin: 'user_reported', source: original.provenance.source },
      audioRange: original.audioRange,
    });
    expect(await repository.transcripts.listForRecording(audio.id)).toEqual([original, corrected]);
    expect(await repository.transcripts.listStaleArtifacts(original.transcriptId)).toMatchObject([
      { kind: 'visit_question', id: 'question-1', currentSegmentId: corrected.id },
    ]);
    await expect(
      database.execute('UPDATE transcript_segments SET payload_json = ? WHERE id = ?', [
        JSON.stringify(original),
        original.id,
      ]),
    ).rejects.toThrow('Transcript revisions are append-only.');

    expect(await repository.sourceRecords.delete(audio.id)).toBe(true);
    expect(await repository.transcripts.listForRecording(audio.id)).toEqual([]);
    expect(await repository.transcripts.listStaleArtifacts(original.transcriptId)).toEqual([]);
    await database.closeAsync?.();
  });

  it('rejects non-audio sources and avoids revisions when corrected text is unchanged', async () => {
    const database = createDatabase();
    const repository = await openEncryptedStorage(options(database));
    await repository.sourceRecords.create(sourceRecord('note-1'));
    await expect(repository.transcripts.append([transcript('note-1')])).rejects.toThrow(
      'existing audio recording source',
    );
    const audio = { ...audioSourceRecord('recording-2'), contentHash: hashB };
    await repository.sourceRecords.create(audio);
    const original = transcript(audio.id);
    await repository.transcripts.append([original]);
    await expect(
      repository.transcripts.correct(original.id, original.text, '2026-10-05T10:02:00.000Z'),
    ).resolves.toEqual(original);
    expect(await repository.transcripts.listForRecording(audio.id)).toEqual([original]);
    await database.closeAsync?.();
  });
});
