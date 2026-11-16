import { fireEvent, render, screen } from '@testing-library/react-native';
import { AiFeatureRoute } from '../AiFeatureRoute';
import { AiFeatureFlowScreen } from '../AiFeatureFlowScreen';
import { conversationIntentRequests } from '../conversationIntent';
import { AiFeatureSharedNavigationStateProvider } from '../AiFeatureSharedNavigationState';
import { createAiFeatureServices } from '../featureServices';
import type { AiFeatureServices } from '../featureServices';
import { AppointmentReminderProvider } from '../../../appointmentReminders/AppointmentReminderContext';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

test('a report entry presents the task in conversation without starting inference', async () => {
  const start = jest.fn();
  const services = createAiFeatureServices({ authorize: jest.fn() });
  const dailyReport = {
    lookup: jest.fn(async () => ({ status: 'missing' as const })),
    preview: jest.fn(async () => ({ status: 'not_today' as const })),
    start,
    active: jest.fn(() => null),
    retain: jest.fn(() => () => {}),
  } as unknown as NonNullable<AiFeatureServices['dailyReport']>;
  await render(
    <AiFeatureSharedNavigationStateProvider>
      <AiFeatureFlowScreen
        route="daily-report"
        navigationRouteKey="report-entry"
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
        services={{ ...services, dailyReport }}
        onOpenArticle={jest.fn()}
      />
    </AiFeatureSharedNavigationStateProvider>,
  );
  expect(screen.getByTestId('rag-conversation-screen')).toBeTruthy();
  expect(screen.getByTestId('inline-daily-report-task')).toBeTruthy();
  expect(screen.queryByTestId('daily-report-screen')).toBeNull();
  expect(screen.getByTestId('rag-conversation-input')).toHaveProp('value', '');
  expect(start).not.toHaveBeenCalled();
});

/** Entry selects a task without filling the draft or invoking its sender. */
test.each([
  ['entry', 'conversation'],
  ['rag-conversation', 'conversation'],
  ['health-summary', 'health-summary'],
  ['disease-hypotheses', 'possibilities'],
  ['visit-questions', 'visit-questions'],
  ['external-evidence', 'medical-literature'],
] as const)(
  'opens %s in conversation with %s intent',
  async (route, intent) => {
    const services = createAiFeatureServices({ authorize: jest.fn() });
    const send = jest.fn(async () => ({ status: 'no_evidence' as const }));
    const prepareVisitQuestionTurn = jest.fn(async () => ({
      status: 'no_evidence' as const,
    }));
    const reminderRuntime = {
      overviewPreparationTargets:
        route === 'visit-questions'
          ? new Map([['intent-entry', 'appointment-home']])
          : new Map(),
      dailyReportFollowUps: new Map(),
    } as never;
    await render(
      <AppointmentReminderProvider runtime={reminderRuntime}>
        <AiFeatureSharedNavigationStateProvider>
          <AiFeatureFlowScreen
            route={route}
            navigationRouteKey="intent-entry"
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
            services={{
              ...services,
              sendRagMessage: send,
              prepareVisitQuestionTurn,
            }}
            onOpenArticle={jest.fn()}
          />
        </AiFeatureSharedNavigationStateProvider>
      </AppointmentReminderProvider>,
    );
    expect(screen.getByTestId('rag-conversation-screen')).toBeTruthy();
    expect(screen.queryByTestId('ai-features-screen')).toBeNull();
    expect(screen.queryByTestId('external-evidence-search')).toBeNull();
    expect(screen.getByTestId('rag-conversation-input')).toHaveProp(
      'value',
      '',
    );
    expect(send).not.toHaveBeenCalled();
    if (intent === 'visit-questions') {
      expect(screen.getByTestId('conversation-visit-prepare')).toBeTruthy();
      expect(screen.getByTestId('rag-conversation-input')).toHaveProp(
        'value',
        '',
      );
      await fireEvent.press(screen.getByTestId('conversation-visit-prepare'));
      expect(screen.getByTestId('rag-conversation-input')).toHaveProp(
        'value',
        '',
      );
      expect(prepareVisitQuestionTurn).toHaveBeenCalledTimes(1);
      expect(prepareVisitQuestionTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          question: conversationIntentRequests[intent],
          context: {
            intent,
            entryKey: 'intent-entry',
            appointmentId: 'appointment-home',
          },
        }),
      );
      expect(send).not.toHaveBeenCalled();
    }
    expect(
      screen.queryByTestId('conversation-intent-use-suggestion'),
    ).toBeNull();
    await fireEvent.changeText(
      screen.getByTestId('rag-conversation-input'),
      '수정한 요청',
    );
    await fireEvent.press(screen.getByTestId('rag-conversation-send'));
    if (intent === 'visit-questions') {
      expect(send).toHaveBeenCalledWith(
        '수정한 요청',
        expect.any(Array),
        expect.any(AbortSignal),
        expect.any(Object),
        {
          intent,
          entryKey: 'intent-entry',
          appointmentId: 'appointment-home',
        },
      );
      expect(prepareVisitQuestionTurn).toHaveBeenCalledTimes(1);
    } else
      expect(send).toHaveBeenCalledWith(
        '수정한 요청',
        [],
        expect.any(AbortSignal),
        expect.any(Object),
        { intent, entryKey: 'intent-entry', appointmentId: undefined },
      );
  },
);

test('retains one draft through provider navigation without manual session controls', async () => {
  const onBack = jest.fn();
  await render(
    <AiFeatureRoute onBack={onBack} initialRoute="external-evidence" />,
  );
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '보존할 초안',
  );
  await fireEvent.press(screen.getByTestId('ai-feature-select-provider'));
  expect(screen.getByTestId('provider-selection-screen')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(screen.getByTestId('rag-conversation-input')).toHaveProp(
    'value',
    '보존할 초안',
  );
  expect(screen.queryByTestId('rag-conversation-new-session')).toBeNull();
  expect(screen.queryByTestId('rag-conversation-sessions-toggle')).toBeNull();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(screen.queryByTestId('rag-conversation-screen')).toBeNull();
  // Native closing-transition delivery is covered separately by AiFeatureRouteExit.
});

test('retains the selected entry intent without a manual new-conversation action', async () => {
  const services = createAiFeatureServices({ authorize: jest.fn() });
  const send = jest.fn(async () => ({ status: 'no_evidence' as const }));
  await render(
    <AiFeatureSharedNavigationStateProvider>
      <AiFeatureFlowScreen
        route="visit-questions"
        navigationRouteKey="visit-entry"
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
  expect(screen.queryByTestId('rag-conversation-new-session')).toBeNull();
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '새 질문',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  expect(send).toHaveBeenCalledWith(
    '새 질문',
    [],
    expect.any(AbortSignal),
    expect.any(Object),
    {
      intent: 'visit-questions',
      entryKey: 'visit-entry',
      appointmentId: undefined,
    },
  );
});
