import { conversationBackgroundProvider } from './conversationBackgroundProvider';
import type { RagConversationObserver } from '../../ragConversation/service';
import type { requireSelectedAi } from './provider';
import { withProviderStage } from '../../providers/diagnostics';

/** Fence the actual model selected by the sender against pre-capture consent. */
export function voiceSelectionMatches(
  observer: RagConversationObserver | undefined,
  selected: ReturnType<typeof requireSelectedAi>,
): boolean {
  const expected = observer?.expectedVoiceSelection;
  return (
    !expected ||
    (selected.provider.id === expected.providerId &&
      selected.modelId === expected.modelId)
  );
}

/** Resolve the live selection and reject a changed voice consent binding. */
export async function resolveConversationSelection(
  observer: RagConversationObserver | undefined,
  resolve: () => Promise<ReturnType<typeof requireSelectedAi>>,
) {
  const selected = await withProviderStage('rag', 'selection', resolve);
  return voiceSelectionMatches(observer, selected)
    ? {
        ...selected,
        provider: conversationBackgroundProvider(
          selected.provider,
          selected.remoteProcessing,
          observer?.onExecutionState
            ? extend =>
                observer.onExecutionState?.(extend ? 'working' : 'local')
            : undefined,
        ),
      }
    : null;
}

/** The existing text and photo limits apply equally to spoken transcripts. */
export function validConversationInput(
  question: string,
  photo: RagConversationObserver['photoInput'],
): boolean {
  return Boolean(
    (question ||
      photo?.submitted.ocr?.sections.some(section => section.text.trim())) &&
    question.length <= 1000,
  );
}

/** Cancellation wins when a target lookup reports a failure after its signal aborts. */
export function conversationTargetFailure(
  signal: AbortSignal,
  failure: NonNullable<
    Awaited<
      ReturnType<
        typeof import('./conversationEntryTargets').resolveConversationTargets
      >
    >['failure']
  >,
) {
  return {
    status: 'failure' as const,
    kind: signal.aborted ? ('cancelled' as const) : failure,
  };
}
