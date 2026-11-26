import { t } from '../i18n';
import type { ConversationScreenProps } from './ConversationScreenProps';
import { guardPersonalToolSource } from './guardPersonalToolSource';
import type { ConversationSessions } from './conversationSessions';

export function createConversationScreenSources(
  store: ConversationSessions,
  id: number,
  onOpenSource: ConversationScreenProps['onOpenSource'],
  resolveToolSource: ConversationScreenProps['resolveToolSource'],
) {
  return {
    onOpenSource,
    resolveToolSource: guardPersonalToolSource(store, id, resolveToolSource),
    toolSourceSessionId: store.toolSourceSessionId(id),
    onLinkError: () =>
      store.setError(id, t('ragConversation.conversation.sourceOpenFailed')),
  };
}
