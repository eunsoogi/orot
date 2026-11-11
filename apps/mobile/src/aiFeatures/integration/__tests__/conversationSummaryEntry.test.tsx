import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AiFeatureFlowScreen } from '../AiFeatureFlowScreen';
import { AiFeatureSharedNavigationStateProvider } from '../AiFeatureSharedNavigationState';
import { createAiFeatureServices } from '../featureServices';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

test('an edited summary entry is consumed on its first turn, while follow-up stays conversation', async () => {
  const services = createAiFeatureServices({ authorize: jest.fn() });
  const send = jest.fn<
    ReturnType<typeof services.sendRagMessage>,
    Parameters<typeof services.sendRagMessage>
  >(async () => ({ status: 'no_evidence' }));
  await render(
    <AiFeatureSharedNavigationStateProvider>
      <AiFeatureFlowScreen
        route="health-summary"
        navigationRouteKey="summary-entry"
        onRouteStateChange={jest.fn()}
        onBack={jest.fn()}
        onOpenDiseaseHypotheses={jest.fn()}
        onOpenRagConversation={jest.fn()}
        onOpenExternalEvidence={jest.fn()}
        onOpenProviderSelection={jest.fn()}
        onOpenSource={jest.fn()}
        resolveSelectedAi={async () => ({ status: 'selection-required' })}
        confirmConsent={jest.fn()}
        selectedAiRevision={0}
        services={{ ...services, sendRagMessage: send }}
        onOpenArticle={jest.fn()}
      />
    </AiFeatureSharedNavigationStateProvider>,
  );
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '내가 수정한 지난달 요청',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  expect(send.mock.calls[0]?.[0]).toBe('내가 수정한 지난달 요청');
  expect(send.mock.calls[0]?.[4]).toMatchObject({ intent: 'health-summary' });
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '그 근거를 설명해 줘',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send.mock.calls[1]?.[4]).toMatchObject({ intent: 'conversation' });
});

test('renders a validated summary in the existing conversation', async () => {
  const services = createAiFeatureServices({ authorize: jest.fn() });
  const send: typeof services.sendRagMessage = async () => ({
    status: 'answer',
    answer: '건강 기록을 요약했어요.',
    citations: [],
    healthSummary: {
      reference: {
        summaryId: 'one',
        window: {
          fromInclusive: '2026-10-01T00:00:00Z',
          toExclusive: '2026-10-05T00:00:00Z',
          timeZone: 'UTC',
        },
      },
      analysis: {
        hypotheses: [
          {
            title: '수면',
            summary: '수면 기록이에요.',
            uncertainty: '',
            missingData: [],
            supportingEvidence: [],
            contraryEvidence: [],
          },
        ],
        savedSummary: {
          status: 'saved',
          id: 'one',
          createdAt: '2026-10-05T00:00:00Z',
          modelName: 'Model',
        },
      },
    },
  });
  await render(
    <AiFeatureSharedNavigationStateProvider>
      <AiFeatureFlowScreen
        route="health-summary"
        navigationRouteKey="summary-card"
        onRouteStateChange={jest.fn()}
        onBack={jest.fn()}
        onOpenDiseaseHypotheses={jest.fn()}
        onOpenRagConversation={jest.fn()}
        onOpenExternalEvidence={jest.fn()}
        onOpenProviderSelection={jest.fn()}
        onOpenSource={jest.fn()}
        resolveSelectedAi={async () => ({ status: 'selection-required' })}
        confirmConsent={jest.fn()}
        selectedAiRevision={0}
        services={{ ...services, sendRagMessage: send }}
        onOpenArticle={jest.fn()}
      />
    </AiFeatureSharedNavigationStateProvider>,
  );
  await fireEvent.press(
    screen.getByTestId('conversation-intent-use-suggestion'),
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  expect(await screen.findByTestId('health-summary-card')).toBeTruthy();
  expect(screen.getByText('수면 기록이에요.')).toBeTruthy();
  expect(screen.getByText('저장됨')).toBeTruthy();
});

test.each([
  'provider_configuration',
  'consent_required',
  'retrieval_failed',
] as const)(
  'retains summary intent after %s and consumes it after success',
  async kind => {
    const services = createAiFeatureServices({ authorize: jest.fn() });
    const send = jest
      .fn<
        ReturnType<typeof services.sendRagMessage>,
        Parameters<typeof services.sendRagMessage>
      >()
      .mockResolvedValueOnce({ status: 'failure', kind })
      .mockResolvedValue({ status: 'no_evidence' });
    await render(
      <AiFeatureSharedNavigationStateProvider>
        <AiFeatureFlowScreen
          route="health-summary"
          navigationRouteKey="summary-retry"
          onRouteStateChange={jest.fn()}
          onBack={jest.fn()}
          onOpenDiseaseHypotheses={jest.fn()}
          onOpenRagConversation={jest.fn()}
          onOpenExternalEvidence={jest.fn()}
          onOpenProviderSelection={jest.fn()}
          onOpenSource={jest.fn()}
          resolveSelectedAi={async () => ({ status: 'selection-required' })}
          confirmConsent={jest.fn()}
          selectedAiRevision={0}
          services={{ ...services, sendRagMessage: send }}
          onOpenArticle={jest.fn()}
        />
      </AiFeatureSharedNavigationStateProvider>,
    );
    await fireEvent.press(
      screen.getByTestId('conversation-intent-use-suggestion'),
    );
    await fireEvent.press(screen.getByTestId('rag-conversation-send'));
    await waitFor(() =>
      expect(
        screen.getByTestId('rag-conversation-input').props.value,
      ).toBeTruthy(),
    );
    await fireEvent.press(screen.getByTestId('rag-conversation-send'));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]?.[4]).toMatchObject({ intent: 'health-summary' });
    await waitFor(() =>
      expect(screen.getByTestId('rag-conversation-input').props.value).toBe(''),
    );
    await fireEvent.changeText(
      screen.getByTestId('rag-conversation-input'),
      '후속 질문',
    );
    await fireEvent.press(screen.getByTestId('rag-conversation-send'));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    expect(send.mock.calls[2]?.[4]).toMatchObject({ intent: 'conversation' });
  },
);
