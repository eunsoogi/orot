import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { captureConversationSources } from './captureConversationSources';

/** Prior retained inputs must be revalidated before any draft prose is exposed. */
export function conversationStreamObservers(
  observer: RagConversationObserver | undefined,
  hasRetainedInputs: boolean,
  registry: LocalEvidenceReferenceRegistry,
  selection: { readonly providerId: string; readonly modelId: string },
) {
  return {
    onTaskStreamEvent: hasRetainedInputs
      ? undefined
      : observer?.onTaskStreamEvent,
    beforeTaskStream:
      !observer?.beforeTaskStream &&
      (hasRetainedInputs ||
        !(observer?.onPreviewBoundary && observer.onPreviewPrepared))
        ? undefined
        : async (
            input: Parameters<
              NonNullable<RagConversationObserver['beforeTaskStream']>
            >[0],
            signal: AbortSignal,
          ) => {
            await observer?.beforeTaskStream?.(input, signal);
            if (hasRetainedInputs) return;
            if (!observer?.onPreviewBoundary || !observer.onPreviewPrepared)
              return;
            const boundary = await observer.onPreviewBoundary();
            // Unknown multimodal, tool and external inputs cannot be proven current after relaunch.
            if (
              input.request.messages.some(
                message =>
                  (message.role !== 'system' && message.role !== 'user') ||
                  typeof message.content !== 'string',
              ) ||
              input.evidence.items.some(
                item =>
                  item.sourceKind !== 'personal_record' &&
                  item.sourceKind !== 'reviewed_memory',
              )
            )
              return;
            const references = input.evidence.items.map(
              ({
                sourceKind,
                sourceId,
                sourceRevision,
                evidenceId,
                evidenceRevision,
                locator,
                effectiveTime,
                unit,
                reviewState,
              }) => ({
                sourceKind,
                sourceId,
                sourceRevision,
                evidenceId,
                evidenceRevision,
                locator,
                effectiveTime,
                ...(unit === undefined ? {} : { unit }),
                reviewState,
              }),
            );
            const captured = await captureConversationSources(
              references,
              registry,
              signal,
            );
            if (signal.aborted)
              throw new Error('Conversation preview was cancelled.');
            await observer.onPreviewPrepared(boundary, {
              ...selection,
              sources: captured.sources,
            });
          },
    beforeTaskInputChange: observer?.beforeTaskInputChange,
  };
}
