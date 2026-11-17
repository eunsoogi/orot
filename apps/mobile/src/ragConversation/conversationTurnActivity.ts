import { reportOpening } from '../aiFeatures/integration/openingObservation';
import { createConversationDeliveryObserver } from './conversationDeliveryObserver';
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
import type { createConversationActivity } from './conversationActivity';
export type ConversationTurnActivity = ReturnType<
  typeof createConversationTurnActivity
>;

export function createConversationTurnActivity(input: {
  id: number;
  responseId: number;
  userMessageId?: number;
  initialToolEvents?: readonly ConversationToolEvent[];
  find: (id: number) => ConversationSession;
  update: (
    id: number,
    change: Partial<ConversationSession>,
    stream?: boolean,
  ) => void;
  current: () => boolean;
  retained?: ReturnType<typeof createConversationTurnRetention>;
  activity?: ReturnType<typeof createConversationActivity>;
  activityChanged?: () => void;
}) {
  const delivery =
    input.userMessageId === undefined
      ? undefined
      : createConversationDeliveryObserver({
          sessionId: input.id,
          messageId: input.userMessageId,
          current: input.current,
          find: input.find,
          update: input.update,
          retain: input.retained?.retainDelivery,
        });
  let events: readonly ConversationToolEvent[] = input.initialToolEvents ?? [];
  let writing = Promise.resolve();
  const failedCalls = new Set<string>();
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
    if (input.retained) {
      const key = JSON.stringify([event.operationRunId, event.callId]);
      writing = writing
        .then(async () => {
          await input.retained!.recordToolEvent(event);
          // A durably saved terminal snapshot supersedes a failed start for this call only.
          if (event.status !== 'started') failedCalls.delete(key);
        })
        .catch(() => {
          failedCalls.add(key);
        });
    }
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
    if (input.current() && pending?.id === input.responseId && input.activity) {
      const before = input.activity.getSnapshot();
      input.activity.tool(event);
      if (before !== input.activity.getSnapshot()) input.activityChanged?.();
    }
  };
  const onProviderReceipt = (receipt: 'accepted' | 'response_started') => {
    if (!input.current()) return;
    delivery?.onProviderReceipt(receipt);
    if (receipt === 'response_started') {
      input.activity?.responseStarted();
      input.activityChanged?.();
    }
  };
  return {
    metadata,
    finish(status: 'failed' | 'cancelled' | 'interrupted') {
      delivery?.settle();
      for (const event of events)
        if (event.status === 'started') observe({ ...event, status });
    },
    async flush() {
      await writing;
      if (failedCalls.size && input.current())
        input.update(input.id, {
          error: t('ragConversation.conversation.toolActivitySaveFailed'),
        });
    },
    observer: {
      onProviderReceipt,
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
        if (event.type === 'steering_availability') {
          if (input.current() && pending?.id === input.responseId)
            input.update(input.id, { steeringDeliveryMode: event.mode });
          return;
        }
        if (event.type === 'steering_applied') {
          // Archive only the owning visible generation, never a late callback or withheld health body.
          if (
            input.current() &&
            pending?.id === input.responseId &&
            !pending.withholdHealthBody
          ) {
            input.update(input.id, {
              pendingMessage: {
                ...pending,
                previousOutputs: pending.content.trim()
                  ? [...(pending.previousOutputs ?? []), pending.content]
                  : pending.previousOutputs,
                content: '',
                initialResponse: pending.initialResponse,
              },
            });
          }
          return;
        }
        if (event.type === 'initial_response') {
          // Preserve the reviewed reply separately from answer text and provider history.
          // Only the current attempt may capture it; replay and late callbacks cannot replace it.
          if (
            input.current() &&
            pending?.id === input.responseId &&
            !pending.withholdHealthBody &&
            Boolean(event.text.trim()) &&
            (!pending.initialResponse ||
              pending.initialResponse.source === 'receipt')
          ) {
            // Accepted generated output is evidence even when its provider is separate from the main call.
            onProviderReceipt('response_started');
            input.retained?.retainOpening({
              callId: event.callId,
              text: event.text,
            });
            input.update(input.id, {
              pendingMessage: {
                ...pending,
                initialResponse: { callId: event.callId, text: event.text },
              },
            });
            reportOpening('opening_display', 'completed');
          } else {
            // Rejected display ownership is not proof of stale health evidence.
            reportOpening('opening_display', 'unavailable');
          }
          return;
        }
        if (
          input.current() &&
          pending?.id === input.responseId &&
          event.type === 'started' &&
          input.activity
        ) {
          const before = input.activity.getSnapshot();
          input.activity.waiting();
          if (before !== input.activity.getSnapshot())
            input.activityChanged?.();
        }
        // A stream start alone is not output; report writing only after text arrives.
        if (
          input.current() &&
          pending?.id === input.responseId &&
          event.type !== 'started' &&
          event.text.length > 0 &&
          input.activity
        ) {
          const before = input.activity.getSnapshot();
          input.activity.stream();
          if (before !== input.activity.getSnapshot())
            input.activityChanged?.();
        }
        if (
          input.current() &&
          pending?.id === input.responseId &&
          !pending.withholdHealthBody
        )
          input.update(
            input.id,
            {
              pendingMessage: {
                id: input.responseId,
                content: applyWorkflowStreamEvent(pending.content, event),
                initialResponse: pending.initialResponse,
                previousOutputs: pending.previousOutputs,
                activity: pending.activity,
                ...metadata(),
              },
            },
            event.type === 'text_delta',
          );
      },
    },
  };
}
