import { fireEvent, screen, within } from '@testing-library/react-native';
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
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { t } from '../../../i18n';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

function firstEvidence(request: LanguageModelRequest) {
  for (const message of request.messages) {
    if (message.role !== 'user' || typeof message.content !== 'string')
      continue;
    try {
      const payload = JSON.parse(message.content) as {
        records?: { evidenceId?: string; content?: string }[];
      };
      const source = payload.records?.find(row =>
        row.content?.startsWith('health_context: '),
      );
      if (source?.evidenceId) return source.evidenceId;
    } catch {
      /* Opening instructions are not evidence. */
    }
  }
}

test('real Health Summary shortcut makes one validated answer and retains the template after reopen', async () => {
  let finalCalls = 0;
  let opening = 0;
  const generate = jest.fn(async (request: LanguageModelRequest) => {
    const source = firstEvidence(request);
    if (source) {
      finalCalls++;
      const response = {
        type: 'result',
        value: { recordSummaries: { [source]: { q0: 'mean' } } },
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
  const provider = { ...apple.provider, generate, stream: undefined };
  const consent = { authorize: jest.fn(async () => 'authorized' as const) };
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
    const selection = { providerId: provider.id, modelId: apple.modelId };
    const dependencies = {
      selectedAi: {
        selectionStore: selectionStore(selection),
        loadAppleOption: async () => ({ ...apple, provider }),
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
      screen.getByTestId('conversation-open-health-summary'),
    );
    const title = t('ragConversation.conversation.healthSummary.title');
    expect(
      within(await screen.findByTestId('health-summary-card')).getByText(title),
    ).toBeVisible();

    expect(finalCalls).toBe(1);
    const period = screen.getByTestId('health-summary-period').props.children;
    expect(typeof period).toBe('string');
    expect(period).toContain(window.fromInclusive);
    const attempts = generate.mock.calls.length;
    expect(await feature.storage().listCompletionIdentities()).toHaveLength(1);
    await feature.reopen();
    expect(
      within(await screen.findByTestId('health-summary-card')).getByText(title),
    ).toBeVisible();

    expect(screen.getByTestId('health-summary-period').props.children).toEqual(
      period,
    );
    expect(generate).toHaveBeenCalledTimes(attempts);
  } finally {
    await feature.close();
  }
});
