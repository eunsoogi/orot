import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, AppState } from 'react-native';

beforeEach(() => {
  AppState.currentState = 'active';
});
import {
  futureOverviewVisit,
  renderOverviewGenerator,
} from '../test-helpers/overviewGeneratorHarness';
const featureServices =
  require('../src/aiFeatures/integration/featureServices') as typeof import('../src/aiFeatures/integration/featureServices');
import type { AiFeatureServices } from '../src/aiFeatures/integration/featureServices';
import type { RagConversationOutcome } from '../src/ragConversation/service';

afterEach(() => jest.restoreAllMocks());

/** Only the sender's result is synthetic; Home targets and the conversation owner remain real. */
function captureConversationSends() {
  const send = jest.fn<
    ReturnType<AiFeatureServices['sendRagMessage']>,
    Parameters<AiFeatureServices['sendRagMessage']>
  >(async () => ({ status: 'no_evidence' }));
  const create = featureServices.createAiFeatureServices;
  jest
    .spyOn(featureServices, 'createAiFeatureServices')
    .mockImplementation((...args) => ({
      ...create(...args),
      sendRagMessage: send,
      // The visit entry now uses its own operation while retaining the same session contract.
      prepareVisitQuestionTurn: ({ question, context, signal, observer }) =>
        send(question, [], signal, observer, context),
      // These route/session assertions do not claim encrypted database persistence.
      conversationSessionOptions: () => ({}),
    }));
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  return send;
}

async function enterHomeConversation() {
  await fireEvent.press(await screen.findByTestId('overview-prepare-visit'));
  expect(await screen.findByTestId('visit-day-questions')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await fireEvent.press(screen.getByTestId('navigation-tab-conversation'));
  expect(await screen.findByTestId('rag-conversation-screen')).toBeTruthy();
  expect(screen.queryByTestId('conversation-visit-prepare')).toBeNull();
  expect(screen.getByTestId('navigation-tab-conversation')).toHaveProp(
    'accessibilityState',
    expect.objectContaining({ selected: true }),
  );
}

test('provider and provider selection detours preserve the existing conversation after Overview appointment changes', async () => {
  const send = captureConversationSends();
  const a = futureOverviewVisit('Home A');
  const b = futureOverviewVisit('Home B');
  const { store, query, generate } = await renderOverviewGenerator([a, b]);
  await enterHomeConversation();
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    'A만의 준비 초안',
  );
  await fireEvent.press(screen.getByTestId('ai-feature-select-provider'));
  expect(await screen.findByTestId('provider-selection-screen')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(screen.getByTestId('rag-conversation-input')).toHaveDisplayValue(
    'A만의 준비 초안',
  );
  await fireEvent.press(screen.getByTestId('ai-feature-select-provider'));
  expect(await screen.findByTestId('provider-selection-screen')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  expect(send.mock.calls[0]?.[0]).toBe('A만의 준비 초안');
  expect(send.mock.calls[0]?.[4]?.appointmentId).toBeUndefined();
  await store.repository.cancel(a.id);
  query.mockResolvedValue(b);
  await fireEvent.press(screen.getByTestId('navigation-tab-overview'));
  expect(await screen.findByText('Home B')).toBeTruthy();
  await enterHomeConversation();
  expect(screen.getByText('A만의 준비 초안')).toBeTruthy();
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    'B만의 준비 요청',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send.mock.calls[1]?.[4]?.appointmentId).toBeUndefined();
  expect(generate).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('navigation-tab-overview'));
  await fireEvent.press(screen.getByTestId('navigation-tab-conversation'));
  expect(screen.getByTestId('rag-conversation-screen')).toBeTruthy();
  expect(screen.queryByTestId('ai-features-screen')).toBeNull();
  expect(screen.queryByTestId('next-visit-question-text-0')).toBeNull();
});

test('an in-flight reply remains in the same conversation after Overview reentry', async () => {
  const send = captureConversationSends();
  let finish!: (outcome: RagConversationOutcome) => void;
  send.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const a = futureOverviewVisit('Home A');
  const b = futureOverviewVisit('Home B');
  const { store, query, generate } = await renderOverviewGenerator([a, b]);
  await enterHomeConversation();
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    'A의 진료 질문 준비 요청',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  const signal = send.mock.calls[0]?.[2];
  await store.repository.cancel(a.id);
  query.mockResolvedValue(b);
  await fireEvent.press(screen.getByTestId('navigation-tab-overview'));
  expect(await screen.findByText('Home B')).toBeTruthy();
  await enterHomeConversation();
  // Tab changes retain the same request owner and must not cancel or replace it.
  expect(signal?.aborted).toBe(false);
  await act(async () =>
    finish({
      status: 'answer',
      answer: 'A에게만 속한 늦은 답변',
      citations: [],
    }),
  );
  expect(screen.getByText('A에게만 속한 늦은 답변')).toBeTruthy();
  expect(screen.getByTestId('rag-conversation-input')).toHaveDisplayValue('');
  await fireEvent.press(screen.getByTestId('ai-feature-select-provider'));
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(await screen.findByText('A에게만 속한 늦은 답변')).toBeTruthy();
  // Provider selection return must not attach the Overview appointment to an ordinary conversation.
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    'A에 관해 다시 질문',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send.mock.calls[1]?.[4]?.appointmentId).toBeUndefined();
  expect(generate).not.toHaveBeenCalled();
});
