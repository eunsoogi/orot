import { openEncryptedStorage } from '../src';
import {
  audioSourceRecord,
  createDatabase,
  evidenceSpan,
  join,
  mkdtempSync,
  options,
  rmSync,
  tmpdir,
} from './sourceEvidenceTestSupport';
import { transcriptSegment } from './localQueryTestSupport';

/** Checkpoint resume can query durable deletion identities without restoring old record content. */
describe('source deletion checkpoint references', () => {
  it('returns matching tombstones after source deletion and database reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-checkpoint-source-delete-'));
    const databasePath = join(directory, 'database.sqlite');
    let database = createDatabase(databasePath);
    try {
      const repository = await openEncryptedStorage(options(database));
      const recording = await repository.sourceRecords.create(
        audioSourceRecord('checkpoint-recording'),
      );
      const span = await repository.evidenceSpans.create(
        evidenceSpan('checkpoint-span', recording.id, {
          kind: 'audio_time_range',
          startMs: 250,
          endMs: 1800,
        }),
      );
      const revision = transcriptSegment(recording.id);
      await repository.transcripts.append([revision]);
      await repository.put('encounter', {
        id: 'checkpoint-encounter',
        effectiveAt: '2026-01-01T00:00:00Z',
        recordedAt: '2026-01-01T00:00:00Z',
        ingestedAt: '2026-01-01T00:00:00Z',
        provenance: { origin: 'derived', sourceRecordIds: [recording.id] },
        reviewState: { status: 'unreviewed' },
        encounterKind: 'outpatient',
        summary: 'Synthetic checkpoint dependency.',
      });

      await expect(repository.listDeletedSourceReferenceIds([])).resolves.toEqual([]);
      expect(await repository.sourceRecords.delete(recording.id)).toBe(true);
      const deletedReferences = [
        recording.id,
        span.id,
        revision.id,
        revision.transcriptId,
        'checkpoint-encounter',
      ].sort();
      const requestedReferences = [
        'live-source',
        recording.id,
        ` ${revision.transcriptId} `,
        span.id,
        recording.id,
        revision.id,
        'checkpoint-encounter',
      ];

      await expect(repository.listDeletedSourceReferenceIds(requestedReferences)).resolves.toEqual(
        deletedReferences,
      );

      await database.closeAsync?.();
      database = createDatabase(databasePath);
      const reopenedRepository = await openEncryptedStorage(options(database));
      await expect(
        reopenedRepository.listDeletedSourceReferenceIds(requestedReferences),
      ).resolves.toEqual(deletedReferences);
    } finally {
      await database.closeAsync?.();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
