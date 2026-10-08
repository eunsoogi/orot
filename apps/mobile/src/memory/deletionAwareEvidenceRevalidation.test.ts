import type { EvidenceReference } from '@orot/agent-runtime';
import type { SqlDatabase } from '@orot/storage';
import { openEncryptedStorage } from '@orot/storage';
import {
  audioSourceRecord,
  createDatabase,
  evidenceSpan,
  join,
  mkdtempSync,
  options,
  rmSync,
  tmpdir,
} from '../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../storage/secureDatabase';
import { createDeletionResume } from './__fixtures__/deletionAwareEvidenceTestSupport';

jest.mock('../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: jest.fn(),
}));

describe('deleted evidence checkpoint revalidation', () => {
  it('connects live references, deletion tombstones, and a reopened database to runtime resume', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-delete-resume-'));
    const databasePath = join(directory, 'database.sqlite');
    let database: SqlDatabase = createDatabase(databasePath);
    try {
      let repository = await openEncryptedStorage(options(database));
      const source = await repository.sourceRecords.create(
        audioSourceRecord('resume-source'),
      );
      const span = await repository.evidenceSpans.create(
        evidenceSpan('resume-evidence', source.id, {
          kind: 'audio_time_range',
          startMs: 250,
          endMs: 1800,
        }),
      );
      jest.mocked(openLocalStorage).mockResolvedValue(repository);
      jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(database);
      const reference: EvidenceReference = {
        sourceKind: 'personal_record',
        sourceId: source.id,
        sourceRevision: source.ingestedAt,
        evidenceId: span.id,
        evidenceRevision: span.ingestedAt,
        locator: { kind: 'structured_record', recordId: span.id },
        effectiveTime: span.effectiveAt,
        reviewState: 'unreviewed',
      };

      const currentRevisionCheck = async (
        references: readonly EvidenceReference[],
      ) =>
        references.every(
          candidate =>
            candidate.sourceRevision === source.ingestedAt &&
            candidate.evidenceRevision === span.ingestedAt,
        );
      const validCheck = jest.fn(currentRevisionCheck);
      const valid = createDeletionResume(reference, validCheck);
      await expect(valid.run()).resolves.toMatchObject({ status: 'result' });
      expect(valid.restoreEvidence).toHaveBeenCalledTimes(1);
      expect(valid.provider.generate).toHaveBeenCalledTimes(1);

      const staleRevisionCheck = jest.fn(currentRevisionCheck);
      const staleRevision = createDeletionResume(
        { ...reference, evidenceRevision: 'superseded-revision' },
        staleRevisionCheck,
      );
      await expect(staleRevision.run()).resolves.toMatchObject({
        status: 'stale_evidence',
      });
      expect(staleRevision.restoreEvidence).not.toHaveBeenCalled();
      expect(staleRevision.provider.generate).not.toHaveBeenCalled();

      const missingLocatorCheck = jest.fn(async () => true);
      const missingLocator = createDeletionResume(
        {
          ...reference,
          locator: {
            kind: 'structured_record',
            recordId: 'missing-locator-record',
          },
        },
        missingLocatorCheck,
      );
      const missingLocatorLookup = jest.spyOn(
        repository,
        'listDeletedSourceReferenceIds',
      );
      await expect(missingLocator.run()).resolves.toMatchObject({
        status: 'stale_evidence',
      });
      expect(missingLocatorLookup).toHaveBeenCalledWith([
        reference.sourceId,
        reference.evidenceId,
        'missing-locator-record',
      ]);
      expect(missingLocatorCheck).not.toHaveBeenCalled();
      expect(missingLocator.restoreEvidence).not.toHaveBeenCalled();
      expect(missingLocator.provider.generate).not.toHaveBeenCalled();

      await repository.sourceRecords.delete(source.id);
      const listDeleted = jest.spyOn(
        repository,
        'listDeletedSourceReferenceIds',
      );
      const tombstones = await repository.listDeletedSourceReferenceIds([
        reference.sourceId,
        reference.evidenceId,
        span.id,
      ]);
      expect(tombstones).toEqual(
        [reference.evidenceId, reference.sourceId].sort(),
      );
      const deletedCheck = jest.fn(async () => true);
      const deleted = createDeletionResume(reference, deletedCheck);
      await expect(deleted.run()).resolves.toMatchObject({
        status: 'stale_evidence',
      });
      expect(listDeleted).toHaveBeenCalledWith([
        reference.sourceId,
        reference.evidenceId,
      ]);
      expect(deletedCheck).not.toHaveBeenCalled();
      expect(deleted.restoreEvidence).not.toHaveBeenCalled();
      expect(deleted.provider.generate).not.toHaveBeenCalled();

      await database.closeAsync?.();
      database = createDatabase(databasePath);
      repository = await openEncryptedStorage(options(database));
      jest.mocked(openLocalStorage).mockResolvedValue(repository);
      jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(database);
      const reopenedListDeleted = jest.spyOn(
        repository,
        'listDeletedSourceReferenceIds',
      );
      const resumedAfterRestart = createDeletionResume(
        reference,
        jest.fn(async () => true),
      );
      await expect(resumedAfterRestart.run()).resolves.toMatchObject({
        status: 'stale_evidence',
      });
      expect(reopenedListDeleted).toHaveBeenCalledWith([
        reference.sourceId,
        reference.evidenceId,
      ]);
      expect(resumedAfterRestart.restoreEvidence).not.toHaveBeenCalled();
      expect(resumedAfterRestart.provider.generate).not.toHaveBeenCalled();
    } finally {
      await database.closeAsync?.();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('accepts a live manual structured record when its ID is not a source row', async () => {
    const database = createDatabase();
    try {
      const repository = await openEncryptedStorage(options(database));
      const manualRecord = {
        id: 'manual-resume-encounter',
        effectiveAt: '2026-10-05T10:00:00.000Z',
        recordedAt: '2026-10-05T10:00:00.000Z',
        ingestedAt: '2026-10-05T10:01:00.000Z',
        provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
        reviewState: { status: 'unreviewed' as const },
        encounterKind: 'outpatient' as const,
        summary: 'Synthetic manual encounter.',
      };
      await repository.put('encounter', manualRecord);
      jest.mocked(openLocalStorage).mockResolvedValue(repository);
      const reference: EvidenceReference = {
        sourceKind: 'personal_record',
        sourceId: manualRecord.id,
        sourceRevision: manualRecord.ingestedAt,
        evidenceId: manualRecord.id,
        evidenceRevision: manualRecord.ingestedAt,
        locator: { kind: 'structured_record', recordId: manualRecord.id },
        effectiveTime: manualRecord.effectiveAt,
        reviewState: 'unreviewed',
      };
      const revalidate = jest.fn(async () => true);
      const resume = createDeletionResume(reference, revalidate);

      await expect(resume.run()).resolves.toMatchObject({ status: 'result' });
      expect(revalidate).toHaveBeenCalledTimes(1);
      expect(resume.restoreEvidence).toHaveBeenCalledTimes(1);
      expect(resume.provider.generate).toHaveBeenCalledTimes(1);
    } finally {
      await database.closeAsync?.();
    }
  });
});
