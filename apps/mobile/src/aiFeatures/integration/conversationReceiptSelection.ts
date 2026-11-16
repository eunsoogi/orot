import type { SelectedAiResolution } from './provider';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import { conversationBackgroundProvider } from './conversationBackgroundProvider';
import { conversationReceiptProvider } from './conversationReceiptProvider';

/** Both direct calls and workflow selection must use the same request-local observer.
 * Selection never emits a receipt, requests OS work or grants consent.
 * Receipt and execution observations start only at their existing provider boundaries. */
export function conversationReceiptSelection<T extends SelectedAiResolution>(
  selected: T,
  observer?: Pick<
    RagConversationObserver,
    'onProviderReceipt' | 'expectedConversationModel' | 'onExecutionState'
  >,
): T {
  const expected = observer?.expectedConversationModel;
  if (
    selected.status === 'ready' &&
    expected &&
    (selected.provider.id !== expected.providerId ||
      selected.modelId !== expected.modelId)
  )
    throw new Error('The conversation model changed before dispatch.');
  if (
    selected.status !== 'ready' ||
    (!observer?.onProviderReceipt && !observer?.onExecutionState)
  )
    return selected;
  const receipt = observer?.onProviderReceipt
    ? conversationReceiptProvider(selected.provider, observer.onProviderReceipt)
    : selected.provider;
  // Keep both selection paths wrapped; workflows consume option.provider while
  // openings may call provider directly. Local inference must not request a grant.
  const provider = conversationBackgroundProvider(
    receipt,
    selected.remoteProcessing,
    observer?.onExecutionState
      ? extend => observer.onExecutionState?.(extend ? 'working' : 'local')
      : undefined,
  );
  return {
    ...selected,
    provider,
    option: { ...selected.option, provider },
  };
}
