import { StyleSheet, View } from 'react-native';
import type { HealthObservation } from '@orot/domain';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { formatRecordedAt } from '../recording/formatRecordedAt';
import { healthRecordCategoryPresentation } from './healthRecordCategoryPresentation';
import { HealthRecordsCategoryCharts } from './HealthRecordsCategoryCharts';
import { HealthRecordsCategoryHeading } from './HealthRecordsCategoryHeading';
import {
  displayRecordValue,
  provenanceLabel,
  hasUnavailableSourceValue,
} from './healthRecordsDetailPresentation';
import type {
  HealthObservationCategory,
  HealthRecordsDetailSelection,
} from './healthRecordsLibraryModel';
import {
  groupBloodPressureObservations,
  healthRecordCategoryTitle,
  healthRecordPeriodTitle,
  filterObservationsByPeriod,
} from './healthRecordsLibraryModel';

interface HealthRecordsCategoryCardProps {
  readonly category: HealthObservationCategory;
  readonly hasMore?: boolean;
  readonly loadState: 'loading' | 'ready' | 'failed';
  readonly observations: readonly HealthObservation[];
  readonly onOpenDetail: (selection: HealthRecordsDetailSelection) => void;
}

/** Separates measured series from event records while keeping one clear detail action. */
export function HealthRecordsCategoryCard({
  category,
  hasMore = false,
  loadState,
  observations,
  onOpenDetail,
}: HealthRecordsCategoryCardProps) {
  const title = healthRecordCategoryTitle(category);
  const appearance = healthRecordCategoryPresentation[category];
  const recentObservations = filterObservationsByPeriod(
    observations,
    'month',
    new Date().toISOString(),
  );
  const count =
    category === 'blood_pressure'
      ? groupBloodPressureObservations(recentObservations).length
      : recentObservations.length;
  const eventLike = category === 'sleep' || category === 'other';
  const latest = [...recentObservations].sort((left, right) =>
    right.effectiveAt.localeCompare(left.effectiveAt),
  )[0];
  const latestPressure =
    category === 'blood_pressure'
      ? groupBloodPressureObservations(recentObservations)[0]
      : undefined;
  const pressureValues = [
    latestPressure?.systolic,
    latestPressure?.diastolic,
  ].filter((item): item is HealthObservation => Boolean(item));

  return (
    <View style={styles.card} testID={'health-record-category-' + category}>
      <HealthRecordsCategoryHeading
        icon={
          <View
            style={[styles.icon, { backgroundColor: appearance.background }]}
          >
            <AppSymbol
              name={appearance.symbol}
              size={26}
              color={appearance.color}
            />
          </View>
        }
        action={
          <AppButton
            accessibilityHint={t('healthRecords.detailHint', { title })}
            onPress={() => onOpenDetail({ category, period: 'month' })}
            testID={'health-record-open-detail-' + category}
            title={t('healthRecords.detail')}
            variant="secondary"
          />
        }
      >
        <Text accessibilityRole="header" style={styles.title}>
          {title + ' 기록'}
        </Text>
        <Text style={styles.count}>
          {t(
            hasMore
              ? 'healthRecords.loadedCategoryPeriodSummary'
              : 'healthRecords.categoryPeriodSummary',
            {
              count,
              period: healthRecordPeriodTitle('month'),
            },
          )}
        </Text>
      </HealthRecordsCategoryHeading>
      {recentObservations.length === 0 ? (
        <Text
          style={styles.eventSummary}
          testID={'health-record-category-empty-' + category}
        >
          {loadState === 'loading'
            ? t('healthRecords.loading')
            : loadState === 'failed'
              ? t('healthRecords.error')
              : t(
                  hasMore
                    ? 'healthRecords.categoryNotLoaded'
                    : 'healthRecords.categoryEmpty',
                  { title },
                )}
        </Text>
      ) : eventLike ? (
        <Text style={styles.eventSummary}>
          {t('healthRecords.eventSummary', {
            count,
            timestamp: latest ? formatRecordedAt(latest.effectiveAt) : '-',
          })}
        </Text>
      ) : (
        <HealthRecordsCategoryCharts
          category={category}
          observations={recentObservations}
        />
      )}
      {latest && !latestPressure ? (
        <View style={styles.latestCopy}>
          <Text style={styles.latestTitle}>{displayRecordValue(latest)}</Text>
          <Text style={styles.count}>
            {formatRecordedAt(latest.effectiveAt)}
          </Text>
          <Text style={styles.count}>{provenanceLabel(latest)}</Text>
          {hasUnavailableSourceValue(latest) ? (
            <Text style={styles.count}>
              {t('healthRecords.sourceValueUnavailable')}
            </Text>
          ) : null}
        </View>
      ) : null}
      {latestPressure ? (
        <View style={styles.latest}>
          <View style={styles.latestIcon}>
            <AppSymbol
              name="doc.text"
              size={20}
              color={appColors.primaryAction}
            />
          </View>
          <View style={styles.latestCopy}>
            <Text style={styles.latestTitle}>
              {t('healthRecords.latestBloodPressure')}
              <Text style={styles.latestValue}>
                {' ' + pressureValues.map(displayRecordValue).join(' / ')}
              </Text>
            </Text>
            <Text style={styles.count}>
              {formatRecordedAt(latestPressure.effectiveAt)}
            </Text>
            <Text style={styles.count}>
              {[...new Set(pressureValues.map(provenanceLabel))].join(' · ')}
            </Text>
            {pressureValues.some(hasUnavailableSourceValue) ? (
              <Text style={styles.count}>
                {t('healthRecords.sourceValueUnavailable')}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: 16,
    padding: 16,
  },
  icon: {
    alignItems: 'center',
    backgroundColor: appColors.dangerSurface,
    borderRadius: 14,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  title: { color: appColors.text, fontSize: 17, fontWeight: '700' },
  count: { color: appColors.secondary, fontSize: 13 },
  eventSummary: {
    color: appColors.text,
    fontSize: 14,
    lineHeight: 20,
    borderTopColor: appColors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 16,
  },
  latest: {
    alignItems: 'center',
    backgroundColor: appColors.primarySoft,
    borderRadius: 16,
    flexDirection: 'row',
    gap: 12,
    padding: 12,
  },
  latestIcon: {
    alignItems: 'center',
    backgroundColor: appColors.surface,
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  latestCopy: { flexShrink: 1, minWidth: 0, gap: 4 },
  latestTitle: { color: appColors.text, fontSize: 14, fontWeight: '600' },
  latestValue: { color: appColors.primaryAction, fontWeight: '700' },
});
