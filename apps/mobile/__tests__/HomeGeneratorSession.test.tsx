import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import {
  futureHomeVisit,
  renderHomeGenerator,
} from '../test-helpers/homeGeneratorHarness';
const featureServices =
  require('../src/aiFeatures/integration/featureServices') as typeof import('../src/aiFeatures/integration/featureServices');
import type { AiFeatureServices } from '../src/aiFeatures/integration/featureServices';
import type { RagConversationOutcome } from '../src/ragConversation/service';
import { conversationIntentRequests } from '../src/aiFeatures/integration/conversationIntent';

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
  await fireEvent.press(await screen.findByTestId('home-prepare-visit'));
  expect(await screen.findByTestId('rag-conversation-screen')).toBeTruthy();
  expect(screen.getByTestId('rag-conversation-input')).toHaveDisplayValue(
    conversationIntentRequests['visit-questions'],
  );
}

test('provider and history detours retain Home A while a new Home B request keeps its exact visit identity', async () => {
  const send = captureConversationSends();
  const a = futureHomeVisit('Home A');
  const b = futureHomeVisit('Home B');
  const { store, query, generate } = await renderHomeGenerator([a, b]);
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
  await fireEvent.press(screen.getByTestId('rag-conversation-sessions-toggle'));
  expect(await screen.findByTestId('conversation-history-screen')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  expect(send.mock.calls[0]?.[0]).toBe('A만의 준비 초안');
  expect(send.mock.calls[0]?.[4]).toMatchObject({
    intent: 'visit-questions',
    appointmentId: a.id,
  });
  await store.repository.cancel(a.id);
  query.mockResolvedValue(b);
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(await screen.findByText('Home B')).toBeTruthy();
  await enterHomeConversation();
  expect(screen.queryByText('A만의 준비 초안')).toBeNull();
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    'B만의 준비 요청',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send.mock.calls[1]?.[4]).toMatchObject({
    intent: 'visit-questions',
    appointmentId: b.id,
  });
  expect(send.mock.calls[1]?.[4]?.entryKey).not.toBe(
    send.mock.calls[0]?.[4]?.entryKey,
  );
  expect(generate).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await fireEvent.press(screen.getByTestId('navigation-tab-ai'));
  expect(screen.getByTestId('rag-conversation-screen')).toBeTruthy();
  expect(screen.queryByTestId('ai-features-screen')).toBeNull();
  expect(screen.queryByTestId('next-visit-question-text-0')).toBeNull();
});

test('a late Home A answer stays in its conversation when a separate Home B entry is active', async () => {
  const send = captureConversationSends();
  let finish!: (outcome: RagConversationOutcome) => void;
  send.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const a = futureHomeVisit('Home A');
  const b = futureHomeVisit('Home B');
  const { store, query, generate } = await renderHomeGenerator([a, b]);
  await enterHomeConversation();
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  const signal = send.mock.calls[0]?.[2];
  await store.repository.cancel(a.id);
  query.mockResolvedValue(b);
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(await screen.findByText('Home B')).toBeTruthy();
  await enterHomeConversation();
  // Conversation requests survive route removal, but their result is owned by the original session.
  expect(signal?.aborted).toBe(false);
  await act(async () =>
    finish({
      status: 'answer',
      answer: 'A에게만 속한 늦은 답변',
      citations: [],
    }),
  );
  expect(screen.queryByText('A에게만 속한 늦은 답변')).toBeNull();
  expect(screen.getByTestId('rag-conversation-input')).toHaveDisplayValue(
    conversationIntentRequests['visit-questions'],
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-sessions-toggle'));
  await fireEvent(
    screen.getByTestId('conversation-history-list'),
    'selectSession',
    { nativeEvent: { id: 1 } },
  );
  expect(await screen.findByText('A에게만 속한 늦은 답변')).toBeTruthy();
  // Restoring A from history must not send the currently visible B route's identity.
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    'A에 관해 다시 질문',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send.mock.calls[1]?.[4]).toMatchObject({
    intent: 'visit-questions',
    appointmentId: a.id,
  });
  expect(generate).not.toHaveBeenCalled();
});
