import { act, render, screen } from '@testing-library/react-native';
import type {
  LanguageModelProvider,
  ProviderResult,
  LanguageModelStreamEvent,
} from '@orot/model-runtime';
import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';
import { conversationReceiptProvider } from '../../aiFeatures/integration/conversationReceiptProvider';
import { ConversationHistory } from '../ConversationHistory';
import { createConversationSessions } from '../conversationSessions';

function gate() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

test.each(['verified', 'stopped'] as const)(
  'separates mounted Sending, verified Read and first transcript text: %s',
  async (outcome) => {
    jest.useFakeTimers();
    const epoch = Date.parse('2035-01-01T00:00:00Z');
    jest.setSystemTime(epoch);
    const reduceMotion = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const sessions = createConversationSessions();
    const local = gate();
    const output = gate();
    const finish = gate();
    let signalStart!: () => void;
    let work: Promise<void> | undefined;
    let dispatchedAt: number | undefined;
    const provider: LanguageModelProvider = {
      id: 'synthetic-receipt',
      kind: 'language-model',
      displayName: 'Synthetic receipt',
      capabilities: {
        inputTypes: ['text'],
        streaming: true,
        structuredOutput: false,
        toolCalling: false,
      },
      async generate() {
        throw new Error('Only the synthetic stream is exercised');
      },
      async *stream(_request, options): AsyncGenerator<ProviderResult<LanguageModelStreamEvent>> {
        dispatchedAt = Date.now() - epoch;
        signalStart = options!.onResponseStarted!;
        yield { ok: true, value: { type: 'text_delta', text: '' } };
        await output.wait;
        yield {
          ok: true,
          value: { type: 'text_delta', text: 'Synthetic response' },
        };
        await finish.wait;
      },
    };
    function History() {
      const { sessions: list } = useSyncExternalStore(sessions.subscribe, sessions.getSnapshot);
      const session = list[0];
      return (
        <ConversationHistory
          messages={session.messages}
          pendingMessage={session.pendingMessage}
          requestSessionId={session.id}
          requestActivity={session.requestActivity}
          error=""
          onOpenSource={() => {}}
          onLinkError={() => {}}
        />
      );
    }
    const readAt = () => sessions.getSnapshot().sessions[0].messages[0]?.delivery?.readAt;
    const receipt = () => screen.getByTestId('conversation-message-receipt');
    const textOutput = () => screen.queryByTestId('rag-conversation-stream');
    const tick = (ms: number, action?: () => void) =>
      act(async () => {
        jest.advanceTimersByTime(ms);
        action?.();
      });
    let view: Awaited<ReturnType<typeof render>> | undefined;
    try {
      view = await render(<History />);
      await act(async () => {
        sessions.setDraft(1, 'Synthetic question');
        work = sessions.send(1, async (_q, _history, signal, observer) => {
          await local.wait;
          observer?.onTaskStreamEvent?.({ type: 'started' });
          const wrapped = conversationReceiptProvider(provider, observer?.onProviderReceipt);
          for await (const event of wrapped.stream!({ messages: [] }, { signal })) {
            if (event.ok && event.value.type === 'text_delta' && event.value.text)
              observer?.onTaskStreamEvent?.(event.value);
          }
          return { status: 'answer', answer: 'Synthetic response', citations: [] };
        });
      });
      expect(receipt()).toHaveTextContent(/전송 중/);
      expect(readAt()).toBeUndefined();
      expect(dispatchedAt).toBeUndefined();
      // Controlled logical clock only: 275ms gate is not measured app latency.
      await tick(275, local.release);
      expect(dispatchedAt).toBe(275);
      expect(receipt()).toHaveTextContent(/전송 중/);
      expect(readAt()).toBeUndefined();
      expect(textOutput()).toBeNull();

      if (outcome === 'stopped') {
        await tick(450, () => {
          sessions.cancel(1);
          signalStart();
          output.release();
          finish.release();
        });
        await act(async () => work);
        expect(receipt()).not.toHaveTextContent(/읽음/);
        expect(readAt()).toBeUndefined();
        expect(textOutput()).toBeNull();
        return;
      }

      // This injected verified provider callback, not time or dispatch, changes the receipt.
      await tick(449);
      expect(receipt()).toHaveTextContent(/전송 중/);
      await tick(1, signalStart);
      expect(readAt()).toBe(new Date(epoch + 725).toISOString());
      expect(receipt()).toHaveTextContent(/읽음/);
      expect(textOutput()).toBeNull();

      await tick(180, output.release);
      // A mounted host node is React commit evidence, not native paint or animation timing.
      expect(textOutput()).toHaveTextContent('Synthetic response');
      expect(readAt()).toBe(new Date(epoch + 725).toISOString());
      await act(async () => {
        finish.release();
        await work;
      });
    } finally {
      await view?.unmount();
      sessions.dispose();
      local.release();
      output.release();
      finish.release();
      await work;
      reduceMotion.mockRestore();
      jest.useRealTimers();
    }
  },
);
