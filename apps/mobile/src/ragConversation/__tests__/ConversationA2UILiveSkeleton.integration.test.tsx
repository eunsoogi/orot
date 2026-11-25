import { act, render, screen, waitFor } from '@testing-library/react-native';
import {
  createChatGPTPlanProvider,
  type ChatGPTPlanNativeEvent,
} from '@orot/provider-openai';
import { conversationReceiptProvider } from '../../aiFeatures/integration/conversationReceiptProvider';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';
import { conversationA2UICatalog } from '../conversationA2UI';
import { conversationHistoryActivity } from '../conversationHistoryActivity';
import { createConversationSessions } from '../conversationSessions';
import { runRagConversationTurn } from '../service';
import { fixture } from '../testSupport/conversationEnvelopeFixtures';

const answer = '사과\n배';
const previewOnly = '내부 검증 전 문자열';
const requestId = 'synthetic-native-stream';

function frame(operation: string, payload: object) {
  return JSON.stringify({
    version: '1.0',
    [operation]: { surfaceId: 'orot:response:draft', ...payload },
  });
}

const create = frame('createSurface', {
  catalogId: conversationA2UICatalog,
  components: [
    { id: 'root', component: 'Card', child: 'content' },
    { id: 'content', component: 'List', children: ['first', 'second'] },
    { id: 'first', component: 'Text', text: answer.split('\n')[0] },
    { id: 'second', component: 'Text', text: answer.split('\n')[1] },
  ],
});
const row = frame('updateComponents', {
  components: [
    { id: 'content', component: 'Row', children: ['first', 'second'] },
  ],
});
const envelope = JSON.stringify({
  type: 'result',
  value: { answerKind: 'conversation', answer, a2uiFrames: [create, row] },
  citations: [],
});
const firstPart = envelope.slice(0, envelope.indexOf(JSON.stringify(row)));
const secondPart = envelope.slice(firstPart.length);

function chatGPTFixture() {
  let subscribe: ((event: ChatGPTPlanNativeEvent) => void) | undefined;
  const startResponse = jest.fn(async () => {
    if (startResponse.mock.calls.length !== 1)
      throw new Error('unexpected second request');
  });
  const cancelResponse = jest.fn();
  const provider = createChatGPTPlanProvider({
    model: { slug: 'synthetic', displayName: 'Synthetic' },
    issuedClientID: 'fixture',
    requestIDFactory: () => requestId,
    bridge: {
      subscribe(listener) {
        subscribe = listener;
        return () => {
          subscribe = undefined;
        };
      },
      listModels: async () => [],
      startResponse,
      cancelResponse,
    },
  });
  return {
    provider,
    startResponse,
    cancelResponse,
    emit: (event: ChatGPTPlanNativeEvent) => subscribe?.(event),
  };
}

test.each(['complete', 'Stop', 'leave and return'] as const)(
  'owning streamed Conversation renders neutral layout before %s',
  async ending => {
    const native = chatGPTFixture();
    const sessions = createConversationSessions();
    const options = fixture().options;
    const layoutEvents: unknown[] = [];
    const transcript = () => {
      const selected = sessions.getSnapshot();
      const current = selected.sessions.find(
        item => item.id === selected.activeId,
      )!;
      const presented = conversationHistoryActivity(
        current.messages,
        current.pendingMessage,
        current.id,
        current.requestActivity,
      );
      return (
        <ConversationTranscriptMessages
          messages={presented.visibleMessages}
          instructions={undefined}
          replyFocus={undefined}
          onLayout={jest.fn()}
          messageProps={{ onOpenSource: jest.fn(), onLinkError: jest.fn() }}
        />
      );
    };
    const view = await render(transcript());
    sessions.setDraft(1, '과일 예시를 보여 주세요.');
    const runTurn: Parameters<typeof sessions.send>[1] = (
      question,
      previousMessages,
      signal,
      observer,
    ) =>
      runRagConversationTurn(
        {
          ...options,
          question,
          previousMessages,
          loadCurrentEvidence: async () => ({
            batch: { items: [], coverage: [], conflicts: [] },
            chunks: [],
          }),
          workflow: {
            ...options.workflow,
            provider: conversationReceiptProvider(
              native.provider,
              observer?.onProviderReceipt,
            ),
            execution: {
              ...options.workflow.execution,
              providerId: native.provider.id,
            },
          },
        },
        {
          signal,
          onTaskStreamEvent(event) {
            observer?.onTaskStreamEvent?.(event);
            if (event.type === 'layout_skeleton') {
              layoutEvents.push(event.layout);
            }
          },
        },
      );
    const run = sessions.send(1, runTurn);
    try {
      await waitFor(() =>
        expect(native.startResponse).toHaveBeenCalledTimes(1),
      );
      await view.rerender(transcript());
      expect(
        screen.queryByTestId('conversation-a2ui-skeleton', {
          includeHiddenElements: true,
        }),
      ).toBeNull();
      await act(() => {
        native.emit({
          requestId: 'foreign-request',
          type: 'text_delta',
          text: firstPart.replace('사과', previewOnly),
        });
        native.emit({ requestId, type: 'text_delta', text: firstPart });
      });
      await waitFor(() => expect(layoutEvents).toHaveLength(1));
      await view.rerender(transcript());
      const skeleton = screen.getByTestId('conversation-a2ui-skeleton', {
        includeHiddenElements: true,
      });
      expect(skeleton.props.accessibilityElementsHidden).toBe(true);
      expect(screen.queryByText('사과')).toBeNull();
      expect(screen.queryByText(previewOnly)).toBeNull();
      if (ending === 'leave and return') {
        sessions.create();
        await view.rerender(transcript());
        expect(
          screen.queryByTestId('conversation-a2ui-skeleton', {
            includeHiddenElements: true,
          }),
        ).toBeNull();
        sessions.select(1);
      }
      native.emit({ requestId, type: 'text_delta', text: secondPart });
      await waitFor(() => expect(layoutEvents).toHaveLength(2));
      await view.rerender(transcript());
      const liveRow = screen.queryByTestId('conversation-a2ui-skeleton-row', {
        includeHiddenElements: true,
      });
      if (ending === 'leave and return') expect(liveRow).toBeNull();
      else expect(liveRow).toBeTruthy();
      expect(layoutEvents).toEqual([
        { kind: 'stack', slots: 2 },
        { kind: 'row', slots: 2 },
      ]);
      if (ending === 'Stop') sessions.cancel(1);
      native.emit({ requestId, type: 'completed', text: envelope });
      await run;
      await view.rerender(transcript());
      expect(
        screen.queryByTestId('conversation-a2ui-skeleton-row', {
          includeHiddenElements: true,
        }),
      ).toBeNull();
      if (ending !== 'Stop') {
        expect(screen.getByText('사과')).toBeTruthy();
        expect(screen.getByText('배')).toBeTruthy();
      } else {
        expect(screen.queryByText('사과')).toBeNull();
        expect(native.cancelResponse).toHaveBeenCalledTimes(1);
      }
      expect(native.startResponse).toHaveBeenCalledTimes(1);
    } finally {
      sessions.dispose();
      await view.unmount();
    }
  },
);
