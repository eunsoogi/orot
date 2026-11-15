import { StyleSheet, View } from 'react-native';
import type { HealthObservation } from '@orot/domain';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { healthRecordCategoryPresentation } from './healthRecordCategoryPresentation';
import { HealthRecordsCategoryCharts } from './HealthRecordsCategoryCharts';
import { HealthRecordsCategoryHeading } from './HealthRecordsCategoryHeading';
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

/** Keeps bounded charts primary and leaves raw values and provenance in the detail route. */
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

  return (
    <View style={styles.card} testID={'health-record-category-' + category}>
      <HealthRecordsCategoryHeading
        icon={
          <View
            style={[styles.icon, { backgroundColor: appearance.background }]}
          >
            <AppSymbol name={appearance.symbol} color={appearance.color} />
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
          {title}
        </Text>
        {loadState === 'ready' || count > 0 || hasMore ? (
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
        ) : null}
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
      ) : null}
      {!eventLike ? (
        <HealthRecordsCategoryCharts
          category={category}
          observations={recentObservations}
          hasMore={hasMore}
          loadState={loadState}
        />
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
});
