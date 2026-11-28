import { StyleSheet, View } from 'react-native';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { PulsingSkeleton } from '../layout/PulsingSkeleton';

/** Mirrors the date divider and a short list without resembling real records or actions. */
export function RecordsRecentSkeleton() {
  return (
    <View
      accessible
      accessibilityLabel={t('records.recent.loading')}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      testID="records-recent-sources-loading"
    >
      <PulsingSkeleton testID="records-recent-skeleton">
        <View style={styles.group}>
          <View style={styles.groupHeading}>
            <View style={[styles.placeholder, styles.date]} />
            <View style={styles.divider} />
          </View>
          {([58, 74, 46] as const).map(width => (
            <View key={width} style={styles.row}>
              <View style={[styles.placeholder, styles.icon]} />
              <View style={[styles.placeholder, { width: `${width}%` }]} />
            </View>
          ))}
        </View>
      </PulsingSkeleton>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 6 },
  groupHeading: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  date: { width: 72, height: 12 },
  divider: {
    backgroundColor: appColors.border,
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  row: {
    minHeight: 44,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  placeholder: {
    height: 12,
    borderRadius: 6,
    backgroundColor: appColors.border,
    flexShrink: 1,
  },
  icon: { width: 30, height: 30, borderRadius: 9 },
});
