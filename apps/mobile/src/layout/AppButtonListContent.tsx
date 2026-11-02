import type { ReactNode } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { appColors } from './appColors';

interface AppButtonListContentProps {
  readonly leadingContent?: ReactNode;
  readonly summary?: string;
  readonly title: string;
  readonly titleStyle: StyleProp<TextStyle>;
  readonly trailingContent?: ReactNode;
}

/** Lays out optional row details inside the parent button's single press target. */
export function AppButtonListContent({
  leadingContent,
  summary,
  title,
  titleStyle,
  trailingContent,
}: AppButtonListContentProps) {
  return (
    <View style={styles.listContent}>
      {leadingContent != null ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.leadingContent}
        >
          {leadingContent}
        </View>
      ) : null}
      <View style={styles.copy}>
        <Text allowFontScaling style={titleStyle}>
          {title}
        </Text>
        {summary ? (
          <Text allowFontScaling style={styles.summary}>
            {summary}
          </Text>
        ) : null}
      </View>
      {trailingContent != null ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.trailingContent}
        >
          {trailingContent}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // The button owns one press target; accessory content stays non-interactive.
  listContent: {
    alignItems: 'center',
    flexDirection: 'row',
    flexGrow: 1,
    gap: 12,
    minWidth: 0,
  },
  leadingContent: { flexShrink: 0 },
  copy: { flex: 1, gap: 2, minWidth: 0 },
  summary: {
    color: appColors.secondary,
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  trailingContent: {
    alignItems: 'center',
    flexShrink: 0,
    justifyContent: 'center',
  },
});
