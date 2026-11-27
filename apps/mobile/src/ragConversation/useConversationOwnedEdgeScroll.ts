import { useContext, useState } from 'react';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import { ConversationTranscriptTrailingLane } from './ConversationWorkspaceContext';
import { useNavigationContentFrame } from '../navigation/navigationContentFrame';
import { useNavigationEdgeVerticalScroll } from '../navigation/navigationEdgeScroll';
import { CONVERSATION_SECTION_GAP, styles } from './ConversationScreen.styles';
import { styles as historyStyles } from './ConversationHistoryLayout.styles';
import {
  useFloatingComposerInset,
  useFloatingComposerPassiveTop,
} from './FloatingComposerSurface';
import type { ConversationHistoryProps } from './ConversationHistoryProps';
import { useFloatingIdentityInset } from '../assistantAppearance/FloatingIdentityInset';

/** Measure the unchanged route host, not a scroll view whose style can then widen to reach the edge. */
function useConversationOwnedEdgeScroll({
  style,
  content,
  indicatorTop,
  indicatorBottom,
  testID,
  isTranscript = false,
}: {
  readonly style?: StyleProp<ViewStyle>;
  readonly content: StyleProp<ViewStyle>;
  readonly indicatorTop?: number;
  readonly indicatorBottom?: number;
  readonly testID?: string;
  readonly isTranscript?: boolean;
}) {
  const [ownerWidth, setOwnerWidth] = useState(0);
  const trailingLane = useContext(ConversationTranscriptTrailingLane);
  const frame = useNavigationContentFrame();
  const route = frame?.availableContentFrame;
  // Match both the actual transcript width and the physical right end of
  // its measured workspace. Side panes never receive this exception.
  const ownsTrailing =
    isTranscript &&
    trailingLane &&
    trailingLane.frame === frame &&
    route &&
    Math.abs(trailingLane.right - (route.x + route.width)) <= 1 &&
    ownerWidth > 0 &&
    Math.abs(ownerWidth - trailingLane.width) <= 1;
  const edge = useNavigationEdgeVerticalScroll({
    ownerWidth: ownsTrailing ? undefined : ownerWidth,
    indicatorTop,
    indicatorBottom,
  });
  return {
    hostProps: {
      testID,
      onLayout: ({ nativeEvent }: LayoutChangeEvent) =>
        setOwnerWidth(nativeEvent.layout.width),
    },
    scrollProps: {
      style: edge.scrollViewStyle ? [style, edge.scrollViewStyle] : style,
      contentContainerStyle: edge.contentStyle
        ? [content, edge.contentStyle]
        : content,
      ...edge.indicatorProps,
    },
  };
}

/** The keyboard contracts the transcript host; only overlapping app chrome belongs in its indicator inset. */
export function useTranscriptEdgeScroll(
  bottomInset: number,
  compact: boolean,
  history?: ConversationHistoryProps,
) {
  const identityInset = useFloatingIdentityInset();
  const composerInset = useFloatingComposerInset();
  const composerPassiveTop = useFloatingComposerPassiveTop();
  const tail = hasRestoredChoiceTail(history)
    ? Math.max(0, CONVERSATION_SECTION_GAP - composerPassiveTop)
    : compact
      ? 0
      : CONVERSATION_SECTION_GAP;
  return useConversationOwnedEdgeScroll({
    style: styles.history,
    isTranscript: true,
    content: {
      paddingTop: identityInset,
      paddingBottom: bottomInset + composerInset + tail,
    },
    indicatorTop: identityInset,
    indicatorBottom: composerInset,
  });
}

/** History's route keeps the same native ScrollView across a preview pane reflow. */
export function useHistoryPageEdgeScroll() {
  return useConversationOwnedEdgeScroll({
    content: historyStyles.pageContent,
    testID: 'conversation-history-screen',
  });
}

/** A fixed reading gap belongs only to a restored choice group that actually ends the transcript. */
function hasRestoredChoiceTail(history?: ConversationHistoryProps) {
  return Boolean(
    history?.entryChoices &&
    (history.entryChoicesMayEnd ?? !history.footer) &&
    !history.pendingMessage &&
    !history.error &&
    !history.unsavedCount &&
    !history.restoreFailed &&
    !history.restoring &&
    history.messages.every(message => message.restoredHistory) &&
    !history.voiceEndCards?.some(
      card => card.liveAfterMessageId !== undefined,
    ) &&
    (history.messages.length ||
      history.savedHistoryDisplay?.length ||
      history.voiceEndCards?.length),
  );
}
