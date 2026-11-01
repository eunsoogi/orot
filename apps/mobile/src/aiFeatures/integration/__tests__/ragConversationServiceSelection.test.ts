import { AiProviderSelectionError } from '../provider';
import { createRagConversationService } from '../ragConversationService';
import { runRagConversationTurn } from '../../../ragConversation/service';

test.each([
  ['selection-required', 'provider_configuration'],
  ['unavailable', 'provider_unavailable'],
] as const)(
  'keeps selected-provider status %s actionable without reading local records',
  async (status, kind) => {
    const loadLocalData = jest.fn(async () => {
      throw new Error('Private storage detail.');
    });
    const ragRunner = jest.fn() as unknown as typeof runRagConversationTurn;
    const service = createRagConversationService({
      consent: {} as never,
      queryConsent: {} as never,
      externalEvidence: {} as never,
      loadLocalData,
      selectedAi: async () => {
        throw new AiProviderSelectionError(status);
      },
      registry: {} as never,
      ragRunner,
    });

    const outcome = await service('혈압 기록을 알려 주세요.', []);

    expect(outcome).toEqual({ status: 'failure', kind });
    expect(loadLocalData).not.toHaveBeenCalled();
    expect(ragRunner).not.toHaveBeenCalled();
  },
);
