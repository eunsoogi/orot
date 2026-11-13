import {
  mergeConversationToolEvents,
  type ConversationToolEvent,
} from '@orot/agent-runtime';
import { applyWorkflowStreamEvent } from '../agent/workflowActivity';
import { progressCopy } from './conversationProgress';
import { getRagConversationCopy } from './copy';
import { t } from '../i18n';
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
  let healthBodyWithheld = false;
  const copy = getRagConversationCopy();
  const toolMessageId =
    input.retained?.toolMessageId ?? `response-${input.responseId}`;
  const metadata = (withholdHealthBody = false) => {
    healthBodyWithheld ||= withholdHealthBody;
    return {
      toolEvents: healthBodyWithheld
        ? events.filter(
            event => event.inputSummary.sourceKind === 'external_medical',
          )
        : events,
      toolMessageId,
    };
  };
  const observe = (event: ConversationToolEvent) => {
    const next = mergeConversationToolEvents(events, event);
    // Replayed or reordered events must not repeat source capture or overwrite the terminal record.
    if (next === events) return;
    events = next;
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
        ? {
            pendingMessage: {
              ...pending,
              ...metadata(pending.withholdHealthBody),
            },
          }
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
          error: t('ragConversation.conversation.toolActivitySaveFailed'),
        });
    },
    observer: {
      // A provider may deliver a callback after cancellation or a newer retry.
      // Only the request that still owns this activity may record that callback.
      onToolEvent(event: ConversationToolEvent) {
        if (input.current()) observe(event);
      },
      onProgress(event: Parameters<typeof progressCopy>[0]) {
        const pending = input.find(input.id)?.pendingMessage;
        if (input.current() && pending?.id === input.responseId)
          input.update(input.id, {
            pendingMessage: {
              ...pending,
              id: input.responseId,
              content: pending.content,
              activity: progressCopy(event, copy),
              ...metadata(pending?.withholdHealthBody),
            },
          });
      },
      onTaskStreamEvent(event: Parameters<typeof applyWorkflowStreamEvent>[1]) {
        const pending = input.find(input.id)?.pendingMessage;
        if (
          input.current() &&
          pending?.id === input.responseId &&
          !pending.withholdHealthBody
        )
          input.update(input.id, {
            pendingMessage: {
              id: input.responseId,
              content: applyWorkflowStreamEvent(pending.content, event),
              activity: pending.activity,
              ...metadata(),
            },
          });
      },
    },
  };
}
