import type { SelectedAiResolution } from './provider';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import { conversationReceiptProvider } from './conversationReceiptProvider';

/** Both direct calls and workflow selection must use the same request-local observer.
 * Resolving a selection never emits a receipt or grants consent; only provider evidence does. */
export function conversationReceiptSelection<T extends SelectedAiResolution>(
  selected: T,
  observer?: Pick<
    RagConversationObserver,
    'onProviderReceipt' | 'expectedConversationModel'
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
  if (selected.status !== 'ready' || !observer?.onProviderReceipt)
    return selected;
  const provider = conversationReceiptProvider(
    selected.provider,
    observer.onProviderReceipt,
  );
  return {
    ...selected,
    provider,
    option: { ...selected.option, provider },
  };
}
