import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { apple, localData } from '../featureServiceFixtures';
import { createRagConversationService } from '../ragConversationService';

test.each(['openai', 'apple-pcc'] as const)(
  'a formerly local-only turn rejects a late remote selection (%s)',
  async mode => {
    const provider =
      mode === 'apple-pcc' ? apple.provider : { ...apple.provider, id: mode };
    const run = jest.fn();
    const authorize = jest.fn();
    const send = createRagConversationService({
      selectedAi: async () => ({
        status: 'ready',
        selection: { providerId: provider.id, modelId: apple.modelId },
        option: apple,
        provider,
        modelId: apple.modelId,
        recipient: 'Synthetic remote provider',
        remoteProcessing: true,
      }),
      consent: { authorize },
      queryConsent: { authorize },
      registry: new LocalEvidenceReferenceRegistry(),
      loadLocalData: async () => localData([]).data,
      ragRunner: run,
    });
    expect(
      await send('그 답을 따로 기억해줘.', [], undefined, {
        protectedLocalInput: true,
        suppressContextualOpening: true,
      }),
    ).toMatchObject({ status: 'failure' });
    expect(authorize).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  },
);
