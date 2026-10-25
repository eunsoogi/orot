import type {
  EvidenceReference,
  MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import { openLocalStorage } from '../storage/secureDatabase';
import { createPersistentDeletionWorkflow } from './__fixtures__/deletionAwareEvidenceTestSupport';
import {
  evidenceFor,
  providerFor,
} from './__fixtures__/persistentGraphResumeTestSupport';

jest.mock('../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: jest.fn(),
}));

jest.mock('../rag/localE5RagService', () => ({
  createLocalE5RagService: jest.fn(),
}));

const reference: EvidenceReference = {
  sourceKind: 'personal_record',
  sourceId: 'pre-aborted-record',
  sourceRevision: 'record-revision',
  evidenceId: 'pre-aborted-evidence',
  evidenceRevision: 'evidence-revision',
  locator: { kind: 'structured_record', recordId: 'pre-aborted-evidence' },
  effectiveTime: '2026-10-01T08:00:00+09:00',
  reviewState: 'reviewed',
};

describe('deletion-aware pre-aborted checkpoint lookup', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not read the persisted graph after the caller has cancelled', async () => {
    const getTuple = jest.fn(async () => undefined);
    const saver = {
      getTuple,
    } as unknown as NonNullable<MultiAgentWorkflowOptions['checkpointer']>;
    const provider = providerFor([]);
    const revalidate = jest.fn(async () => true);
    const restore = jest.fn(async () => evidenceFor(reference));
    const options = createPersistentDeletionWorkflow(
      reference,
      provider.provider,
      saver,
      revalidate,
      restore,
      'pre-aborted-checkpoint-run',
    );
    const controller = new AbortController();
    controller.abort();

    // A cancelled request must not open persisted workflow or protected evidence state.
    const result = await runMultiAgentWorkflow(options, {
      config: {
        configurable: { thread_id: 'pre-aborted-checkpoint-run' },
      },
      signal: controller.signal,
    });

    expect(result.status).toBe('cancelled');
    expect(getTuple).not.toHaveBeenCalled();
    expect(openLocalStorage).not.toHaveBeenCalled();
    expect(revalidate).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
  });
});
