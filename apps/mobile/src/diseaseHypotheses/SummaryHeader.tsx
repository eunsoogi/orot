import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { ComposerGlassBackground } from '../ragConversation/ComposerGlassBackground';

/** Shares the conversation screen's native Liquid Glass history action and 44pt touch target. */
export function SummaryHeader({
  title,
  disabled,
  onOpenHistory,
}: {
  readonly title: string;
  readonly disabled: boolean;
  readonly onOpenHistory?: () => void;
}) {
  return (
    <View style={styles.header}>
      <AppText accessibilityRole="header" style={styles.heading}>
        {title}
      </AppText>
      {onOpenHistory ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="저장된 요약 보기"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onOpenHistory}
          style={styles.action}
          testID="symptom-summary-history-open"
        >
          <ComposerGlassBackground testID="symptom-summary-history-glass" />
          <AppSymbol
            name="clock.arrow.circlepath"
            color={appColors.primaryText}
            size={20}
          />
        </Pressable>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heading: { flex: 1, fontSize: 22, fontWeight: '700' },
  action: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
