import type { ConversationExecutionAdapter } from '../../ragConversation/conversationExecutionLease';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { resolveSelectedAiProvider } from '../../aiFeatures/integration/provider';
import { syntheticEncounterModel } from '../../agent/encounter/syntheticFixture';
import { sqliteReviewFixture, sourceId } from '../__fixtures__/sqliteReview';
import { createEncounterReviewService } from '../service';

jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

const fixture = sqliteReviewFixture();

test('production local review can restart when native protection returns', async () => {
  const synthetic = syntheticEncounterModel(sourceId, true);
  const { provider } = synthetic.model;
  jest.mocked(resolveSelectedAiProvider).mockResolvedValue({
    status: 'ready',
    selection: { providerId: provider.id, modelId: 'synthetic' },
    option: {
      provider,
      modelId: 'synthetic',
      displayName: 'Synthetic',
      availability: { status: 'available' },
      privacyBoundary: 'on-device',
    },
    provider,
    modelId: 'synthetic',
    recipient: 'synthetic-local-model',
    remoteProcessing: false,
    onDeviceSelectionWitness: {
      isCurrent: () => true,
      subscribe: () => () => {},
    },
  });
  const protectedDataAvailable = jest
    .fn(async () => true)
    .mockResolvedValueOnce(false);
  const cleanup = jest.fn();
  const bridge: ConversationExecutionAdapter = {
    bridgeAvailable: true,
    currentPhase: () => 'active',
    begin: async () => true,
    end: () => {},
    isActive: async () => true,
    protectedDataAvailable,
    subscribe: () => cleanup,
  };
  jest.mocked(conversationExecutionNative).mockReturnValue(bridge);
  const service = createEncounterReviewService();
  const consent = { authorize: jest.fn(async () => 'authorized' as const) };
  const start = () =>
    service.start(sourceId, consent, new AbortController().signal);
  expect(await start()).toEqual({ status: 'unavailable' });
  expect(synthetic.calls()).toBe(0);
  expect(await service.restore(sourceId, new AbortController().signal)).toEqual(
    { status: 'idle' },
  );
  expect((await start()).status).toBe('pending');
  expect(synthetic.calls()).toBe(1);
  expect(consent.authorize).not.toHaveBeenCalled();
  expect(cleanup).toHaveBeenCalledTimes(2);
  expect(await fixture.rows()).toHaveLength(0);
});
