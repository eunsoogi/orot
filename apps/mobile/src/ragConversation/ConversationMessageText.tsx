import { ArchivedRichTextSurface } from './ArchivedRichTextSurface';
import { isProtectedArchivedA2UILayout } from './archivedRichTextDisplayBinding';
import { ArchivedPairedDetailsSurface } from './ArchivedPairedDetailsSurface';
import { archivedPairedDetailsFor } from './archivedPairedDetailsBinding';
import { SavedPossibilityNarrative } from './SavedPossibilityNarrative';
import { savedPossibilityNarrativeParts } from './savedPossibilityNarrativeParts';
import { ConversationReportText } from './ConversationReportText';
import {
  hasConversationReportTitle,
  parseConversationReport,
} from './conversationReportTemplate';
import { conversationA2UIAppNotices } from './conversationA2UIAppNotices';
import { ConversationA2UISurface } from './ConversationA2UISurface';
import type { ConversationA2UINode } from './conversationA2UI';
import { memo, useLayoutEffect } from 'react';
import { reportConversationA2UIReactCommit } from './conversationA2UIFinalDiagnostic';
import { AppText } from '../layout/AppText';
import { AiResponseText } from '../layout/AiResponseText';
import { AssistantMarkdown } from './AssistantMarkdown';
import type { DisplayMessage } from './conversationDisplayMessage';
import { parseAssistantMarkdown } from './conversationMarkdown';
import { styles } from './ConversationScreen.styles';

type AssistantTextFormat = 'prose' | 'report-capable';

/** Choose formatting by completed content, not by where the timeline found it.
 * Photo answers share Markdown rendering without becoming actionable reports. */
export function conversationAssistantTextFormat(
  message: DisplayMessage,
): AssistantTextFormat | undefined {
  if (
    message.role === 'user' ||
    message.streaming ||
    message.incomplete ||
    message.historyUnavailable
  )
    return undefined;
  return message.directPhotoReply ? 'prose' : 'report-capable';
}

/** Only prose identity belongs to this memo boundary. Callbacks and source state
 * stay outside it so a new stream fragment cannot repaint every saved passage,
 * and stale authorization handlers are never retained by a custom comparator.
 * AiResponseText's own fade clock and motion context still update normally. */
export const ConversationMessageText = memo(
  function RenderConversationMessageText({
    content,
    verifiedA2UI,
    user,
    testID,
    assistantFormat,
    staticText = false,
    savedPossibilityNarrative,
    selectable = true,
    onLinkError,
  }: {
    readonly content: string;
    readonly verifiedA2UI?: ConversationA2UINode;
    readonly user: boolean;
    readonly testID?: string;
    readonly assistantFormat?: AssistantTextFormat;
    readonly staticText?: boolean;
    readonly savedPossibilityNarrative?: true;
    readonly selectable?: boolean;
    readonly onLinkError?: () => void;
  }) {
    const allowReport = !user && assistantFormat === 'report-capable';
    const report = allowReport ? parseConversationReport(content) : undefined;
    const parts =
      !report && allowReport && savedPossibilityNarrative
        ? savedPossibilityNarrativeParts(content)
        : undefined;
    const notices =
      verifiedA2UI && conversationA2UIAppNotices(verifiedA2UI, content);
    const root = notices ? verifiedA2UI : undefined;
    const committedRoot =
      !report && !parts && !staticText && !user ? root : undefined;
    useLayoutEffect(() => {
      if (committedRoot) reportConversationA2UIReactCommit();
    }, [committedRoot]);
    if (report)
      return (
        <ConversationReportText
          report={report}
          testID={testID}
          selectable={selectable}
        />
      );
    if (parts)
      return (
        <SavedPossibilityNarrative
          parts={parts}
          testID={testID}
          selectable={selectable}
        />
      );
    // Explicit reports and retained narratives above keep their native design.
    // The surrounding bubble still owns any verified sources and copy menu.
    if (root && isProtectedArchivedA2UILayout(root))
      return <ArchivedRichTextSurface root={root} testID={testID} />;
    if (root && archivedPairedDetailsFor(root))
      return <ArchivedPairedDetailsSurface root={root} testID={testID} />;
    if (root)
      return (
        <>
          <ConversationA2UISurface root={root} testID={testID} />
          {notices?.map(notice => (
            <AppText
              key={notice}
              selectable={selectable}
              style={styles.messageText}
            >
              {notice}
            </AppText>
          ))}
        </>
      );
    // During a draft the existing text host keeps appending; only a complete
    // ordinary answer (live or restored) can replace raw syntax with formatting.
    const markdown =
      !user &&
      assistantFormat &&
      (!allowReport || !hasConversationReportTitle(content))
        ? parseAssistantMarkdown(content)
        : undefined;
    if (markdown)
      return (
        <AssistantMarkdown
          blocks={markdown}
          testID={testID}
          selectable={selectable}
          onLinkError={onLinkError}
        />
      );
    const Text = user || staticText ? AppText : AiResponseText;
    return (
      <Text
        selectable={selectable}
        style={[styles.messageText, user && styles.userText]}
        testID={testID}
      >
        {content}
      </Text>
    );
  },
);
