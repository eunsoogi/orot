import type { EvidenceReference } from '@orot/agent-runtime';
import type { SqlDatabase } from '@orot/storage';
import { openEncryptedStorage } from '@orot/storage';
import {
  createDatabase,
  join,
  mkdtempSync,
  options,
  rmSync,
  tmpdir,
} from '../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { sample, storedSample } from '../healthkit/sleep/sleepImporterFixtures';
import { openLocalStorage } from '../storage/secureDatabase';
import { withLocalDeletionAwareRevalidation } from './deletionAwareEvidenceRevalidation';

jest.mock('../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: jest.fn(),
}));

describe('HealthKit evidence revalidation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('accepts a live structured record by its stored row ID and rejects it after deletion', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-healthkit-revalidate-'));
    const databasePath = join(directory, 'local.sqlite');
    let database: SqlDatabase = createDatabase(databasePath);

    try {
      let repository = await openEncryptedStorage(options(database));
      const record = storedSample(sample('review-live-healthkit-sample'));
      await repository.put('health_observation', record);
      const reference: EvidenceReference = {
        sourceKind: 'personal_record',
        sourceId: 'review-live-healthkit-sample',
        sourceRevision: record.ingestedAt,
        evidenceId: record.id,
        evidenceRevision: record.ingestedAt,
        locator: { kind: 'structured_record', recordId: record.id },
        effectiveTime: record.effectiveAt,
        reviewState: 'unreviewed',
      };
      jest.mocked(openLocalStorage).mockResolvedValue(repository);
      const revalidate = jest.fn(async () => true);
      const guardedRevalidate = withLocalDeletionAwareRevalidation(revalidate);

      await expect(
        guardedRevalidate([reference], new AbortController().signal),
      ).resolves.toBe(true);
      expect(revalidate).toHaveBeenCalledTimes(1);

      await repository.deleteAllLocalData();
      await database.closeAsync?.();
      database = createDatabase(databasePath);
      repository = await openEncryptedStorage(options(database));
      jest.mocked(openLocalStorage).mockResolvedValue(repository);

      await expect(
        guardedRevalidate([reference], new AbortController().signal),
      ).resolves.toBe(false);
      expect(revalidate).toHaveBeenCalledTimes(1);
    } finally {
      await database.closeAsync?.();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
