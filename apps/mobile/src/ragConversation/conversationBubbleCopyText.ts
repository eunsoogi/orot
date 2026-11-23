import { t } from '../i18n';
import {
  ConversationBubbleCopyHost,
  type ConversationBubbleCopyScope,
} from './ConversationBubbleCopyHost';
import { parseConversationReport } from './conversationReportTemplate';
import type { DisplayMessage } from './conversationDisplayMessage';

/** The clipboard only gets the rendered body, never source, attachments or turn metadata. */
export function conversationBubbleCopyText(message: DisplayMessage) {
  const { content } = message;
  if (
    !content.trim() ||
    message.streaming ||
    message.localChoicePending ||
    message.historyUnavailable
  )
    return undefined;
  const report =
    message.role === 'assistant' &&
    !message.incomplete &&
    !message.directPhotoReply
      ? parseConversationReport(content)
      : undefined;
  return report
    ? [
        report.title,
        report.introduction,
        ...report.sections.map(
          section => section.title + '\n' + section.content,
        ),
      ]
        .filter((part): part is string => part !== undefined)
        .join('\n\n')
    : content;
}

/** Keep the native host stable when an existing route temporarily loses copy authority. */
export function conversationBubbleCopyMenus(
  scope: ConversationBubbleCopyScope | undefined,
  message: DisplayMessage,
) {
  if (!scope || !ConversationBubbleCopyHost) return undefined;
  const owner = `${scope.sessionId}:${message.id}`;
  const copyLabel = t('ragConversation.bubble.copy');
  const opening = message.initialResponse;
  const openingText =
    scope.allowed &&
    !message.historyUnavailable &&
    opening?.source !== 'receipt' &&
    opening?.text.trim()
      ? opening.text
      : undefined;
  return {
    body: {
      copyOwner: owner,
      copyLabel,
      copyText: scope.allowed ? conversationBubbleCopyText(message) : undefined,
    },
    opening: {
      copyOwner: owner + ':opening',
      copyLabel,
      copyText: openingText,
    },
  };
}
