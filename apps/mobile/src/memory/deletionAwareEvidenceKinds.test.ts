import type { EvidenceReference } from '@orot/agent-runtime';
import { openEncryptedStorage } from '@orot/storage';
import { SqlCipherAgentMemoryStorage } from '../storage/agentMemoryStorage';
import {
  createDatabase,
  options,
} from '../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../storage/secureDatabase';
import { withLocalDeletionAwareRevalidation } from './deletionAwareEvidenceRevalidation';

jest.mock('../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: jest.fn(),
}));

const reference: EvidenceReference = {
  sourceKind: 'reviewed_memory',
  sourceId: 'deleted-memory-row',
  sourceRevision: 'memory-revision-1',
  evidenceId: 'deleted-memory-row',
  evidenceRevision: 'memory-revision-1',
  locator: { kind: 'memory_record', recordId: 'deleted-memory-row' },
  effectiveTime: null,
  reviewState: 'reviewed',
};

describe('deletion revalidation by evidence kind', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses memory fences for reviewed memories without querying record tombstones', async () => {
    const database = createDatabase();
    try {
      await openEncryptedStorage(options(database));
      const storage = new SqlCipherAgentMemoryStorage(database);
      await storage.markSourceRemoved(reference.evidenceId);
      jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(database);
      const revalidate = jest.fn(async () => true);

      await expect(
        withLocalDeletionAwareRevalidation(revalidate)(
          [reference],
          new AbortController().signal,
        ),
      ).resolves.toBe(false);
      expect(openLocalStorage).not.toHaveBeenCalled();
      expect(revalidate).not.toHaveBeenCalled();
    } finally {
      await database.closeAsync?.();
    }
  });

  it('does not query local tombstones for external evidence', async () => {
    const externalReference = {
      ...reference,
      sourceKind: 'external_medical' as const,
    };
    const revalidate = jest.fn(async () => true);

    await expect(
      withLocalDeletionAwareRevalidation(revalidate)(
        [externalReference],
        new AbortController().signal,
      ),
    ).resolves.toBe(true);
    expect(openLocalStorage).not.toHaveBeenCalled();
    expect(openLocalAgentMemoryDatabase).not.toHaveBeenCalled();
    expect(revalidate).toHaveBeenCalledTimes(1);
  });
});
