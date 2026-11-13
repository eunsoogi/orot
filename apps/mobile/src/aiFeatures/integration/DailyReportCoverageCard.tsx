import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { DailyReportSourceCoverage } from '@orot/domain';
import { AppSymbol } from '../../layout/AppSymbol';
import { AppText } from '../../layout/AppText';
import { appColors } from '../../layout/appColors';
import { formatDateTime, formatNumber, t } from '../../i18n';
import {
  isDailyReportRecordSource,
  limitationLabel,
  sourceLabel,
  sourceSymbol,
  statusLabel,
  statusVisual,
  syncStatusLabel,
} from './dailyReportCoveragePresentation';

/** An absent snapshot does not prove that each source is empty. */
export function DailyReportCoverageEmptyCard() {
  const label = t('dailyReport.coverage.none');
  return (
    <View accessible accessibilityLabel={label} style={styles.card}>
      <AppText>{label}</AppText>
    </View>
  );
}

/** Shows one source's verified state and reveals details only when requested. */
export function DailyReportCoverageCard({
  item,
  sourceCounts,
  timeZone,
}: {
  readonly item: DailyReportSourceCoverage;
  readonly sourceCounts?: ReadonlyMap<string, number>;
  readonly timeZone: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const name = sourceLabel(item.source);
  const state = statusLabel(item.status);
  const visual = statusVisual(item.status);
  const hasRecordSource =
    isDailyReportRecordSource(item.source) ||
    sourceCounts?.has(item.source) === true;
  const countText = hasRecordSource
    ? sourceCounts === undefined
      ? t('dailyReport.coverage.countUnknown')
      : t('dailyReport.coverage.count', {
          count: formatNumber(sourceCounts.get(item.source) ?? 0),
        })
    : undefined;
  const syncText = hasRecordSource ? syncStatusLabel(item) : undefined;
  const freshnessText = hasRecordSource
    ? item.availableThrough
      ? t('dailyReport.sourceTime', {
          time: formatDateTime(new Date(item.availableThrough), timeZone),
        })
      : t('dailyReport.coverage.freshnessUnknown')
    : undefined;
  const summaryLabel = [name, state, countText, syncText, freshnessText]
    .filter((value): value is string => Boolean(value))
    .join('. ');
  const limitations = [...new Set(item.limitationCodes.map(limitationLabel))];
  const hasDetails = Boolean(
    item.lastSuccessfulAt || item.lastAttemptAt || limitations.length,
  );
  const detailTitle = t(
    expanded
      ? 'dailyReport.coverage.details.hide'
      : 'dailyReport.coverage.details.show',
  );

  return (
    <View style={styles.card} testID={`daily-report-coverage-${item.source}`}>
      <View accessible accessibilityLabel={summaryLabel}>
        <View style={styles.heading}>
          <AppSymbol name={sourceSymbol(item.source)} />
          <AppText accessibilityRole="header" style={styles.title}>
            {name}
          </AppText>
        </View>
        <View style={[styles.badge, { backgroundColor: visual.surface }]}>
          <AppSymbol name={visual.symbol} color={visual.color} size={16} />
          <AppText style={[styles.badgeText, { color: visual.color }]}>
            {state}
          </AppText>
        </View>
        {countText ? <AppText style={styles.count}>{countText}</AppText> : null}
        {syncText || freshnessText ? (
          <View style={styles.metadata}>
            {syncText ? (
              <AppText style={styles.metadataText}>{syncText}</AppText>
            ) : null}
            {freshnessText ? (
              <AppText style={styles.metadataText}>{freshnessText}</AppText>
            ) : null}
          </View>
        ) : null}
      </View>
      {hasDetails ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${name}: ${detailTitle}`}
            accessibilityState={{ expanded }}
            onPress={() => setExpanded(value => !value)}
            style={styles.detailsToggle}
          >
            <AppText style={styles.detailsToggleText}>{detailTitle}</AppText>
            <AppSymbol
              name={expanded ? 'chevron.up' : 'chevron.down'}
              color={appColors.primaryText}
              size={16}
            />
          </Pressable>
          {expanded ? (
            <View style={styles.details}>
              {item.lastSuccessfulAt ? (
                <AppText>
                  {t('dailyReport.coverage.lastSuccessful', {
                    time: formatDateTime(
                      new Date(item.lastSuccessfulAt),
                      timeZone,
                    ),
                  })}
                </AppText>
              ) : null}
              {item.lastAttemptAt ? (
                <AppText>
                  {t('dailyReport.coverage.lastAttempt', {
                    time: formatDateTime(
                      new Date(item.lastAttemptAt),
                      timeZone,
                    ),
                  })}
                </AppText>
              ) : null}
              {limitations.map((limitation, limitationIndex) => (
                <AppText key={`${item.source}:${limitationIndex}`}>
                  {limitation}
                </AppText>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexBasis: 160,
    flexGrow: 1,
    minWidth: 150,
    maxWidth: '100%',
    gap: 8,
    borderWidth: 1,
    borderColor: appColors.border,
    borderRadius: 16,
    backgroundColor: appColors.surface,
    padding: 12,
  },
  heading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  count: {
    fontSize: 14,
    fontWeight: '500',
  },
  metadata: {
    gap: 4,
  },
  metadataText: {
    color: appColors.secondary,
    fontSize: 13,
  },
  detailsToggle: {
    minWidth: 44,
    minHeight: 44,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
  },
  detailsToggleText: {
    color: appColors.primaryText,
    flexShrink: 1,
    fontSize: 14,
  },
  details: {
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: appColors.border,
    paddingTop: 8,
  },
});
