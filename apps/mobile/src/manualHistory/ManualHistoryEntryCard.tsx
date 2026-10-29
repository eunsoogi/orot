import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import type { ManualHistoryScreenRecord } from './types';

function kindLabel(kind: ManualHistoryScreenRecord['kind']): string {
  return t(
    ('manualHistory.kind.' +
      kind) as `manualHistory.kind.${ManualHistoryScreenRecord['kind']}`,
  );
}

function entryStatus(entry: ManualHistoryScreenRecord): string {
  const reviewKey = ('manualHistory.review.' + entry.reviewState.status) as
    | 'manualHistory.review.unreviewed'
    | 'manualHistory.review.needs_review'
    | 'manualHistory.review.reviewed';
  return t('manualHistory.status', { review: t(reviewKey) });
}

function dateLabel(entry: ManualHistoryScreenRecord): string {
  return entry.effectiveDate.status === 'known'
    ? t('manualHistory.date.known', { date: entry.effectiveDate.date })
    : t('manualHistory.date.unknown');
}

/** Shows date and provenance beside each item so unknown dates remain explicit in the list. */
export function ManualHistoryEntryCard({
  entry,
  onOpenDetails,
  expanded,
  disabled,
  children,
}: {
  readonly entry: ManualHistoryScreenRecord;
  readonly expanded: boolean;
  readonly disabled: boolean;
  readonly children?: ReactNode;
  readonly onOpenDetails: () => void;
}) {
  return (
    <View style={styles.card} testID={'manual-history-entry-' + entry.id}>
      {/* Metadata stays outside the grouped button so VoiceOver retains each date, kind and source. */}
      <View style={styles.metadata}>
        <Text style={styles.date} testID={'manual-history-date-' + entry.id}>
          {dateLabel(entry)}
        </Text>
        <Text style={[styles.badge, kindColors[entry.kind]]}>
          {kindLabel(entry.kind)}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('manualHistory.details') + ': ' + entry.title}
        accessibilityState={{ expanded, disabled }}
        disabled={disabled}
        onPress={onOpenDetails}
        style={styles.summary}
        testID={'manual-history-details-' + entry.id}
      >
        <Text style={[styles.entryTitle, styles.copy]}>{entry.title}</Text>
        <AppSymbol
          name={expanded ? 'chevron.up' : 'chevron.down'}
          color={appColors.secondary}
          size={18}
        />
      </Pressable>
      <Text style={styles.source}>{entryStatus(entry)}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    gap: 16,
    padding: 20,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    minHeight: 44,
  },
  copy: { flex: 1, minWidth: 0, gap: 8 },
  metadata: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  date: { color: appColors.secondary, fontSize: 16, fontWeight: '600' },
  badge: {
    color: appColors.primaryText,
    backgroundColor: appColors.primarySoft,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
  },
  entryTitle: { color: appColors.text, fontSize: 20, fontWeight: '600' },
  source: { color: appColors.secondary, fontSize: 14 },
});

// Existing semantic accents distinguish record domains without changing their stored kind.
const kindColors = {
  diagnosis_history: {
    color: appColors.primaryText,
    backgroundColor: appColors.primarySoft,
  },
  procedure: { color: appColors.purple, backgroundColor: appColors.purpleSoft },
  medication_context: {
    color: appColors.green,
    backgroundColor: appColors.greenSoft,
  },
  note: { color: appColors.secondary, backgroundColor: appColors.background },
};
