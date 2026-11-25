import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import {
  AppleFoundationModelsProvider,
  type AppleFoundationModelsNativeBridge,
} from '@orot/provider-apple';
import { ConversationScreen } from '../../../ragConversation/ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../../../ragConversation/ConversationSessionsContext';
import { conversationChoiceActions } from '../../../ragConversation/selectConversationChoice';
import type { runRagConversationTurn } from '../../../ragConversation/service';
import { createRagConversationService } from '../ragConversationService';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { apple, localData } from '../featureServiceFixtures';
import { installReceiptFixturePlatform } from '../testSupport/conversationReceiptFixturePlatform';

function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
const opening = '요청하신 흐름을 살펴볼게요.';
const candidate = JSON.stringify({ text: opening, layout: 'card' });
const answer = '합성 최종 답변';
const openingID = 'conversation-assistant-opening-message';
const answerID = 'rag-conversation-answer-body';
const layoutID = 'conversation-reviewed-opening-a2ui';
function MountedConversation({
  send,
}: {
  send: ReturnType<typeof createRagConversationService>;
}) {
  const store = useConversationSessions();
  const choices = conversationChoiceActions(store, () => true);
  return (
    <ConversationScreen
      onSend={send}
      onBack={jest.fn()}
      onOpenSource={jest.fn()}
      retainedActions={{ possibilities: choices.onOpenDiseaseHypotheses }}
    />
  );
}
test.each([
  ['composer', 'ALLOW'],
  ['possibilities', 'ALLOW'],
  ['composer', 'ALLOW.'],
  ['composer', 'DENY'],
  ['composer', 'review-timeout'],
  ['composer', 'missing-terminal'],
  ['possibilities', 'stop'],
  ['composer', 'stop'],
] as const)(
  'shows only a completed, reviewed Apple opening: %s / %s',
  async (path, verdict) => {
    jest.useFakeTimers();
    const generation = gate<boolean>();
    const review = gate<string>();
    const final = gate<void>();
    const marks: string[] = [];
    let processingStartedAt = 0;
    const restore = installReceiptFixturePlatform(mark => {
      if (mark === 'opening_generate:started') processingStartedAt = Date.now();
      marks.push(mark);
    });
    // The RN host cannot execute native-driver animation; observe committed bubbles
    // with the supported Reduce Motion preference, not simulated paint.
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const cancel = jest.fn();
    const generate = jest.fn(async () => {
      throw new Error('The opening should use the existing Apple stream.');
    });
    // Keep the shipping adapter and declared streaming capability. Only the
    // Foundation Models native source is synthetic; it never opens another service.
    const stream = jest.fn<
      ReturnType<AppleFoundationModelsNativeBridge['stream']>,
      Parameters<AppleFoundationModelsNativeBridge['stream']>
    >(async function* () {
      const phase = stream.mock.calls.length;
      if (phase === 1) {
        const raw = path === 'composer' ? candidate : opening;
        yield { type: 'snapshot', text: raw };
        if (!(await generation.promise)) return;
        yield {
          type: 'completed',
          response: { text: raw, toolCalls: [], finishReason: 'complete' },
        };
      } else if (phase === 2) {
        const text = await review.promise;
        yield {
          type: 'completed',
          response: { text, toolCalls: [], finishReason: 'complete' },
        };
      } else {
        throw new Error('Unexpected opening provider request');
      }
    });
    const provider = new AppleFoundationModelsProvider({
      getAvailability: async () => ({ status: 'available' }),
      generate,
      stream,
      cancel,
    });
    const runner = jest.fn<
      ReturnType<typeof runRagConversationTurn>,
      Parameters<typeof runRagConversationTurn>
    >(async () => {
      await final.promise;
      return { status: 'answer', answer, citations: [] };
    });
    const authorize = jest.fn(async () => 'authorized' as const);
    const search = jest.fn();
    const send = createRagConversationService({
      selectedAi: async () => ({
        status: 'ready',
        selection: { providerId: provider.id, modelId: apple.modelId },
        option: { ...apple, provider },
        provider,
        modelId: apple.modelId,
        recipient: 'Apple Intelligence',
        remoteProcessing: false,
      }),
      consent: { authorize },
      queryConsent: { authorize },
      externalEvidence: { search },
      loadLocalData: async () => localData([]).data,
      registry: new LocalEvidenceReferenceRegistry(),
      ragRunner: runner,
    });
    const view = await render(
      <ConversationSessionsProvider>
        <MountedConversation send={send} />
      </ConversationSessionsProvider>,
    );
    try {
      if (path === 'possibilities') {
        await fireEvent.press(
          screen.getByTestId('conversation-open-possibilities'),
        );
      } else {
        await fireEvent.changeText(
          screen.getByTestId('rag-conversation-input'),
          '오늘 합성 측정 기록을 알려줘',
        );
        await fireEvent.press(screen.getByTestId('rag-conversation-send'));
      }
      await waitFor(() => expect(stream).toHaveBeenCalledTimes(1));
      expect(screen.queryByTestId(openingID)).toBeNull();
      expect(runner).not.toHaveBeenCalled();
      await act(async () => generation.resolve(verdict !== 'missing-terminal'));
      if (verdict !== 'missing-terminal') {
        await waitFor(() => expect(stream).toHaveBeenCalledTimes(2));
        expect(screen.queryByTestId(openingID)).toBeNull();
        expect(runner).not.toHaveBeenCalled();
      }
      if (verdict === 'stop') {
        const secondRequestId = stream.mock.calls[1]?.[1];
        await fireEvent.press(screen.getByTestId('rag-conversation-cancel'));
        await waitFor(() =>
          expect(cancel).toHaveBeenCalledWith(secondRequestId),
        );
        await act(async () => review.resolve('ALLOW'));
        expect(screen.queryByTestId(openingID)).toBeNull();
        expect(screen.queryByTestId(answerID)).toBeNull();
        expect(runner).not.toHaveBeenCalled();
        return;
      }
      if (verdict === 'review-timeout') {
        // The review may be slow, but the optional reply must not block the grounded turn indefinitely.
        await act(async () => {
          await jest.advanceTimersByTimeAsync(
            9_999 - (Date.now() - processingStartedAt),
          );
        });
        expect(runner).not.toHaveBeenCalled();
        expect(cancel).not.toHaveBeenCalled();
        await act(async () => {
          await jest.advanceTimersByTimeAsync(1);
        });
        expect(cancel).toHaveBeenCalledWith(stream.mock.calls[1]?.[1]);
        await act(async () => review.resolve('ALLOW'));
      } else if (verdict !== 'missing-terminal') {
        await act(async () => review.resolve(verdict));
      }
      await waitFor(() => expect(runner).toHaveBeenCalledTimes(1));
      if (path === 'possibilities') {
        expect(runner.mock.calls[0]?.[0].entryIntent).toBe('possibilities');
      }
      expect(screen.queryByTestId(answerID)).toBeNull();
      if (verdict === 'ALLOW') {
        const firstReply = await screen.findByTestId(openingID);
        expect(firstReply).toBeVisible();
        expect(firstReply).toHaveTextContent(opening);
        const hasLayout = Boolean(screen.queryByTestId(layoutID));
        expect(hasLayout).toBe(path === 'composer');
        expect(marks).toEqual(
          expect.arrayContaining([
            'opening_generate:completed',
            'opening_validate:completed',
            'opening_review:completed',
            'opening_delivery:completed',
            'opening_display:completed',
          ]),
        );
      } else {
        expect(screen.queryByTestId(openingID)).toBeNull();
        expect(marks).toContain(
          verdict === 'missing-terminal'
            ? 'opening_generate:unavailable'
            : verdict === 'review-timeout'
              ? 'opening_review:timeout'
              : 'opening_review:invalid_output',
        );
      }
      await act(async () => final.resolve(undefined));
      await waitFor(() => {
        const body = screen.getByTestId(answerID);
        expect(body).toBeVisible();
        expect(body).toHaveTextContent(/^합성 최종 답변(?:\s|$)/u);
      });
      expect(screen.queryByTestId(layoutID)).toBeNull();
      expect(stream).toHaveBeenCalledTimes(
        verdict === 'missing-terminal' ? 1 : 2,
      );
      expect(generate).not.toHaveBeenCalled();
      expect(authorize).not.toHaveBeenCalled();
      expect(search).not.toHaveBeenCalled();
    } finally {
      generation.resolve(false);
      review.resolve('DENY');
      final.resolve(undefined);
      await view.unmount();
      restore();
      jest.useRealTimers();
    }
  },
);
