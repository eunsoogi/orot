import { useState } from 'react';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import { useNavigationEdgeVerticalScroll } from '../navigation/navigationEdgeScroll';
import { styles } from './ConversationScreen.styles';
import { styles as historyStyles } from './ConversationHistoryLayout.styles';
import { useFloatingComposerInset } from './FloatingComposerSurface';
import { useFloatingIdentityInset } from '../assistantAppearance/FloatingIdentityInset';

/** Measure the unchanged route host, not a scroll view whose style can then widen to reach the edge. */
function useConversationOwnedEdgeScroll({
  style,
  content,
  indicatorTop,
  indicatorBottom,
  testID,
}: {
  readonly style?: StyleProp<ViewStyle>;
  readonly content: StyleProp<ViewStyle>;
  readonly indicatorTop?: number;
  readonly indicatorBottom?: number;
  readonly testID?: string;
}) {
  const [ownerWidth, setOwnerWidth] = useState(0);
  const edge = useNavigationEdgeVerticalScroll({
    ownerWidth,
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
export function useTranscriptEdgeScroll(bottomInset: number, compact: boolean) {
  const identityInset = useFloatingIdentityInset();
  const composerInset = useFloatingComposerInset();
  return useConversationOwnedEdgeScroll({
    style: styles.history,
    content: {
      paddingTop: identityInset,
      paddingBottom: bottomInset + composerInset + (compact ? 0 : 20),
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
