import { createRagConversationService } from '../ragConversationService';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import type { runRagConversationTurn } from '../../../ragConversation/service';

jest.mock('../prepareConversationHistory', () => ({
  prepareConversationHistory: jest.fn(),
}));
import { prepareConversationHistory } from '../prepareConversationHistory';

// Fail the same local boundary that maps to retrieval_failed, while an opening is pending.
test('a local history failure cannot flash then abort a user authorization prompt', async () => {
  const f = publicEvidenceFixture();
  const failed = new Error('synthetic local history unavailable');
  jest.mocked(prepareConversationHistory).mockImplementation(async () => {
    await Promise.resolve();
    await Promise.resolve();
    throw failed;
  });
  const authorize = jest.fn(f.authorize);
  const runner = jest.fn();
  const send = createRagConversationService({
    selectedAi: async () => f.selected,
    consent: { authorize },
    queryConsent: { authorize: async () => 'authorized' },
    externalEvidence: { search: jest.fn() },
    loadLocalData: async () => localData([]).data,
    registry: new LocalEvidenceReferenceRegistry(),
    ragRunner: runner as unknown as typeof runRagConversationTurn,
  });
  expect(
    await send('혈압 기록을 알려줘', [], undefined, {
      onTaskStreamEvent: jest.fn(),
    }),
  ).toEqual({ status: 'failure', kind: 'retrieval_failed' });
  expect(authorize).not.toHaveBeenCalled();
  expect(f.search).not.toHaveBeenCalled();
  expect(runner).not.toHaveBeenCalled();
});
