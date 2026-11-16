import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AiFeatureFlow } from '../AiFeatureFlow';
import { AiFeatureSharedNavigationStateProvider } from '../AiFeatureSharedNavigationState';
import { createAiFeatureServices } from '../featureServices';
import { createConversationDailyReport } from '../conversationDailyReport';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import type { RagConversationOutcome } from '../../../ragConversation/outcome';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../providers/selection/options', () => {
  const actual = jest.requireActual('../../../providers/selection/options');
  return {
    ...actual,
    loadAppleSelectionOption: jest.fn(async () =>
      actual.createAppleSelectionOption('available'),
    ),
  };
});

test('report choice preserves a blocked draft and starts one chat turn after it is cleared', async () => {
  const push = jest.fn();
  const consent = { authorize: jest.fn(async () => 'authorized' as const) };
  let finish!: (result: RagConversationOutcome) => void;
  const send = jest.fn(
    () =>
      new Promise<RagConversationOutcome>(resolve => {
        finish = resolve;
      }),
  );
  const services = createAiFeatureServices(consent);
  await render(
    <AiFeatureSharedNavigationStateProvider>
      <AiFeatureFlow
        consent={consent}
        services={{ ...services, sendRagMessage: send }}
        isEntryCurrent={() => true}
        onOpenArticle={jest.fn()}
        navigation={{
          route: { name: 'rag-conversation', key: 'root' },
          push,
          replace: jest.fn(),
          onBack: jest.fn(),
          onHome: jest.fn(),
          registerLeaveState: () => () => {},
        }}
      />
    </AiFeatureSharedNavigationStateProvider>,
  );
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    'keep my synthetic draft',
  );
  // Report choices follow the same draft ownership guard as the other quick actions.
  expect(screen.getByTestId('daily-report-request')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('daily-report-request'));
  expect(screen.queryByTestId('inline-daily-report-task')).toBeNull();
  expect(screen.getByTestId('rag-conversation-input')).toHaveProp(
    'value',
    'keep my synthetic draft',
  );
  await fireEvent.changeText(screen.getByTestId('rag-conversation-input'), '');
  await fireEvent.press(screen.getByTestId('daily-report-request'));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  expect(screen.getAllByTestId('conversation-user-message')).toHaveLength(1);
  expect(screen.queryByTestId('inline-daily-report-task')).toBeNull();
  expect(screen.getByTestId('rag-conversation-input')).toHaveProp('value', '');
  expect(screen.queryByTestId('daily-report-screen')).toBeNull();
  expect(screen.getByTestId('rag-conversation-cancel')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('daily-report-request'));
  expect(send).toHaveBeenCalledTimes(1);
  await act(() =>
    finish({
      status: 'answer',
      answer: 'Synthetic report in chat',
      citations: [],
    }),
  );
  expect(await screen.findByText('Synthetic report in chat')).toBeTruthy();
  expect(screen.getAllByTestId('conversation-assistant-message')).toHaveLength(
    1,
  );
  expect(push).not.toHaveBeenCalled();
  expect(consent.authorize).not.toHaveBeenCalled();
  expect(screen.getByTestId('rag-conversation-input')).toHaveProp('value', '');
});

test('a single report-choice tap starts the consent-aware report adapter without a second generate tap', async () => {
  const consent = {
    authorize: jest.fn(async () => 'renewal_required' as const),
  };
  const start = jest.fn(() => ({
    status: 'started' as const,
    cancel: jest.fn(),
    result: Promise.resolve({
      status: 'failed' as const,
      code: 'consent_required' as const,
    }),
  }));
  const services = createAiFeatureServices(consent);
  const feature = {
    lookup: jest.fn(async () => ({ status: 'missing' })),
    preview: jest.fn(async () => ({ status: 'not_today' })),
    start,
    active: jest.fn(() => null),
    retain: jest.fn(() => () => {}),
  } as unknown as NonNullable<typeof services.dailyReport>;
  const run = createConversationDailyReport({
    feature,
    sources: jest.fn(),
    registry: new LocalEvidenceReferenceRegistry(),
  });
  const send: typeof services.sendRagMessage = (
    question,
    _history,
    signal,
    observer,
    context,
  ) => {
    if (context?.intent !== 'daily-report' || !context.reportRequest)
      throw new Error('Missing report intent');
    return run(
      question,
      context.reportRequest,
      signal ?? new AbortController().signal,
      observer,
    );
  };
  await render(
    <AiFeatureSharedNavigationStateProvider>
      <AiFeatureFlow
        consent={consent}
        services={{ ...services, dailyReport: feature, sendRagMessage: send }}
        isEntryCurrent={() => true}
        onOpenArticle={jest.fn()}
        navigation={{
          route: { name: 'rag-conversation', key: 'root' },
          push: jest.fn(),
          replace: jest.fn(),
          onBack: jest.fn(),
          onHome: jest.fn(),
          registerLeaveState: () => () => {},
        }}
      />
    </AiFeatureSharedNavigationStateProvider>,
  );
  expect(start).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('daily-report-request'));
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  expect(start).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('inline-daily-report-task')).toBeNull();
  expect(screen.queryByTestId('daily-report-screen')).toBeNull();
  expect(start).toHaveBeenCalledWith(
    expect.any(Object),
    { kind: 'reuse_or_generate' },
    expect.objectContaining({ onTaskStreamEvent: expect.any(Function) }),
  );
  expect(await screen.findByTestId('rag-conversation-error')).toBeTruthy();
  expect(screen.getAllByTestId('conversation-user-message')).toHaveLength(1);
});
