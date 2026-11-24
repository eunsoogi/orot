import { SavedPossibilityNarrative } from './SavedPossibilityNarrative';
import { savedPossibilityNarrativeParts } from './savedPossibilityNarrativeParts';
import { ConversationReportText } from './ConversationReportText';
import { parseConversationReport } from './conversationReportTemplate';
import { ConversationA2UISurface } from './ConversationA2UISurface';
import type { ConversationA2UINode } from './conversationA2UI';
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
    verifiedA2UI,
    user,
    testID,
    allowReport = false,
    staticText = false,
    savedPossibilityNarrative,
    selectable = true,
  }: {
    readonly content: string;
    readonly verifiedA2UI?: ConversationA2UINode;
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
    // Explicit reports and retained narratives above keep their native design.
    // The surrounding bubble still owns any verified sources and copy menu.
    if (verifiedA2UI)
      return <ConversationA2UISurface root={verifiedA2UI} testID={testID} />;
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
