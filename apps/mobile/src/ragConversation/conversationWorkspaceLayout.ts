import type { DisplayMessage } from './ConversationMessage';

/** Native hinge capability and measured safe host width are both required. */
export function conversationWorkspaceLayout(
  hasHinge: boolean,
  width: number,
  fontScale: number,
) {
  const scale = Number.isFinite(fontScale) ? Math.max(1, fontScale) : 1;
  const visible = hasHinge && Number.isFinite(width) && width >= 760 * scale;
  return {
    visible,
    activityWidth: visible ? Math.max(260 * scale, width * 0.32) : 0,
  };
}

/** Hidden tool-only pending turns must not leave empty answer cards behind. */
export function transcriptMessageVisible(
  message: DisplayMessage,
  separated: boolean,
) {
  return !message.streaming || (!separated && Boolean(message.content.trim()));
}
