import { createElement } from 'react';
import { useConversationVisibility } from '../../aiFeatures/integration/useConversationVisibility';
import { LiveConversationVoiceEntry } from '../LiveConversationVoiceEntry';
import type { ConversationVoiceProps } from '../conversationVoiceDependencies';

// The stock flow wraps selected-route ownership in a foreground-only action guard.
export function LiveEntryWithStockVisibility(props: ConversationVoiceProps) {
  const current = useConversationVisibility(
    props.isEntryCurrent,
    false,
    false,
    true,
  );
  return createElement(LiveConversationVoiceEntry, {
    ...props,
    isEntryCurrent: current,
  });
}
