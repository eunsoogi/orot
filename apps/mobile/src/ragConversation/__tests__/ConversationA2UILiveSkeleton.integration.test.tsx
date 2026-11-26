import { act, render, screen, waitFor } from '@testing-library/react-native';
import {
  createChatGPTPlanProvider,
  type ChatGPTPlanNativeEvent,
} from '@orot/provider-openai';
import { conversationReceiptProvider } from '../../aiFeatures/integration/conversationReceiptProvider';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';
import { conversationHistoryActivity } from '../conversationHistoryActivity';
import { createConversationSessions } from '../conversationSessions';
import { runRagConversationTurn } from '../service';
import { fixture } from '../testSupport/conversationEnvelopeFixtures';
import {
  previewOnly,
  streamedAnswer,
} from '../testSupport/conversationA2UIStreamFixtures';

let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({
    width: 390,
    height: 844,
    scale: 3,
    fontScale: mockFontScale,
  }),
}));

const requestId = 'synthetic-native-stream';

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

const linearSkeleton = 'conversation-a2ui-skeleton';
const rowSkeleton = 'conversation-a2ui-skeleton-row';
const bySkeleton = (testId: string) =>
  screen.queryByTestId(testId, { includeHiddenElements: true });

test.each([
  ['complete', 1, linearSkeleton, rowSkeleton, false],
  ['Stop', 1, linearSkeleton, rowSkeleton, false],
  ['leave and return', 1, linearSkeleton, null, false],
  ['complete', 1.6, linearSkeleton, linearSkeleton, false],
  ['complete', 1, rowSkeleton, linearSkeleton, true],
  ['Stop', 1, rowSkeleton, linearSkeleton, true],
  ['leave and return', 1, rowSkeleton, null, true],
  ['complete', 1, linearSkeleton, rowSkeleton, 'replacement'],
  ['complete', 1, linearSkeleton, rowSkeleton, 'object replacement'],
  ['Stop', 1, linearSkeleton, rowSkeleton, 'object replacement'],
  ['leave and return', 1, linearSkeleton, null, 'object replacement'],
  ['Stop', 1, linearSkeleton, rowSkeleton, 'replacement'],
  ['leave and return', 1, linearSkeleton, null, 'replacement'],
] as const)(
  'owning streamed Conversation renders neutral layout before %s at scale %d',
  async (ending, fontScale, firstLayout, expectedLayout, mode) => {
    const usesRepeatedChildren = mode === true;
    const { envelope, firstPart, secondPart } = streamedAnswer(mode);
    const initialHint = {
      kind: usesRepeatedChildren ? 'row' : 'stack',
      slots: 2,
    };
    const revisedHint = usesRepeatedChildren
      ? { kind: 'stack', slots: 3 }
      : { kind: 'row', slots: 2 };
    mockFontScale = fontScale;
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
      const skeleton = screen.getByTestId(firstLayout, {
        includeHiddenElements: true,
      });
      expect(skeleton.props.accessibilityElementsHidden).toBe(true);
      expect(screen.queryByText('사과')).toBeNull();
      expect(screen.queryByText(previewOnly)).toBeNull();
      const responseId = sessions
        .getSnapshot()
        .sessions.find(item => item.id === 1)?.pendingMessage?.id;
      expect(responseId).toEqual(expect.any(Number));
      if (ending === 'leave and return') {
        sessions.create();
        await view.rerender(transcript());
        expect(bySkeleton(firstLayout)).toBeNull();
        sessions.select(1);
      }
      native.emit({ requestId, type: 'text_delta', text: secondPart });
      await waitFor(() => expect(layoutEvents).toHaveLength(2));
      await view.rerender(transcript());
      if (expectedLayout) {
        const owned = sessions
          .getSnapshot()
          .sessions.find(item => item.id === 1);
        expect(owned?.pendingMessage?.id).toBe(responseId);
        expect(owned?.pendingMessage?.layoutSkeleton?.layout).toEqual(
          revisedHint,
        );
        expect(bySkeleton(expectedLayout)).toBeTruthy();
        expect(
          bySkeleton(
            expectedLayout === rowSkeleton ? linearSkeleton : rowSkeleton,
          ),
        ).toBeNull();
      } else {
        expect(bySkeleton(rowSkeleton)).toBeNull();
        expect(bySkeleton(linearSkeleton)).toBeNull();
      }
      expect(layoutEvents).toEqual([initialHint, revisedHint]);
      expect(screen.queryByText(previewOnly)).toBeNull();
      expect(screen.queryByText('자두')).toBeNull();
      if (ending === 'Stop') sessions.cancel(1);
      native.emit({ requestId, type: 'completed', text: envelope });
      await run;
      await view.rerender(transcript());
      expect(bySkeleton(rowSkeleton)).toBeNull();
      expect(bySkeleton(linearSkeleton)).toBeNull();
      if (ending !== 'Stop') {
        expect(screen.getByText('사과')).toBeTruthy();
        expect(screen.getByText('배')).toBeTruthy();
        if (usesRepeatedChildren) expect(screen.getByText('자두')).toBeTruthy();
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
