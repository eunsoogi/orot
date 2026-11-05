import {
  mergeConversationToolEvents,
  type ConversationToolEvent,
} from '@orot/agent-runtime';
import { applyWorkflowStreamEvent } from '../agent/workflowActivity';
import { progressCopy } from './conversationProgress';
import { getRagConversationCopy } from './copy';
import type { ConversationSession } from './conversationSessionTypes';
import type { createConversationTurnRetention } from './conversationTurnRetention';

/** The response bubble and durable turn share one call map; content never enters tool metadata. */
export function createConversationTurnActivity(input: {
  id: number;
  responseId: number;
  find: (id: number) => ConversationSession;
  update: (id: number, change: Partial<ConversationSession>) => void;
  current: () => boolean;
  retained?: ReturnType<typeof createConversationTurnRetention>;
}) {
  let events: readonly ConversationToolEvent[] = [];
  let writing = Promise.resolve();
  let failed = false;
  const copy = getRagConversationCopy();
  const toolMessageId =
    input.retained?.toolMessageId ?? `response-${input.responseId}`;
  const metadata = () => ({
    toolEvents: events,
    toolMessageId,
  });
  const observe = (event: ConversationToolEvent) => {
    events = mergeConversationToolEvents(events, event);
    // Every write is serialized, including cancellation after the visible request has ended.
    if (input.retained)
      writing = writing
        .then(() => input.retained!.recordToolEvent(event))
        .catch(() => {
          failed = true;
        });
    const session = input.find(input.id);
    if (!session) return; // A removed in-memory session cannot be revived by a late callback.
    const pending = session.pendingMessage;
    input.update(input.id, {
      ...(pending?.id === input.responseId
        ? { pendingMessage: { ...pending, ...metadata() } }
        : {}),
      messages: session.messages.map(message =>
        message.toolMessageId === toolMessageId
          ? { ...message, ...metadata() }
          : message,
      ),
    });
  };
  return {
    metadata,
    finish(status: 'failed' | 'cancelled') {
      for (const event of events)
        if (event.status === 'started') observe({ ...event, status });
    },
    async flush() {
      await writing;
      if (failed && input.current())
        input.update(input.id, {
          error: '도구 실행 기록을 저장하지 못했어요.',
        });
    },
    observer: {
      onToolEvent: observe,
      onProgress(event: Parameters<typeof progressCopy>[0]) {
        if (input.current())
          input.update(input.id, {
            pendingMessage: {
              id: input.responseId,
              content: input.find(input.id).pendingMessage?.content ?? '',
              activity: progressCopy(event, copy),
              ...metadata(),
            },
          });
      },
      onTaskStreamEvent(event: Parameters<typeof applyWorkflowStreamEvent>[1]) {
        if (input.current())
          input.update(input.id, {
            pendingMessage: {
              id: input.responseId,
              content: applyWorkflowStreamEvent(
                input.find(input.id).pendingMessage?.content ?? '',
                event,
              ),
              activity:
                input.find(input.id).pendingMessage?.activity ?? copy.loading,
              ...metadata(),
            },
          });
      },
    },
  };
}
