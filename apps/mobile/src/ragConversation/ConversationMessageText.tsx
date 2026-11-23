import {
  SavedPossibilityNarrative,
  savedPossibilityNarrativeParts,
} from './SavedPossibilityNarrative';
import { ConversationReportText } from './ConversationReportText';
import { parseConversationReport } from './conversationReportTemplate';
import { memo } from 'react';
import { AppText } from '../layout/AppText';
import { AiResponseText } from '../layout/AiResponseText';
import { styles } from './ConversationScreen.styles';

/** Only prose identity belongs to this memo boundary. Callbacks and source state
 * stay outside it so a new stream fragment cannot repaint every saved passage,
 * and stale authorization handlers are never retained by a custom comparator.
 * AiResponseText's own fade clock and motion context still update normally. */
export const ConversationMessageText = memo(
  function RenderConversationMessageText({
    content,
    user,
    testID,
    allowReport = false,
    staticText = false,
    savedPossibilityNarrative,
    selectable = true,
  }: {
    readonly content: string;
    readonly user: boolean;
    readonly testID?: string;
    readonly allowReport?: boolean;
    readonly staticText?: boolean;
    readonly savedPossibilityNarrative?: true;
    readonly selectable?: boolean;
  }) {
    const report =
      !user && allowReport ? parseConversationReport(content) : undefined;
    if (report)
      return (
        <ConversationReportText
          report={report}
          testID={testID}
          selectable={selectable}
        />
      );
    const parts =
      !user && allowReport && savedPossibilityNarrative
        ? savedPossibilityNarrativeParts(content)
        : undefined;
    if (parts)
      return (
        <SavedPossibilityNarrative
          parts={parts}
          testID={testID}
          selectable={selectable}
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
