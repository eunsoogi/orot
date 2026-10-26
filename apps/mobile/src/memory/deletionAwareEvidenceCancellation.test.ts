import type { EvidenceReference } from '@orot/agent-runtime';
import { openEncryptedStorage } from '@orot/storage';
import {
  audioSourceRecord,
  createDatabase,
  evidenceSpan,
  options,
} from '../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { openLocalStorage } from '../storage/secureDatabase';
import { withLocalDeletionAwareRevalidation } from './deletionAwareEvidenceRevalidation';

jest.mock('../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: jest.fn(),
}));

describe('deletion-aware evidence cancellation', () => {
  it('stops protected record reads when cancellation happens during storage open', async () => {
    const database = createDatabase();
    try {
      const repository = await openEncryptedStorage(options(database));
      const source = await repository.sourceRecords.create(
        audioSourceRecord('cancel-during-open-source'),
      );
      const span = await repository.evidenceSpans.create(
        evidenceSpan('cancel-during-open-evidence', source.id, {
          kind: 'audio_time_range',
          startMs: 250,
          endMs: 1800,
        }),
      );
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
      let finishOpen!: (
        value: Awaited<ReturnType<typeof openLocalStorage>>,
      ) => void;
      const opening = new Promise<Awaited<ReturnType<typeof openLocalStorage>>>(
        resolve => {
          finishOpen = resolve;
        },
      );
      jest.mocked(openLocalStorage).mockReturnValue(opening);
      const cancelled = new AbortController();
      const revalidate = jest.fn(async () => true);
      const deletedLookup = jest.spyOn(
        repository,
        'listDeletedSourceReferenceIds',
      );

      // Cancellation while SQLCipher opens must prevent the first evidence lookup after the await.
      const pending = withLocalDeletionAwareRevalidation(revalidate)(
        [reference],
        cancelled.signal,
      );
      cancelled.abort();
      finishOpen(repository);

      await expect(pending).resolves.toBe(false);
      expect(deletedLookup).not.toHaveBeenCalled();
      expect(revalidate).not.toHaveBeenCalled();
    } finally {
      await database.closeAsync?.();
    }
  });
});
