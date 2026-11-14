import { applyWorkflowStreamEvent } from '../agent/workflowActivity';
import type { createConversationTurnRetention } from './conversationTurnRetention';
import type { ConversationArtifactSource } from './conversationArtifactSources';
import type { MultiAgentResponderStreamEvent } from '@orot/agent-runtime';
import type { RagConversationObserver } from './conversationObserver';
import type { createConversationTurnActivity } from './conversationTurnActivity';

/** Serializes preview writes and fences a previous provider or tool input before the next one. */
export function createConversationRequestPreview(input: {
  readonly turn: ReturnType<typeof createConversationTurnRetention>;
  readonly current: () => boolean;
  readonly reportFailure: () => void;
}) {
  let boundary: number | undefined;
  let admitted = false;
  let text = '';
  let writes: Promise<void> = Promise.resolve();
  return {
    async invalidate() {
      await writes;
      if (!input.current())
        throw new Error('Conversation request is unavailable.');
      admitted = false;
      text = '';
      boundary = await input.turn.invalidatePreview();
      return boundary;
    },
    async prepare(
      expected: number,
      template: {
        providerId: string;
        modelId: string;
        sources: readonly ConversationArtifactSource[];
      },
    ) {
      if (boundary !== expected || !input.current())
        throw new Error('Conversation preview changed.');
      admitted = await input.turn.preparePreview(expected, template);
    },
    onStream(event: MultiAgentResponderStreamEvent) {
      if (event.type === 'initial_response') return;
      if (!input.current() || !admitted || boundary === undefined) return;
      text = applyWorkflowStreamEvent(text, event);
      if (!text) return;
      const currentBoundary = boundary;
      const currentText = text;
      writes = writes
        .then(async () => {
          if (
            !(await input.turn.writePreview(currentBoundary, currentText)) &&
            boundary === currentBoundary
          ) {
            admitted = false;
            if (input.current()) input.reportFailure();
          }
        })
        .catch(() => {
          if (boundary === currentBoundary) admitted = false;
          if (input.current()) input.reportFailure();
        });
    },
    flush: () => writes,
  };
}

/** Add private preview callbacks without changing the visible stream observer. */
export function conversationPreviewObserver(
  preview: ReturnType<typeof createConversationRequestPreview>,
  activity: ReturnType<typeof createConversationTurnActivity>,
): Pick<
  RagConversationObserver,
  | 'onPreviewBoundary'
  | 'onPreviewPrepared'
  | 'beforeTaskInputChange'
  | 'onTaskStreamEvent'
> {
  return {
    onPreviewBoundary: () => preview.invalidate(),
    onPreviewPrepared: (boundary, template) =>
      preview.prepare(boundary, template),
    beforeTaskInputChange: async () => {
      await preview.invalidate();
    },
    onTaskStreamEvent: event => {
      activity.observer.onTaskStreamEvent(event);
      preview.onStream(event);
    },
  };
}
