import { AppleFoundationModelsProvider } from '@orot/provider-apple';
import { serializeAppleRequest } from '../../../providers/apple/serializeRequest';
import { getRagConversationFailureCopy } from '../../../ragConversation/copy';
import { APPLE_PCC_MODEL_ID } from '../../../providers/selection/privateCloudCompute';
import { fireEvent, screen } from '@testing-library/react-native';
import {
  providerSuccess,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import { createRecordRepository } from '@orot/storage';
import { createMountedShortcutRoundTrip } from '../testSupport/mountedShortcutRoundTrip';
import { createAiFeatureServices } from '../featureServices';
import { apple, localData, selectionStore } from '../featureServiceFixtures';
import { reportObservation } from '../testSupport/dailyReportFailureStageFixtures';
import { window } from '../testSupport/healthContextPersistenceFixture';
import { createHealthContextReader } from '../../../healthEvidence/healthContext/reader';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import { answer } from '../../../ragConversation/testSupport/structuredPossibilityReportFixture';
import { possibilityReportTemplate } from '../../../ragConversation/conversationReportTemplate';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

function firstEvidence(request: LanguageModelRequest) {
  for (const message of request.messages) {
    if (message.role !== 'user' || typeof message.content !== 'string')
      continue;
    if (!message.content.startsWith('Allowed citation references (')) continue;
    const ids: string[] = JSON.parse(message.content.split('\n').at(-1)!);
    if (ids.length === 1) return ids[0];
  }
}

test.each(['local', 'pcc-denied'] as const)(
  'real Possibilities shortcut uses exact chosen Apple route: %s',
  async scenario => {
    let finalCalls = 0;
    let opening = 0;
    const generate = jest.fn(async (request: LanguageModelRequest) => {
      const source = firstEvidence(request);
      if (source) {
        finalCalls++;
        const response = {
          type: 'result',
          value: { answerKind: 'grounded', answer },
          citations: [source],
        };
        return providerSuccess({
          text: JSON.stringify(response),
          structuredOutput: response,
          toolCalls: [],
          finishReason: 'complete' as const,
        });
      }
      if (request.tools?.some(tool => tool.name === 'local-health-context'))
        return providerSuccess({
          text: '',
          toolCalls: [
            {
              id: 'health-context-call',
              name: 'local-health-context',
              arguments: { window, topics: ['measurements'] },
            },
          ],
          finishReason: 'tool_calls' as const,
        });
      return providerSuccess({
        text: opening++ % 2 ? 'ALLOW' : '기록을 확인할게요.',
        toolCalls: [],
        finishReason: 'complete' as const,
      });
    });
    const pcc = scenario === 'pcc-denied';
    const validRequests: ReturnType<typeof serializeAppleRequest>[] = [];
    const complete = async (request: LanguageModelRequest) => {
      validRequests.push(serializeAppleRequest(request));
      const result = await generate(request);
      if (!result.ok) throw new Error('Synthetic adapter failure');
      return result.value;
    };
    const provider = new AppleFoundationModelsProvider(
      {
        getAvailability: async () => ({ status: 'available' }),
        generate: complete,
        async *stream(request) {
          yield { type: 'completed', response: await complete(request) };
        },
        cancel: jest.fn(),
      },
      pcc ? 'private-cloud-compute' : 'on-device',
    );
    const consent = {
      authorize: jest.fn(async () => 'renewal_required' as const),
    };
    const feature = await createMountedShortcutRoundTrip(async database => {
      const repository = createRecordRepository(database);
      const at = '2026-10-02T10:00:00Z';
      if (!(await repository.get('health_observation', reportObservation.id)))
        await repository.put('health_observation', {
          ...reportObservation,
          effectiveAt: at,
          recordedAt: at,
          ingestedAt: at,
        });
      const selection = {
        providerId: provider.id,
        modelId: pcc ? APPLE_PCC_MODEL_ID : apple.modelId,
      };
      const dependencies = {
        selectedAi: {
          selectionStore: selectionStore(selection),
          loadAppleOption: async () => ({ ...apple, provider }),
          loadPccOption: async () => ({
            ...apple,
            provider,
            modelId: APPLE_PCC_MODEL_ID,
            privacyBoundary: 'selected-context-remote' as const,
          }),
        },
        loadLocalData: async () => ({
          ...localData([]).data,
          readHealthContext: createHealthContextReader(database),
          openConversationArtifactStorage: async () =>
            createConversationArtifactStorage(database),
        }),
        summaryStorage: async () => createSymptomSummaryStorage(database),
        externalQueryConsent: { authorize: async () => 'denied' as const },
      };
      return {
        services: createAiFeatureServices(consent, dependencies),
        dependencies,
        consent,
      };
    });
    try {
      await feature.mount();
      await fireEvent.press(
        screen.getByTestId('conversation-open-possibilities'),
      );
      if (pcc) {
        expect(
          await screen.findByText(
            getRagConversationFailureCopy('consent_required'),
          ),
        ).toBeVisible();
        expect(consent.authorize).toHaveBeenCalled();
        expect(validRequests).toEqual([]);
        expect(await feature.storage().listCompletionIdentities()).toEqual([]);
        return;
      }
      const title = possibilityReportTemplate().title;
      expect(await screen.findByText(title)).toBeVisible();
      for (const body of Object.values(answer))
        expect(screen.getByText(body, { exact: false })).toBeVisible();
      expect(finalCalls).toBe(1);
      expect(
        validRequests.some(r => r.toolNames.includes('local-health-context')),
      ).toBe(true);
      expect(consent.authorize).not.toHaveBeenCalled();
      const attempts = generate.mock.calls.length;
      expect(await feature.storage().listCompletionIdentities()).toHaveLength(
        1,
      );
      await feature.reopen();
      expect(await screen.findByText(title)).toBeVisible();
      for (const body of Object.values(answer))
        expect(screen.getByText(body, { exact: false })).toBeVisible();
      expect(generate).toHaveBeenCalledTimes(attempts);
    } finally {
      await feature.close();
    }
  },
);
